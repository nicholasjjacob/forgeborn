export const Ev = {
  Hit: 1,        // x, y, value, flag = 1 crit / 2 shock
  Kill: 2,       // x, y, value = gold, flag = boss
  HeroHit: 3,    // value = damage
  HeroDie: 4,
  StageClear: 5,
  BossFail: 6,
  Swing: 7,      // x, y, value = angle, flag = 1 for a ranged shot
  BossSpawn: 8,
  Spawn: 9,      // x, y, value = 1 for boss
  AreaEnter: 10, // value = zone index (travelled to a zone)
  Shard: 11,     // x, y, value = shard count
  Shock: 12,     // x, y = chained enemy; x2, y2 = where the arc came from
  LevelUp: 13,   // x, y = hero; value = new level
  Chop: 14,      // x, y = prop; value = prop index (a swing clipped a tree/rock)
  Drop: 15,      // x, y; value = 0 wood / 1 stone (a material piece appeared)
  Pickup: 16,    // x, y; value = 0 wood / 1 stone (the hero collected it)
  Telegraph: 17, // x, y; value = radius; flag = 1 boss slam wind-up / 0 dash wind-up
  Slam: 18,      // x, y; value = radius (a boss slam landed)
  Shoot: 19,     // x, y (a monster spat a projectile)
  ShotPop: 20,   // x, y (a projectile hit a prop or fizzled out)
  ZoneUnlock: 21, // value = zone index (a new zone opened on the world map)
  ZoneClear: 22,  // x, y; value = zone index (its boss was beaten for the first time)
  Burst: 23,      // x, y; value = radius, flag = rarity (a hero's magic orb exploded)
  RegionEnter: 24, // x, y = hero; value = zone (walked into another forest region)
  GateOpen: 25,    // x, y = the pass; value = zone it leads into (its barricade came down)
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];

/**
 * Fixed-capacity event queue backed by typed arrays: the sim pushes, the renderer drains once
 * per frame. Nothing is allocated per event, so busy fights don't create GC pressure.
 */
export class EventQueue {
  readonly type: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly x2: Float32Array;
  readonly y2: Float32Array;
  readonly value: Float64Array;
  readonly flag: Uint8Array;
  count = 0;

  constructor(readonly capacity = 512) {
    this.type = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.x2 = new Float32Array(capacity);
    this.y2 = new Float32Array(capacity);
    this.value = new Float64Array(capacity);
    this.flag = new Uint8Array(capacity);
  }

  push(type: Ev, x = 0, y = 0, value = 0, flag = 0, x2 = 0, y2 = 0): void {
    if (this.count >= this.capacity) return; // drop cosmetic overflow rather than allocate
    const i = this.count++;
    this.type[i] = type;
    this.x[i] = x;
    this.y[i] = y;
    this.value[i] = value;
    this.flag[i] = flag;
    this.x2[i] = x2;
    this.y2[i] = y2;
  }

  clear(): void {
    this.count = 0;
  }
}
