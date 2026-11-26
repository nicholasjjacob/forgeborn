import { zoneLevel } from '../src/sim/zones';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/core/save';
import { ACHIEVEMENTS, PERKS, REFORGE_MIN_STAGE, embersFor } from '../src/sim/meta';
import { Sim, freshSave } from '../src/sim/sim';

const tickN = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) { sim.tick(); sim.events.clear(); } };

describe('reforge', () => {
  it('pays nothing below the unlock stage and more for deeper runs', () => {
    expect(embersFor(REFORGE_MIN_STAGE - 1)).toBe(0);
    expect(embersFor(REFORGE_MIN_STAGE)).toBeGreaterThan(0);
    for (let s = REFORGE_MIN_STAGE; s < 300; s++) expect(embersFor(s + 1)).toBeGreaterThanOrEqual(embersFor(s));
  });

  it('resets the run but keeps embers, perks, achievements and lifetime stats', () => {
    const save = freshSave();
    Object.assign(save, { stage: 47, highestStage: 50, bestEver: 50, gold: 1e6, shards: 300, forgeLevel: 6, kills: 5000 });
    save.upgrades.atk = 80;
    save.weapons[0] = { id: 77, rarity: 2, form: 1, traits: [] };
    save.perks.might = 3;
    save.achievements.slayer = 2;
    const sim = new Sim(save, 1);
    const gain = sim.reforge();
    expect(gain).toBe(embersFor(50));
    expect(save.embers).toBe(gain);
    expect(save.embersEarned).toBe(gain);
    expect(save.stage).toBe(1);
    expect(save.highestStage).toBe(1);
    expect(save.gold).toBe(0);
    expect(save.shards).toBe(0);
    expect(save.upgrades.atk).toBe(0);
    expect(save.weapons.every((w) => w === null)).toBe(true);
    expect(save.equipped?.rarity).toBe(0);
    expect(save.forgeLevel).toBe(1);
    expect(save.perks.might).toBe(3);
    expect(save.achievements.slayer).toBeGreaterThanOrEqual(2);
    expect(save.kills).toBe(5000);
    expect(save.stats.reforges).toBe(1);
    expect(sim.area).toBe(0);
  });

  it('refuses to reforge before the unlock stage', () => {
    const sim = new Sim(freshSave(), 2);
    expect(sim.reforge()).toBe(0);
    expect(sim.save.stats.reforges).toBe(0);
  });

  it('head start and forgemaster perks shape the next run', () => {
    const save = freshSave();
    Object.assign(save, { stage: 40, highestStage: 40, bestEver: 40, zone: 9, zoneBosses: 12, level: 60 });
    save.perks.headstart = 4; // start at hero level 21, with the zone bosses below it beaten
    save.perks.forgemaster = 3;
    const sim = new Sim(save, 3);
    sim.reforge();
    expect(save.level).toBe(21);
    expect(sim.maxZone).toBeGreaterThan(0);
    expect(zoneLevel(sim.maxZone)).toBeLessThanOrEqual(21);
    expect(save.zone).toBe(sim.maxZone);
    expect(save.forgeLevel).toBe(4);
  });

  it('ember glow and perks raise damage and HP', () => {
    const sim = new Sim(freshSave(), 4);
    const atk = sim.atk, hp = sim.hero.maxHp;
    sim.save.embers = 1000;
    sim.buyPerk('might');
    sim.buyPerk('vigor');
    expect(sim.atk).toBeCloseTo(atk * 1.25, 6);
    expect(sim.hero.maxHp).toBeCloseTo(hp * 1.25, 6);
    sim.save.embersEarned = 50;
    sim.recalc();
    expect(sim.atk).toBeCloseTo(atk * 1.25 * 2, 6);
  });

  it('perk purchases spend embers and respect max level', () => {
    const sim = new Sim(freshSave(), 5);
    sim.save.embers = 1e9;
    for (let i = 0; i < 50; i++) sim.buyPerk('swift');
    expect(sim.save.perks.swift).toBe(PERKS.swift.maxLevel);
    expect(sim.perkQuote('swift')).toBe(Infinity);
  });
});


describe('achievements', () => {
  it('unlock tiers from lifetime stats and add a damage bonus', () => {
    const sim = new Sim(freshSave(), 7);
    const atk = sim.atk;
    sim.save.kills = 1500; // Slayer I and II
    tickN(sim, 20);
    expect(sim.save.achievements.slayer).toBe(2);
    expect(sim.atk).toBeGreaterThan(atk * 1.05);
    expect(sim.notices.some((n) => n.includes('Slayer'))).toBe(true);
  });

  it('every achievement has ascending tiers', () => {
    for (const a of ACHIEVEMENTS) for (let i = 1; i < a.tiers.length; i++) expect(a.tiers[i]).toBeGreaterThan(a.tiers[i - 1]);
  });

  it('v2 saves migrate to the current version with best-ever and empty meta', () => {
    const s = migrate({ v: 2, stage: 33, highestStage: 41, gold: 5 });
    expect(s.v).toBe(7);
    expect(s.bestEver).toBe(41);
    expect(s.embers).toBe(0);
    expect(s.stats.bosses).toBe(0);
  });
});

describe('hero skins', () => {
  it('starts with the knight, buys skins with gems, keeps them through reforge', () => {
    const sim = new Sim(freshSave());
    expect(sim.save.skin).toBe('knight');
    expect(sim.buySkin('barbarian')).toBe(false); // no gems
    sim.save.missions.gems = 200;
    expect(sim.buySkin('barbarian')).toBe(true);
    expect(sim.save.missions.gems).toBe(50);
    expect(sim.save.skin).toBe('barbarian');
    expect(sim.buySkin('barbarian')).toBe(false); // already owned
    expect(sim.selectSkin('mage')).toBe(false);   // not owned
    expect(sim.selectSkin('knight')).toBe(true);
    // A save from before the first-launch hero choice always started as the Knight: it keeps it.
    const old = JSON.parse(JSON.stringify({ ...sim.save, skin: 'ghost', skins: ['barbarian'] }));
    delete old.starterChosen;
    const back = migrate(old);
    expect(back.skins).toEqual(['knight', 'barbarian']);
    expect(back.skin).toBe('knight');
  });
});
