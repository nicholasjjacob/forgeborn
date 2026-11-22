import type { Rng } from '../core/rng';
import type { PropKind } from './areas';
import { Ev, type EventQueue } from './events';
import { MAP_H, MAP_W, type GameMap } from './map';

/**
 * Wood and stone: building materials for later. Pieces lie on the ground near trees and rocks
 * (respawning over time), and a swing that clips a tree or rock can knock one loose. The hero
 * picks them up by walking close; nearby pieces drift toward the hero.
 */

export type Material = 'wood' | 'stone';
export const MATERIALS: readonly Material[] = ['wood', 'stone'];
export interface Materials { wood: number; stone: number }
export const freshMaterials = (): Materials => ({ wood: 0, stone: 0 });

/** Which props give which material (shrubs and mushrooms give nothing). */
export const PROP_MATERIAL: Partial<Record<PropKind, Material>> = {
  tree: 'wood', pine: 'wood', deadtree: 'wood', cactus: 'wood',
  rock: 'stone', crystal: 'stone',
};

export const MAX_PICKUPS = 24;
const GROUND_CAP = 8;            // pieces lying around on their own
const RESPAWN_TIME = 9;          // seconds between new ground pieces (while under the cap)
const START_PIECES = 5;
const PICKUP_RADIUS = 11;        // walk this close to collect
const MAGNET_RADIUS = 30;        // pieces inside this drift toward the hero
const MAGNET_SPEED = 90;
const SETTLE_TIME = 0.45;        // a freshly knocked-out piece can't be collected mid-air
const CHOP_CHANCE = 0.45;
const CHOP_COOLDOWN = 5;         // per prop
const LIFETIME = 120;            // uncollected pieces fade eventually

export interface Pickup {
  alive: boolean;
  kind: Material;
  x: number; y: number;
  prevX: number; prevY: number;
  vx: number; vy: number;        // knock-out toss (decays quickly)
  age: number;
}

interface Host {
  readonly map: GameMap;
  readonly hero: { x: number; y: number };
  readonly rng: Rng;
  readonly events: EventQueue;
  readonly save: { materials: Materials };
}

export class Gatherer {
  readonly pickups: Pickup[] = Array.from({ length: MAX_PICKUPS }, () => ({
    alive: false, kind: 'wood' as Material, x: 0, y: 0, prevX: 0, prevY: 0, vx: 0, vy: 0, age: 0,
  }));
  private sources: number[] = [];          // indexes of interior props that give materials
  private readonly chopCd = new Map<number, number>();
  private respawnT = RESPAWN_TIME;
  private time = 0;

  constructor(private readonly host: Host) {}

  /** New area: clear pieces, find material props, and scatter a few pieces to start. */
  reset(): void {
    for (const p of this.pickups) p.alive = false;
    this.chopCd.clear();
    this.respawnT = RESPAWN_TIME;
    const map = this.host.map;
    this.sources = [];
    map.props.forEach((p, i) => {
      const inside = p.x > 40 && p.x < MAP_W - 40 && p.y > 40 && p.y < MAP_H - 40;
      if (inside && PROP_MATERIAL[p.kind]) this.sources.push(i);
    });
    for (let i = 0; i < START_PIECES; i++) this.spawnNear();
  }

  get alive(): number {
    let n = 0;
    for (const p of this.pickups) if (p.alive) n++;
    return n;
  }

  update(dt: number): void {
    this.time += dt;
    const h = this.host.hero, map = this.host.map;
    let ground = 0;
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.prevX = p.x; p.prevY = p.y;
      p.age += dt;
      ground++;
      if (p.age > LIFETIME) { p.alive = false; continue; }
      // Toss from a chop: slide out and stop, never into a tree or rock.
      if (p.vx || p.vy) {
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        if (!map.blocked(nx, ny, 3)) { p.x = nx; p.y = ny; }
        const damp = Math.pow(0.02, dt);
        p.vx *= damp; p.vy *= damp;
        if (Math.abs(p.vx) + Math.abs(p.vy) < 2) p.vx = p.vy = 0;
      }
      if (p.age < SETTLE_TIME) continue;
      const dx = h.x - p.x, dy = h.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < PICKUP_RADIUS) { this.collect(p); continue; }
      if (d < MAGNET_RADIUS) {
        const step = Math.min(d, MAGNET_SPEED * dt * (1.4 - d / MAGNET_RADIUS));
        p.x += (dx / d) * step; p.y += (dy / d) * step;
      }
    }
    if (ground < GROUND_CAP) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.respawnT = RESPAWN_TIME; this.spawnNear(); }
    }
  }

  /**
   * Called on every hero swing (angle `ang`, reach `range`, half-arc `arc`): a material prop
   * caught in the swing may drop a piece, tossed out toward the hero's side.
   */
  chop(ang: number, range: number, arc: number): void {
    const h = this.host.hero, map = this.host.map, rng = this.host.rng;
    for (const i of this.sources) {
      const p = map.props[i];
      const dx = p.x - h.x, dy = p.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d - p.r > range + 4) continue;
      let da = Math.atan2(dy, dx) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > arc) continue;
      if ((this.chopCd.get(i) ?? -Infinity) > this.time) continue;
      this.chopCd.set(i, this.time + CHOP_COOLDOWN);
      this.host.events.push(Ev.Chop, p.x, p.y, i);
      if (!rng.chance(CHOP_CHANCE)) continue;
      const out = Math.atan2(h.y - p.y, h.x - p.x) + rng.range(-0.9, 0.9);
      const sx = p.x + Math.cos(out) * (p.r + 4), sy = p.y + Math.sin(out) * (p.r + 4);
      const piece = this.place(PROP_MATERIAL[p.kind]!, sx, sy);
      if (piece) { piece.vx = Math.cos(out) * 70; piece.vy = Math.sin(out) * 70; }
      return; // one piece per swing at most
    }
  }

  private spawnNear(): void {
    if (!this.sources.length) return;
    const rng = this.host.rng, map = this.host.map;
    for (let tries = 0; tries < 8; tries++) {
      const p = map.props[this.sources[rng.int(this.sources.length)]];
      const a = rng.range(0, Math.PI * 2), dist = p.r + rng.range(6, 14);
      const x = p.x + Math.cos(a) * dist, y = p.y + Math.sin(a) * dist;
      if (map.blocked(x, y, 3)) continue;
      this.place(PROP_MATERIAL[p.kind]!, x, y, SETTLE_TIME);
      return;
    }
  }

  private place(kind: Material, x: number, y: number, age = 0): Pickup | null {
    const p = this.pickups.find((q) => !q.alive);
    if (!p) return null;
    Object.assign(p, { alive: true, kind, x, y, prevX: x, prevY: y, vx: 0, vy: 0, age });
    this.host.events.push(Ev.Drop, x, y, kind === 'wood' ? 0 : 1);
    return p;
  }

  private collect(p: Pickup): void {
    p.alive = false;
    this.host.save.materials[p.kind]++;
    this.host.events.push(Ev.Pickup, p.x, p.y, p.kind === 'wood' ? 0 : 1);
  }
}
