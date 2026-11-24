import { fmt } from '../core/format';
import { sfx } from '../audio/sfx';
import { ACHIEVEMENTS, ACH_BONUS_PER_TIER, ROMAN, achGoal, questText } from '../sim/meta';
import type { Sim } from '../sim/sim';
import { rewardSpill } from './rewardFx';
import { Pager, bindSegments } from './pager';

/** Quests tab: three rolling quests with Claim buttons, then the achievement list. */
export class QuestPanel {
  private readonly cache = new Map<HTMLElement, string>();
  private readonly questRows: { root: HTMLElement; text: HTMLElement; fill: HTMLElement; prog: HTMLElement; reward: HTMLElement; btn: HTMLButtonElement }[] = [];
  private readonly achRows: { name: HTMLElement; goal: HTMLElement; fill: HTMLElement; tier: HTMLElement }[] = [];
  private readonly bonus: HTMLElement;
  private readonly pager: Pager;

  constructor(root: HTMLElement, private readonly sim: Sim) {
    root.innerHTML = `
      <div class="seg" role="tablist">
        <button type="button" role="tab" data-seg="q" class="on" aria-selected="true">Quests</button>
        <button type="button" role="tab" data-seg="a" aria-selected="false">Achievements</button>
      </div>
      <div data-seg-page="q"><ul class="quest-list"></ul></div>
      <div data-seg-page="a" hidden><ul class="ach-list paged"></ul><div class="page-foot"><span class="ach-bonus"></span></div></div>`;
    bindSegments(root, () => this.refresh());
    this.bonus = root.querySelector('.ach-bonus')!;
    const ql = root.querySelector('.quest-list')!;
    for (let i = 0; i < sim.save.quests.length; i++) {
      const li = document.createElement('li');
      li.className = 'quest';
      li.innerHTML = `
        <div class="q-main">
          <div class="q-text"></div>
          <div class="bar"><div class="bar-fill"></div><span class="bar-text"></span></div>
          <div class="q-reward"></div>
        </div>
        <button type="button" class="btn small primary">Claim</button>`;
      const btn = li.querySelector<HTMLButtonElement>('button')!;
      btn.addEventListener('click', () => {
        const q = sim.save.quests[i];
        const reward = q ? { gold: q.gold, shards: q.shards } : null;
        if (sim.claimQuest(i)) { sfx.play('coin'); sfx.play('shard'); if (reward) rewardSpill(reward, btn); this.refresh(); }
      });
      ql.appendChild(li);
      this.questRows.push({
        root: li, text: li.querySelector('.q-text')!, fill: li.querySelector('.bar-fill')!,
        prog: li.querySelector('.bar-text')!, reward: li.querySelector('.q-reward')!, btn,
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
    this.pager = new Pager(al, 6);
    root.querySelector('.page-foot')!.append(this.pager.el);
    this.pager.update();
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  private bar(el: HTMLElement, frac: number): void {
    const v = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`;
    if (this.cache.get(el) === v) return;
    this.cache.set(el, v);
    el.style.transform = v;
  }

  refresh(): void {
    const sim = this.sim, s = sim.save;
    s.quests.forEach((q, i) => {
      const r = this.questRows[i];
      if (!r) return;
      const p = Math.min(q.target, sim.questProgress(q));
      const done = p >= q.target;
      this.set(r.text, questText(q));
      this.set(r.prog, `${fmt(p)} / ${fmt(q.target)}`);
      this.bar(r.fill, p / q.target);
      this.set(r.reward, `Reward: ${q.gold > 0 ? `${fmt(q.gold)} gold · ` : ''}${fmt(q.shards)} shards`);
      if (r.btn.disabled === done) r.btn.disabled = !done;
      r.root.classList.toggle('done', done);
    });

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
    const n = this.sim.save.quests.filter((q) => this.sim.questDone(q)).length;
    return n ? String(n) : '';
  }
}
