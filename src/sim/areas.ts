/**
 * Monster names match the rendered 3D models (see tools/blender/render_sprites.py MANIFEST).
 *
 * Areas: every 10 stages the hero moves to a new biome with its own ground, props and
 * monster roster. Stats scale with stage, so each new area's monsters are stronger.
 * After the last area the list repeats with a "+" tier (stats keep scaling).
 */

export type MonsterShape = 'blob' | 'bat' | 'husk' | 'beetle' | 'golem' | 'imp' | 'spider';
export type PropKind = 'tree' | 'pine' | 'rock' | 'cactus' | 'crystal' | 'shroom' | 'deadtree' | 'bush';

export interface MonsterPalette { m: string; l: string; d: string; e?: string }

/**
 * How a monster fights. melee: walks up and bites. dasher: winds up, then charges in a straight
 * line. spitter: keeps its distance and lobs projectiles (and still bites up close).
 */
export type MonsterStyle = 'melee' | 'dasher' | 'spitter';

export interface MonsterDef {
  name: string;
  style: MonsterStyle;
  shape: MonsterShape;
  pal: MonsterPalette;
  hp: number;        // multipliers on the stage baseline
  dmg: number;
  gold: number;
  speed: number;     // world units / second
  atkInterval: number;
  radius: number;
}

export interface AreaDef {
  name: string;
  ground: { base: string; dark: string; light: string; speck: string };
  void: string;      // colour outside the map edge
  props: { kind: PropKind; weight: number }[];
  propPal: { a: string; b: string; c: string; trunk: string };
  monsters: [MonsterDef, MonsterDef, MonsterDef];
  boss: MonsterDef;
}

// Per-shape baselines; areas override palette (and occasionally tune numbers).
const SHAPE: Record<MonsterShape, Omit<MonsterDef, 'name' | 'pal' | 'style'>> = {
  blob:   { shape: 'blob',   hp: 1.0, dmg: 1.0, gold: 1.0, speed: 34, atkInterval: 1.1, radius: 5 },
  bat:    { shape: 'bat',    hp: 0.6, dmg: 0.8, gold: 0.9, speed: 54, atkInterval: 0.8, radius: 5 },
  husk:   { shape: 'husk',   hp: 1.9, dmg: 1.4, gold: 1.6, speed: 24, atkInterval: 1.5, radius: 5 },
  beetle: { shape: 'beetle', hp: 1.5, dmg: 1.1, gold: 1.3, speed: 30, atkInterval: 1.2, radius: 6 },
  golem:  { shape: 'golem',  hp: 2.6, dmg: 1.8, gold: 2.0, speed: 18, atkInterval: 1.8, radius: 7 },
  imp:    { shape: 'imp',    hp: 0.8, dmg: 1.5, gold: 1.2, speed: 46, atkInterval: 0.9, radius: 5 },
  spider: { shape: 'spider', hp: 0.9, dmg: 1.1, gold: 1.1, speed: 50, atkInterval: 1.0, radius: 6 },
};

const STYLE: Record<MonsterShape, MonsterStyle> = {
  blob: 'melee', bat: 'dasher', husk: 'melee', beetle: 'melee', golem: 'melee', imp: 'dasher', spider: 'spitter',
};
const mon = (name: string, shape: MonsterShape, pal: MonsterPalette, style: MonsterStyle = STYLE[shape]): MonsterDef =>
  ({ ...SHAPE[shape], name, pal, style });

export const AREAS: AreaDef[] = [
  {
    name: 'Greenwood Forest',
    ground: { base: '#7ccf4f', dark: '#62b63f', light: '#9be36a', speck: '#4f9c34' },
    void: '#3f7f2e',
    props: [{ kind: 'tree', weight: 4 }, { kind: 'bush', weight: 3 }, { kind: 'rock', weight: 2 }],
    propPal: { a: '#3fae45', b: '#8fe07a', c: '#a8a8b8', trunk: '#8a5530' },
    monsters: [
      mon('Moss Blob', 'blob', { m: '#57c84d', l: '#b8f5a0', d: '#2e7d32' }),
      mon('Meadow Pigeon', 'bat', { m: '#8e5cd9', l: '#d6b8ff', d: '#4a2a80' }),
      mon('Mushnub', 'husk', { m: '#c9b79c', l: '#f3ead8', d: '#6d5a44', e: '#ff4040' }),
    ],
    boss: mon('Mushroom King', 'blob', { m: '#3fae3a', l: '#c8ff9e', d: '#1f5e22' }),
  },
  {
    name: 'Mirewood',
    ground: { base: '#5a8a4a', dark: '#46733b', light: '#6fa05a', speck: '#3a5f30' },
    void: '#1c2a1d',
    props: [{ kind: 'pine', weight: 4 }, { kind: 'shroom', weight: 3 }, { kind: 'deadtree', weight: 1 }],
    propPal: { a: '#24503a', b: '#3a7a52', c: '#c0503a', trunk: '#4a3020' },
    monsters: [
      mon('Spiky Blob', 'blob', { m: '#7a8a3a', l: '#c8d68a', d: '#424a1c' }),
      mon('Bog Glub', 'spider', { m: '#4a3a5a', l: '#8a74a6', d: '#241a30', e: '#9cff5a' }),
      mon('Mire Bee', 'beetle', { m: '#2f6f5f', l: '#6fd0b0', d: '#173a32' }),
    ],
    boss: mon('Swamp King', 'spider', { m: '#5a2a6a', l: '#c08ad6', d: '#2a1036', e: '#ff5ae0' }),
  },
  {
    name: 'Sunscar Dunes',
    ground: { base: '#f2cc7c', dark: '#dcae5c', light: '#ffe2a2', speck: '#c8964a' },
    void: '#8a6a3a',
    props: [{ kind: 'cactus', weight: 3 }, { kind: 'rock', weight: 3 }, { kind: 'deadtree', weight: 1 }],
    propPal: { a: '#4f8f45', b: '#7cc06a', c: '#b0886a', trunk: '#7a5a3a' },
    monsters: [
      mon('Cactling', 'beetle', { m: '#c08a1a', l: '#ffd86a', d: '#6a4a0a' }, 'spitter'),
      mon('Dune Dino', 'husk', { m: '#d8c09a', l: '#fff0d0', d: '#8a6a44', e: '#ffb020' }),
      mon('Sand Alpaca', 'bat', { m: '#e4572e', l: '#ffb08a', d: '#8a2a12' }),
    ],
    boss: mon('Cactus Colossus', 'beetle', { m: '#1a7aa8', l: '#7ad6ff', d: '#0a3a5a' }),
  },
  {
    name: 'Hollow Deep',
    ground: { base: '#78739a', dark: '#625d82', light: '#918cb4', speck: '#544f72' },
    void: '#1a1824',
    props: [{ kind: 'crystal', weight: 3 }, { kind: 'rock', weight: 4 }, { kind: 'shroom', weight: 1 }],
    propPal: { a: '#4fc3f7', b: '#b8ecff', c: '#7a7690', trunk: '#3a3648' },
    monsters: [
      mon('Cave Alien', 'blob', { m: '#3aa8d8', l: '#a8e8ff', d: '#1a5a7a' }),
      mon('Cave Ghost', 'bat', { m: '#6a5a7a', l: '#b0a0c0', d: '#302838' }),
      mon('Golemite', 'golem', { m: '#8a8698', l: '#c8c4d6', d: '#4a4658', e: '#5ff0ff' }),
    ],
    boss: mon('Geode Titan', 'golem', { m: '#6a4aa8', l: '#c8a8ff', d: '#2a1a5a', e: '#ffec5a' }),
  },
  {
    name: 'Frostveil',
    ground: { base: '#e8f2fc', dark: '#c8dcf0', light: '#ffffff', speck: '#a8c4e0' },
    void: '#8aa4c0',
    props: [{ kind: 'pine', weight: 4 }, { kind: 'rock', weight: 2 }, { kind: 'crystal', weight: 1 }],
    propPal: { a: '#2f5f6f', b: '#e8f4ff', c: '#9ab4cc', trunk: '#4a3a30' },
    monsters: [
      mon('Frost Yeti', 'imp', { m: '#5ab4e8', l: '#c8ecff', d: '#1a5a8a', e: '#ffffff' }),
      mon('Ice Squid', 'golem', { m: '#a8c8e0', l: '#ffffff', d: '#5a7a9a', e: '#3a8aff' }),
      mon('Snow Sprite', 'bat', { m: '#c8d8ff', l: '#ffffff', d: '#6a7ab0' }, 'spitter'),
    ],
    boss: mon('Yeti Lord', 'imp', { m: '#2a6ab0', l: '#a8d8ff', d: '#0a2a5a', e: '#ffffff' }),
  },
  {
    name: 'Emberforge Caldera',
    ground: { base: '#6a4038', dark: '#55302a', light: '#84503f', speck: '#ff7a3a' },
    void: '#1a0c0c',
    props: [{ kind: 'deadtree', weight: 2 }, { kind: 'rock', weight: 3 }, { kind: 'crystal', weight: 2 }],
    propPal: { a: '#e4572e', b: '#ffb03a', c: '#5a4040', trunk: '#2a1a1a' },
    monsters: [
      mon('Cinder Orc', 'imp', { m: '#e4572e', l: '#ffb08a', d: '#7a1a0a', e: '#ffec5a' }),
      mon('Bone Brute', 'golem', { m: '#5a3a3a', l: '#ff8a3a', d: '#2a1414', e: '#ffec5a' }),
      mon('Ember Demon', 'husk', { m: '#7a7070', l: '#b8b0b0', d: '#3a3434', e: '#ff5a1a' }, 'spitter'),
    ],
    boss: mon('Forge Dragon', 'golem', { m: '#3a2020', l: '#ffcf4a', d: '#1a0a0a', e: '#ff3a1a' }),
  },
];

export function areaFor(index: number): { def: AreaDef; tier: number } {
  return { def: AREAS[index % AREAS.length], tier: Math.floor(index / AREAS.length) };
}

export function areaName(index: number): string {
  const { def, tier } = areaFor(index);
  return tier === 0 ? def.name : `${def.name} ${'+'.repeat(Math.min(tier, 3))}${tier > 3 ? tier : ''}`;
}
