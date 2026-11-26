import { DEFAULT_SKIN } from '../sim/skins';
import { PLAYABLE_ZONES, zoneLevel, zoneStage } from '../sim/zones';
import { freshSave, newRun, type HeroRun, type SaveData } from '../sim/sim';
import { FORMS, INVENTORY_SIZE, INVENTORY_STEP, MAX_INVENTORY, starterWeapon, upgradeOldWeapon, type Weapon } from '../sim/weapons';
import { RETIRED, SKINS, canWield, skinDef } from '../sim/skins';
import { freshPerks, freshStats } from '../sim/meta';
import { freshMissions } from '../sim/missions';
import { cleanRegions } from '../sim/regionQuests';
import { cleanMastery } from '../sim/mastery';

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
  if (data.v !== 1 && data.v !== 2 && data.v !== 3 && data.v !== 4 && data.v !== 5 && data.v !== 6 && data.v !== 7 && data.v !== 8) return base;
  const oldVersion = data.v;

  // v1 → v2: forge added (shards, forge level, inventory, starter weapon).
  // v2 → v3: reforge/perks, lifetime stats, quests, achievements.
  // v3 → v4: gems, login calendar, daily/weekly boards, 7-day journey, codex.
  // v4 → v5: hero level, XP and Level Road claims.
  // v5 → v6: world map zones (see below).
  // v6 → v7: heroes are classes with class-locked weapons (see below).
  // v7 → v8: each hero has their own run (see below).
  // All additions are filled from defaults by the merge below.
  const fm = freshMissions();
  const dm = (data.missions ?? {}) as Partial<typeof fm>;
  const save = {
    ...base, ...data, v: 8,
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
    regions: cleanRegions((data as { regions?: unknown }).regions),
    levelClaimed: Array.isArray(data.levelClaimed) ? data.levelClaimed : [],
  } as SaveData;
  delete (save as { quests?: unknown }).quests; // the old rolling quests (now region quests)
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
  }
  save.zone = Number.isFinite(save.zone) ? Math.max(0, Math.floor(save.zone)) : 0;
  // Only the Greenwood (zones 0-2) is playable for now: anyone further on goes to its last region.
  if (save.zone >= PLAYABLE_ZONES) { save.zone = PLAYABLE_ZONES - 1; save.stage = zoneStage(save.zone); save.farming = false; }
  save.zoneBosses = Number.isFinite(save.zoneBosses) ? Math.max(0, Math.floor(save.zoneBosses)) : 0;
  save.zoneBest = Math.max(save.zone, Number.isFinite(save.zoneBest) ? save.zoneBest : 0);
  save.bossReady = save.bossReady && typeof save.bossReady === 'object' ? save.bossReady : {};
  save.explored = typeof save.explored === 'string' ? save.explored : '';
  save.minimap = save.minimap === 'square' ? 'square' : 'circle';
  // Skins: whatever is owned (the first-launch pick need not be the Knight); never none. The
  // selected skin must be owned. Saves from before the first-launch choice count as chosen, and
  // always started as the Knight, so they keep it.
  const legacy = typeof (data as { starterChosen?: unknown }).starterChosen !== 'boolean';
  save.starterChosen = legacy || (data as { starterChosen: boolean }).starterChosen;
  const owned = Array.isArray(save.skins) ? save.skins.filter((x) => typeof x === 'string') : [];
  // Retired heroes (Ranger, Druid, Engineer): their gems come back, and they leave the save.
  const retiredOwned = [...new Set(owned.filter((x) => x in RETIRED))];
  for (const id of retiredOwned) save.missions.gems += RETIRED[id];
  const playedRetired = typeof save.skin === 'string' && save.skin in RETIRED;
  const kept = owned.filter((x) => SKINS.some((k) => k.id === x));
  save.skins = [...new Set(legacy ? [DEFAULT_SKIN, ...kept] : kept)];
  // Playing a retired hero with no other hero to fall back on: choose a hero again, from scratch.
  const rechoose = playedRetired && !save.skins.length;
  if (rechoose) save.starterChosen = false;
  if (!save.skins.length) save.skins = [DEFAULT_SKIN];
  // Playing a retired hero with others owned: switch to one of them (and their own run, below).
  const switchTo = playedRetired && !rechoose ? save.skins[0] : null;
  if (typeof save.skin !== 'string' || (!save.skins.includes(save.skin) && !switchTo)) save.skin = save.skins[0];
  const looks: Record<string, string> = {};
  for (const [k, v] of Object.entries(save.looks && typeof save.looks === 'object' ? save.looks : {})) if (typeof v === 'string') looks[k] = v;
  save.looks = looks;
  const palettes: Record<string, number> = {};
  for (const [k, v] of Object.entries(save.palettes && typeof save.palettes === 'object' ? save.palettes : {})) if (Number.isInteger(v) && v >= 0 && v <= 3) palettes[k] = v;
  save.palettes = palettes;
  const bones: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(save.bones && typeof save.bones === 'object' ? save.bones : {})) if (v === true && SKINS.some((d) => d.id === k)) bones[k] = true;
  save.bones = bones;
  // v6 → v7: Spears (old type 2) become Swords: type 2 is now the Barbarian's Greataxe.
  const known = (w: unknown): Weapon | null => {
    if (!w || typeof w !== 'object') return null;
    let k = upgradeOldWeapon(w as Weapon);
    if (oldVersion < 7 && k.form === 2) k = { ...k, form: 0 };
    return !Number.isInteger(k.form) || !FORMS[k.form] ? { ...k, form: 0 } : k;
  };
  // The bag: at least the starting size, whole rows, at most the maximum (it grows when the
  // player buys expansions).
  const bag = (x: unknown): (Weapon | null)[] => {
    const raw = Array.isArray(x) ? x : [];
    const rows = Math.ceil(Math.max(0, raw.length - INVENTORY_SIZE) / INVENTORY_STEP);
    const size = Math.min(MAX_INVENTORY, INVENTORY_SIZE + rows * INVENTORY_STEP);
    const inv = raw.slice(0, size).map(known);
    while (inv.length < size) inv.push(null);
    return inv;
  };
  save.weapons = bag(save.weapons);
  // The equipped weapon re-forms into the hero's weapon type if the hero can't wield it, so
  // nobody loses their best weapon.
  const wield = (id: string, w: unknown): Weapon | null => {
    const k = known(w);
    return k && !canWield(id, k.form) ? { ...k, form: skinDef(id).forms[0] } : k;
  };
  save.equipped = wield(save.skin, save.equipped);
  const gear = (data as { gear?: unknown }).gear;
  const oldGear = oldVersion === 7 && gear && typeof gear === 'object' ? gear as Record<string, unknown> : {};
  const storedRuns = (data as { runs?: unknown }).runs;
  const oldRuns = oldVersion >= 8 && storedRuns && typeof storedRuns === 'object' ? storedRuns as Record<string, Partial<HeroRun>> : {};
  // Keep weapon ids unique even if the counter was lost.
  let maxId = 0;
  const seen = (w: { id?: unknown } | null | undefined) => { if (w && typeof w.id === 'number' && w.id > maxId) maxId = w.id; };
  [save.equipped, ...save.weapons, ...Object.values(oldGear) as Weapon[]].forEach(seen);
  for (const r of Object.values(oldRuns)) if (r && typeof r === 'object') [r.equipped, ...(Array.isArray(r.weapons) ? r.weapons : [])].forEach(seen);
  save.nextWeaponId = Math.max(Number.isFinite(save.nextWeaponId) ? save.nextWeaponId : 0, maxId + 1);
  if (!save.equipped) save.equipped = starterWeapon(skinDef(save.skin).forms[0], save.nextWeaponId++);
  else if (save.equipped.id === 0) save.equipped.id = save.nextWeaponId++;

  // v8: each hero has their own run (RUN_KEYS). The other owned heroes' runs are kept in `runs`.
  const runs: Record<string, HeroRun> = {};
  for (const id of save.skins) {
    if (id === save.skin && !switchTo) continue;
    const fresh = newRun(save, id);
    const r = oldRuns[id];
    if (r && typeof r === 'object') {
      const run = { ...fresh, ...r } as HeroRun;
      run.upgrades = { ...fresh.upgrades, ...r.upgrades };
      run.rates = { ...fresh.rates, ...r.rates };
      run.weapons = bag(r.weapons);
      run.equipped = wield(id, r.equipped) ?? fresh.equipped;
      run.level = Number.isFinite(run.level) ? Math.max(1, Math.min(100, Math.floor(run.level))) : fresh.level;
      run.zone = Number.isFinite(run.zone) ? Math.max(0, Math.min(PLAYABLE_ZONES - 1, Math.floor(run.zone))) : fresh.zone;
      run.zoneBosses = Number.isFinite(run.zoneBosses) ? Math.max(0, Math.floor(run.zoneBosses)) : fresh.zoneBosses;
      run.zoneBest = Math.max(run.zone, Number.isFinite(run.zoneBest) ? run.zoneBest : 0);
      run.stage = zoneStage(run.zone);
      run.bossReady = run.bossReady && typeof run.bossReady === 'object' ? run.bossReady : {};
      run.explored = typeof run.explored === 'string' ? run.explored : '';
      runs[id] = run;
    } else {
      // A hero owned before v8 starts their own run, with the weapon they had out.
      const g = oldGear[id] ? known(oldGear[id]) : null;
      if (g && canWield(id, g.form)) fresh.equipped = g;
      runs[id] = fresh;
    }
  }
  if (oldVersion < 8) {
    // The shared bag is split up: weapons the current hero can't wield go to an owned hero
    // who can (while their bag has room).
    save.weapons = save.weapons.map((w) => {
      if (!w || canWield(save.skin, w.form)) return w;
      const to = Object.keys(runs).find((id) => canWield(id, w.form) && runs[id].weapons.includes(null));
      if (!to) return w;
      const b = runs[to].weapons;
      b[b.indexOf(null)] = w;
      return null;
    });
  }
  if (switchTo) {
    // The retired hero's run is dropped; the player carries on as their next hero, on that hero's run.
    Object.assign(save, runs[switchTo]);
    delete runs[switchTo];
    save.skin = switchTo;
  }
  if (rechoose) Object.assign(save, newRun(save, DEFAULT_SKIN));
  save.runs = runs;
  save.mastery = cleanMastery((data as { mastery?: unknown }).mastery);
  for (const id of Object.keys(RETIRED)) delete save.mastery[id];
  delete (save as { gear?: unknown }).gear;
  return save;
}
