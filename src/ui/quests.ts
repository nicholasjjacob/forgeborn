import { fmt } from '../core/format';
import { sfx } from '../audio/sfx';
import { ACHIEVEMENTS, ACH_BONUS_PER_TIER, ROMAN, achGoal } from '../sim/meta';
import { BIOMES, zoneBiome } from '../sim/forest';
import {
  MASTERY_BONUS, MILESTONES, STARS_PER_REGION, masteredRegions, milestoneReward, questGoal, regionLockText, regionName,
  regionQuests, regionStars, tierReward,
} from '../sim/regionQuests';
import { PLAYABLE_ZONES, zoneLevel } from '../sim/zones';
import type { Sim } from '../sim/sim';
import { chips } from './missions';
import { rewardSpill } from './rewardFx';
import { Pager, bindSegments } from './pager';

interface QuestRow { root: HTMLElement; name: HTMLElement; pips: HTMLElement; goal: HTMLElement; fill: HTMLElement; prog: HTMLElement; reward: HTMLElement; btn: HTMLButtonElement }
interface MileCell { root: HTMLElement; need: HTMLElement; reward: HTMLElement; btn: HTMLButtonElement }
interface RegionCard { root: HTMLButtonElement; stars: HTMLElement; fill: HTMLElement; lv: HTMLElement; badge: HTMLElement }

/**
 * Quests tab, the Quest Book: every region's quest ladder (hunt its monsters, its elites, its boss,
 * explore it), each with three tiers that earn stars, and star milestones per region. Opens on the
 * region the hero is in; "All regions" shows the nine as a 3×3 board. The second half lists the
 * achievements.
 */
export class QuestPanel {
  private readonly cache = new Map<HTMLElement, string>();
  private readonly achRows: { name: HTMLElement; goal: HTMLElement; fill: HTMLElement; tier: HTMLElement }[] = [];
  private readonly bonus: HTMLElement;
  private readonly pager: Pager;
  private readonly board: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly cards: RegionCard[] = [];
  private readonly rows: QuestRow[] = [];
  private readonly miles: MileCell[] = [];
  private readonly head: { name: HTMLElement; sub: HTMLElement; stars: HTMLElement; swatch: HTMLElement };
  private readonly total: HTMLElement;
  /** The region shown in detail, or -1 for the board. */
  private view = -1;
  private shownZone = -1;
  private builtFor = -1;

  constructor(root: HTMLElement, private readonly sim: Sim) {
    root.innerHTML = `
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-seg="q" class="on" aria-selected="true">Regions</button>
        <button type="button" role="tab" data-seg="a" aria-selected="false">Achievements</button>
      </div>
      <div data-seg-page="q" class="qb">
        <div class="qb-board" hidden>
          <div class="qb-grid"></div>
          <div class="page-foot"><span class="qb-total"></span></div>
        </div>
        <div class="qb-detail">
          <div class="qb-head">
            <button type="button" class="qb-back" aria-label="All regions">‹ All</button>
            <span class="qb-swatch"></span>
            <div class="qb-title"><b class="qb-name"></b><span class="qb-sub"></span></div>
            <span class="qb-stars"></span>
          </div>
          <div class="qb-miles"></div>
          <ul class="qb-quests"></ul>
        </div>
      </div>
      <div data-seg-page="a" hidden><ul class="ach-list paged"></ul><div class="page-foot"><span class="ach-bonus"></span></div></div>`;
    bindSegments(root, () => this.refresh());
    this.board = root.querySelector('.qb-board')!;
    this.detail = root.querySelector('.qb-detail')!;
    this.total = root.querySelector('.qb-total')!;
    this.head = {
      name: root.querySelector('.qb-name')!, sub: root.querySelector('.qb-sub')!,
      stars: root.querySelector('.qb-stars')!, swatch: root.querySelector('.qb-swatch')!,
    };
    root.querySelector('.qb-back')!.addEventListener('click', () => { sfx.play('tick'); this.show(-1); });

    // The board: the nine region cards (3×3), in the order they open.
    const grid = root.querySelector('.qb-grid')!;
    for (let z = 0; z < PLAYABLE_ZONES; z++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qb-region';
      b.style.setProperty('--rc', BIOMES[zoneBiome(z)].map);
      b.innerHTML = `<span class="qbr-name"></span><span class="qbr-lv"></span><span class="qbr-stars"></span><div class="bar thin"><div class="bar-fill"></div></div><span class="badge"></span>`;
      b.querySelector('.qbr-name')!.textContent = regionName(z);
      b.addEventListener('click', () => { sfx.play('tick'); this.show(z); });
      grid.appendChild(b);
      this.cards.push({ root: b, stars: b.querySelector('.qbr-stars')!, fill: b.querySelector('.bar-fill')!, lv: b.querySelector('.qbr-lv')!, badge: b.querySelector('.badge')! });
    }

    // Milestones: three cells (stars needed, reward, claim).
    const ml = root.querySelector('.qb-miles')!;
    for (let i = 0; i < MILESTONES.length; i++) {
      const c = document.createElement('div');
      c.className = 'qb-mile';
      c.innerHTML = `<span class="qbm-need"></span><span class="qbm-reward"></span><button type="button" class="btn small primary">Claim</button>`;
      const btn = c.querySelector('button')!;
      btn.addEventListener('click', () => {
        const r = this.sim.claimRegionMilestone(this.view, i);
        if (r) { sfx.play('achieve'); rewardSpill(r, btn); this.refresh(); }
      });
      ml.appendChild(c);
      this.miles.push({ root: c, need: c.querySelector('.qbm-need')!, reward: c.querySelector('.qbm-reward')!, btn });
    }

    // The region's six quests.
    const ql = root.querySelector('.qb-quests')!;
    for (let qi = 0; qi < 6; qi++) {
      const li = document.createElement('li');
      li.className = 'rq';
      li.innerHTML = `
        <div class="rq-main">
          <div class="rq-top"><span class="rq-name"></span><span class="rq-pips"></span></div>
          <div class="rq-goal"></div>
          <div class="bar"><div class="bar-fill"></div><span class="bar-text"></span></div>
        </div>
        <div class="rq-side"><div class="rq-reward"></div><button type="button" class="btn small primary">Claim</button></div>`;
      const btn = li.querySelector('button')!;
      btn.addEventListener('click', () => {
        const r = this.sim.claimRegionQuest(this.view, qi);
        if (r) { sfx.play('coin'); sfx.play('shard'); rewardSpill(r, btn); this.refresh(); }
      });
      ql.appendChild(li);
      this.rows.push({
        root: li, name: li.querySelector('.rq-name')!, pips: li.querySelector('.rq-pips')!, goal: li.querySelector('.rq-goal')!,
        fill: li.querySelector('.bar-fill')!, prog: li.querySelector('.bar-text')!, reward: li.querySelector('.rq-reward')!, btn,
      });
    }

    const al = root.querySelector<HTMLElement>('.ach-list')!;
    for (const a of ACHIEVEMENTS) {
      const li = document.createElement('li');
      li.className = 'ach';
      li.innerHTML = `<span class="ach-tier"></span><div class="ach-main"><div class="ach-name"></div><div class="ach-goal"></div><div class="bar thin"><div class="bar-fill"></div></div></div>`;
      li.querySelector('.ach-name')!.textContent = a.name;
      al.appendChild(li);
      this.achRows.push({ name: li.querySelector('.ach-name')!, goal: li.querySelector('.ach-goal')!, fill: li.querySelector('.bar-fill')!, tier: li.querySelector('.ach-tier')! });
    }
    this.bonus = root.querySelector('.ach-bonus')!;
    this.pager = new Pager(al, 8);
    root.querySelector('[data-seg-page="a"] .page-foot')!.append(this.pager.el);
    this.pager.update();
  }

  /** Show a region's quests (or the board for -1). */
  private show(zone: number): void {
    this.view = zone;
    this.board.hidden = zone >= 0;
    this.detail.hidden = zone < 0;
    this.refresh();
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  private html(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  private bar(el: HTMLElement, frac: number): void {
    const v = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    if (this.cache.get(el) === v) return;
    this.cache.set(el, v);
    el.style.transform = v;
  }

  refresh(): void {
    const sim = this.sim, s = sim.save;
    // Follow the hero: whenever they've moved to another region, open on that one.
    if (s.zone !== this.shownZone) { this.shownZone = s.zone; this.view = Math.min(s.zone, PLAYABLE_ZONES - 1); this.board.hidden = true; this.detail.hidden = false; }
    if (this.view < 0) this.refreshBoard(); else this.refreshRegion(this.view);
    this.refreshAchievements();
  }

  private refreshBoard(): void {
    const sim = this.sim, s = sim.save;
    let stars = 0;
    for (let z = 0; z < PLAYABLE_ZONES; z++) {
      const c = this.cards[z], r = s.regions[z], open = sim.regionOpen(z);
      const st = regionStars(r);
      stars += st;
      const mastered = r.milestones >= MILESTONES.length;
      this.set(c.stars, mastered ? `👑 ${st}/${STARS_PER_REGION}` : `★ ${st}/${STARS_PER_REGION}`);
      this.set(c.lv, open ? (z === s.zone ? 'You are here' : `Lv ${zoneLevel(z)}`) : `🔒 Lv ${zoneLevel(z)}`);
      this.bar(c.fill, st / STARS_PER_REGION);
      c.root.classList.toggle('locked', !open);
      c.root.classList.toggle('here', z === s.zone);
      c.root.classList.toggle('mastered', mastered);
      const n = sim.regionClaimable(z);
      this.set(c.badge, n ? String(n) : '');
      c.badge.classList.toggle('show', n > 0);
    }
    const m = masteredRegions(s.regions);
    this.set(this.total, `★ ${stars}/${STARS_PER_REGION * PLAYABLE_ZONES} stars · ${m} mastered${m ? ` (+${Math.round(m * MASTERY_BONUS * 100)}% dmg & gold)` : ''}`);
  }

  private refreshRegion(z: number): void {
    const sim = this.sim, r = sim.save.regions[z], open = sim.regionOpen(z);
    if (this.builtFor !== z) {
      this.builtFor = z;
      this.head.swatch.style.background = BIOMES[zoneBiome(z)].map;
      this.set(this.head.name, regionName(z));
    }
    const stars = regionStars(r);
    this.set(this.head.sub, open ? `Lv ${zoneLevel(z)} region${z === sim.save.zone ? ' · you are here' : ''}` : `🔒 ${regionLockText(z)}`);
    this.set(this.head.stars, `★ ${stars}/${STARS_PER_REGION}`);
    this.detail.classList.toggle('locked', !open);

    MILESTONES.forEach((m, i) => {
      const c = this.miles[i], got = r.milestones > i, ready = sim.canClaimRegionMilestone(z, i);
      const def = milestoneReward(z, i);
      this.set(c.need, m.mastery ? `👑 ${m.stars}★ Mastery` : `${m.stars}★`);
      this.html(c.reward, chips(def.reward) + (m.mastery ? `<span class="qbm-bonus">+${Math.round(MASTERY_BONUS * 100)}% dmg & gold</span>` : ''));
      c.root.classList.toggle('got', got);
      c.root.classList.toggle('ready', ready);
      c.btn.hidden = !ready;
    });

    const quests = regionQuests(z);
    quests.forEach((q, qi) => {
      const row = this.rows[qi], tier = r.claimed[qi], maxed = tier >= q.tiers.length;
      const v = sim.regionQuestValue(z, qi);
      this.set(row.name, q.name);
      // One star glyph for both states (☆ comes from another font: other size, hard to read).
      this.html(row.pips, q.tiers.map((_, i) => `<i class="pip${i < tier ? ' on' : ''}">★</i>`).join(''));
      row.root.classList.toggle('maxed', maxed);
      if (maxed) {
        this.set(row.goal, `${questGoal(q, q.tiers.length - 1)} · complete`);
        this.set(row.prog, 'Complete');
        this.bar(row.fill, 1);
        this.html(row.reward, '');
        row.btn.hidden = true;
        row.root.classList.remove('done');
        return;
      }
      const goal = q.tiers[tier];
      const unit = q.pct ? '%' : '';
      this.set(row.goal, `${ROMAN[tier + 1]} · ${questGoal(q, tier)}`);
      this.set(row.prog, `${fmt(Math.min(v, goal))}${unit} / ${fmt(goal)}${unit}`);
      this.bar(row.fill, v / goal);
      this.html(row.reward, chips(tierReward(z, tier)));
      const can = sim.canClaimRegionQuest(z, qi);
      row.btn.hidden = !can;
      row.root.classList.toggle('done', can);
    });
  }

  private refreshAchievements(): void {
    const sim = this.sim, s = sim.save;
    let tiers = 0;
    ACHIEVEMENTS.forEach((a, i) => {
      const r = this.achRows[i];
      const tier = s.achievements[a.id] ?? 0;
      tiers += tier;
      const maxed = tier >= a.tiers.length;
      this.set(r.tier, maxed ? '★' : ROMAN[tier] || '–');
      r.tier.classList.toggle('maxed', maxed);
      if (maxed) { this.set(r.goal, 'Complete'); this.bar(r.fill, 1); return; }
      const goal = a.tiers[tier];
      const v = sim.statValue(a.stat);
      this.set(r.goal, `${achGoal(a, tier)} · ${fmt(Math.min(v, goal))}/${fmt(goal)}`);
      this.bar(r.fill, v / goal);
    });
    this.set(this.bonus, `Bonus: +${Math.round(tiers * ACH_BONUS_PER_TIER * 100)}% damage & gold`);
  }

  badge(): string {
    const n = this.sim.questBadge();
    return n ? String(n) : '';
  }
}
