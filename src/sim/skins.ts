/**
 * Hero skins: which 3D character the hero is drawn as. Purely cosmetic. The Knight is free;
 * the rest are bought with gems in the Heroes screen. New skins are added here (plus a
 * public/models/hero_<id>.glb on the shared rig, see scripts/build-heroes.mjs).
 */

export interface SkinDef {
  id: string;
  name: string;
  blurb: string;
  /** Gem price; 0 = owned from the start. */
  cost: number;
}

export const SKINS: readonly SkinDef[] = [
  { id: 'knight', name: 'Knight', blurb: 'Plate armour, a crested helm and a red cape.', cost: 0 },
  { id: 'barbarian', name: 'Barbarian', blurb: 'Bear-skin hat, bare arms, big attitude.', cost: 150 },
  { id: 'rogue', name: 'Rogue', blurb: 'Light leathers for quick work.', cost: 150 },
  { id: 'ranger', name: 'Ranger', blurb: 'A woodland scout in a green hood.', cost: 250 },
  { id: 'mage', name: 'Mage', blurb: 'Robes, a tall hat and a sword anyway.', cost: 250 },
  { id: 'rogue_hooded', name: 'Shadow Rogue', blurb: 'The rogue, hooded and masked.', cost: 400 },
];

export const DEFAULT_SKIN = 'knight';

export function skinDef(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
