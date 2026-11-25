import { DEFAULT_SKIN } from '../sim/skins';
import { PLAYABLE_ZONES, zoneLevel, zoneStage } from '../sim/zones';
import { freshMaterials } from '../sim/gather';
import { freshSave, type SaveData } from '../sim/sim';
import { FORMS, INVENTORY_SIZE, INVENTORY_STEP, MAX_INVENTORY, starterWeapon, upgradeOldWeapon, type Weapon } from '../sim/weapons';
import { canWield, skinDef } from '../sim/skins';
import { freshPerks, freshStats } from '../sim/meta';
import { freshMissions } from '../sim/missions';

const KEY = 'forgeborn.save';
const DB_NAME = 'forgeborn';
const STORE = 'saves';

/**
 * Saves go to IndexedDB (durable, not size-limited, survives storage pressure better on iOS)
 * and are mirrored to localStorage synchronously, because a tab being closed can't wait for
 * an async IndexedDB write. On load, whichever copy is newer wins. Every storage access is
 * guarded: in private mode or with blocked site data the game runs on an in-memory save.
 */
export async function loadSave(): Promise<SaveData> {
  // Never let storage hang startup: if IndexedDB doesn't answer quickly (blocked by another
  // tab, broken browser state), fall back to the localStorage copy.
  const fromDb = await Promise.race([readDb().catch(() => null), timeout(1500)]);
  const fromLs = readLs();
  const pick = newest(fromDb, fromLs);
  if (!pick) return freshSave();
  // Safety net: keep the most advanced save ever loaded, exactly as it was (before any
  // conversion), under a second key. If an update ever mishandles a save, progress can be
  // recovered from it, and a reset save never overwrites a better backup.
  try {
    const prev = localStorage.getItem(BACKUP_KEY);
    if (!prev || progressScore(pick) >= progressScore(JSON.parse(prev))) localStorage.setItem(BACKUP_KEY, JSON.stringify(pick));
  } catch { /* storage full or blocked */ }
  return migrate(pick);
}

/** Copy of the most advanced save loaded so far (before migration). */
export const BACKUP_KEY = 'forgeborn.save.prev';

function progressScore(x: unknown): number {
  const d = (x ?? {}) as Partial<SaveData>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return n(d.embersEarned) * 1e6 + Math.max(n(d.zoneBest), n(d.bestEver) / 4) * 1e3 + n(d.level) + n(d.kills) * 1e-9;
}

export function writeSave(save: SaveData): void {
  save.savedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* unavailable */ }
  writeDb(save).catch(() => { /* unavailable: the localStorage copy still exists */ });
}

export async function wipeSave(): Promise<void> {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.delete(KEY));
    db.close();
  } catch { /* ignore */ }
}

function timeout(ms: number): Promise<null> {
  return new Promise((r) => setTimeout(() => r(null), ms));
}

function newest(a: unknown, b: unknown): unknown {
  const t = (x: unknown) => (x && typeof x === 'object' && typeof (x as SaveData).savedAt === 'number' ? (x as SaveData).savedAt : -1);
  if (!a) return b;
  if (!b) return a;
  return t(a) >= t(b) ? a : b;
}

function readLs(): unknown {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// --- IndexedDB (tiny promise wrapper; one object store keyed by name) -------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { dbPromise = null; }; // reopen next time if the browser closes it
      // Another tab wants to upgrade/delete the database: step aside instead of blocking it.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function readDb(): Promise<unknown> {
  const db = await openDb();
  return (await tx(db, 'readonly', (s) => s.get(KEY))) ?? null;
}

async function writeDb(save: SaveData): Promise<void> {
  const db = await openDb();
  // put() structured-clones synchronously, so later mutations of `save` don't leak in.
  await tx(db, 'readwrite', (s) => s.put(save, KEY));
}

/**
 * Upgrade any older save to the current format. Unknown or newer versions start fresh rather
 * than risk loading corrupt state. Exported for tests.
 */
export function migrate(input: unknown): SaveData {
  const base = freshSave();
  if (!input || typeof input !== 'object') return base;
  const data = { ...(input as Record<string, unknown>) } as Omit<Partial<SaveData>, 'v'> & { v?: number };
  if (data.v !== 1 && data.v !== 2 && data.v !== 3 && data.v !== 4 && data.v !== 5 && data.v !== 6 && data.v !== 7) return base;
  const oldVersion = data.v;

  // v1 → v2: forge added (shards, forge level, inventory, starter weapon).
  // v2 → v3: reforge/perks, lifetime stats, quests, achievements.
  // v3 → v4: gems, login calendar, daily/weekly boards, 7-day journey, codex.
  // v4 → v5: hero level, XP and Level Road claims.
  // v5 → v6: world map zones (see below).
  // v6 → v7: heroes are classes with class-locked weapons (see below).
  // All additions are filled from defaults by the merge below.
  const fm = freshMissions();
  const dm = (data.missions ?? {}) as Partial<typeof fm>;
  const save = {
    ...base, ...data, v: 7,
    missions: {
      ...fm, ...dm,
      attendance: { ...fm.attendance, ...dm.attendance },
      daily: { ...fm.daily, ...dm.daily },
      weekly: { ...fm.weekly, ...dm.weekly },
      journey: { ...fm.journey, ...dm.journey },
      codex: { ...dm.codex },
      codexClaimed: { ...dm.codexClaimed },
    },
    upgrades: { ...base.upgrades, ...data.upgrades },
    rates: { ...base.rates, ...data.rates },
    perks: { ...freshPerks(), ...data.perks },
    stats: { ...freshStats(), ...data.stats },
    achievements: { ...data.achievements },
    quests: Array.isArray(data.quests) ? data.quests : [],
    levelClaimed: Array.isArray(data.levelClaimed) ? data.levelClaimed : [],
    materials: { ...freshMaterials(), ...data.materials },
  } as SaveData;
  save.embersEarned = Math.max(save.embersEarned ?? 0, save.embers ?? 0);
  save.level = Number.isFinite(save.level) ? Math.max(1, Math.min(100, Math.floor(save.level))) : 1;
  save.xp = Number.isFinite(save.xp) ? Math.max(0, save.xp) : 0;
  save.bestEver = Math.max(save.bestEver ?? 1, save.highestStage ?? 1, save.stage ?? 1);
  if (oldVersion < 6) {
    // Stages → zones: every zone whose successor was within this run's reach counts as
    // having its boss beaten; the hero lands in the furthest zone their level allows.
    const reach = Math.max(1, save.highestStage ?? 1);
    let beaten = 0;
    while (zoneStage(beaten + 1) <= reach) beaten++;
    save.zoneBosses = beaten;
    let zone = 0;
    while (zone + 1 <= beaten && save.level >= zoneLevel(zone + 1)) zone++;
    save.zone = zone;
    let best = 0;
    while (zoneStage(best + 1) <= save.bestEver) best++;
    save.zoneBest = Math.max(zone, best);
    save.farming = false;
    save.quests = save.quests.filter((q) => (q.kind as string) !== 'stages');
  }
  save.zone = Number.isFinite(save.zone) ? Math.max(0, Math.floor(save.zone)) : 0;
  // Only the Greenwood (zones 0-2) is playable for now: anyone further on goes to its last region.
  if (save.zone >= PLAYABLE_ZONES) { save.zone = PLAYABLE_ZONES - 1; save.stage = zoneStage(save.zone); save.farming = false; }
  save.zoneBosses = Number.isFinite(save.zoneBosses) ? Math.max(0, Math.floor(save.zoneBosses)) : 0;
  save.zoneBest = Math.max(save.zone, Number.isFinite(save.zoneBest) ? save.zoneBest : 0);
  save.bossReady = save.bossReady && typeof save.bossReady === 'object' ? save.bossReady : {};
  // Skins: always own the default; the selected skin must be owned.
  save.skins = Array.isArray(save.skins) ? [...new Set([DEFAULT_SKIN, ...save.skins.filter((x) => typeof x === 'string')])] : [DEFAULT_SKIN];
  if (typeof save.skin !== 'string' || !save.skins.includes(save.skin)) save.skin = DEFAULT_SKIN;
  const looks: Record<string, string> = {};
  for (const [k, v] of Object.entries(save.looks && typeof save.looks === 'object' ? save.looks : {})) if (typeof v === 'string') looks[k] = v;
  save.looks = looks;
  const palettes: Record<string, number> = {};
  for (const [k, v] of Object.entries(save.palettes && typeof save.palettes === 'object' ? save.palettes : {})) if (Number.isInteger(v) && v >= 0 && v <= 3) palettes[k] = v;
  save.palettes = palettes;
  // Normalise the inventory size: at least the starting size, whole rows, at most the maximum
  // (it grows when the player buys expansions).
  const raw = Array.isArray(save.weapons) ? save.weapons : [];
  const rows = Math.ceil(Math.max(0, raw.length - INVENTORY_SIZE) / INVENTORY_STEP);
  const size = Math.min(MAX_INVENTORY, INVENTORY_SIZE + rows * INVENTORY_STEP);
  const inv = raw.slice(0, size).map((w) => (w ? upgradeOldWeapon(w) : null));
  if (save.equipped) save.equipped = upgradeOldWeapon(save.equipped);
  while (inv.length < size) inv.push(null);
  save.weapons = inv;
  // v6 → v7: Spears (old type 2) become Swords: type 2 is now the Barbarian's Greataxe. The
  // equipped weapon re-forms into the current hero's weapon type if that hero can't wield it,
  // so nobody loses their best weapon.
  const known = (w: Weapon | null): Weapon | null => (w && (!Number.isInteger(w.form) || !FORMS[w.form]) ? { ...w, form: 0 } : w);
  if (oldVersion < 7) {
    const spear = (w: Weapon | null): Weapon | null => (w && w.form === 2 ? { ...w, form: 0 } : w);
    save.weapons = save.weapons.map(spear);
    save.equipped = spear(save.equipped);
    save.gear = {};
  }
  save.weapons = save.weapons.map(known);
  save.equipped = known(save.equipped);
  if (!save.equipped) save.equipped = starterWeapon(skinDef(save.skin).forms[0], 0);
  else if (!canWield(save.skin, save.equipped.form)) save.equipped = { ...save.equipped, form: skinDef(save.skin).forms[0] };
  const gear: Record<string, Weapon | null> = {};
  for (const [id, w] of Object.entries(save.gear && typeof save.gear === 'object' ? save.gear : {})) {
    const k = known(w);
    if (k && id !== save.skin && save.skins.includes(id) && canWield(id, k.form)) gear[id] = k;
  }
  save.gear = gear;
  // Keep weapon ids unique even if the counter was lost.
  let maxId = save.equipped?.id ?? 0;
  for (const w of [...save.weapons, ...Object.values(save.gear)]) if (w && w.id > maxId) maxId = w.id;
  save.nextWeaponId = Math.max(save.nextWeaponId ?? 0, maxId + 1);
  if (save.equipped.id === 0) save.equipped.id = save.nextWeaponId++;
  return save;
}
