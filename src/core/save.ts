import { freshMaterials } from '../sim/gather';
import { freshSave, type SaveData } from '../sim/sim';
import { INVENTORY_SIZE } from '../sim/weapons';
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
  return pick ? migrate(pick) : freshSave();
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
  if (data.v !== 1 && data.v !== 2 && data.v !== 3 && data.v !== 4 && data.v !== 5) return base;

  // v1 → v2: forge added (shards, forge level, inventory, starter weapon).
  // v2 → v3: reforge/perks, lifetime stats, quests, achievements.
  // v3 → v4: gems, login calendar, daily/weekly boards, 7-day journey, codex.
  // v4 → v5: hero level, XP and Level Road claims.
  // All additions are filled from defaults by the merge below.
  const fm = freshMissions();
  const dm = (data.missions ?? {}) as Partial<typeof fm>;
  const save = {
    ...base, ...data, v: 5,
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
  // Normalise the inventory to exactly INVENTORY_SIZE slots.
  const inv = Array.isArray(save.weapons) ? save.weapons.slice(0, INVENTORY_SIZE) : [];
  while (inv.length < INVENTORY_SIZE) inv.push(null);
  save.weapons = inv;
  // Keep weapon ids unique even if the counter was lost.
  let maxId = save.equipped?.id ?? 0;
  for (const w of inv) if (w && w.id > maxId) maxId = w.id;
  save.nextWeaponId = Math.max(save.nextWeaponId ?? 0, maxId + 1);
  return save;
}
