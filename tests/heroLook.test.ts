import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyBonesLooks } from '../src/render/heroLook';

const part = (name: string) => { const m = new THREE.Mesh(); m.name = name; return m; };

describe('skeleton styles', () => {
  it('Knight armour swaps the bones for the armour pieces', () => {
    const suit = ['Knight_Body', 'Knight_Cape', 'Knight_ArmLeft', 'Knight_ArmRight', 'Knight_LegLeft', 'Knight_LegRight'];
    const root = new THREE.Group().add(part('Skeleton_Minion_Body'), ...suit.map(part));
    applyBonesLooks(root, 'knight', { 'bonesfit:knight': 'armour' });
    expect(root.getObjectByName('Skeleton_Minion_Body')!.visible).toBe(false);
    expect(root.getObjectByName('Knight_Body')!.visible).toBe(true);
  });

  it('a model without the armour pieces (an old copy) keeps its body instead of vanishing', () => {
    const root = new THREE.Group().add(part('Skeleton_Minion_Body'), part('Skeleton_Minion_ArmLeft'));
    applyBonesLooks(root, 'knight', { 'bonesfit:knight': 'armour', 'bones:knight': 'helm' });
    expect(root.getObjectByName('Skeleton_Minion_Body')!.visible).toBe(true);
    expect(root.getObjectByName('Skeleton_Minion_ArmLeft')!.visible).toBe(true);
  });
});
