/**
 * Procedural sound effects via the Web Audio API: no audio files to download, tiny footprint.
 * Each effect is a few oscillator/noise nodes with short envelopes. Per-sound throttling and a
 * voice cap keep busy fights from turning into noise (and from costing CPU).
 *
 * Browsers (iOS especially) only allow audio after a user gesture, so the context is created
 * lazily on the first tap/click/key via `unlock()`.
 */

export type SoundName =
  | 'swing' | 'hit' | 'crit' | 'kill' | 'coin' | 'shard' | 'hurt' | 'die' | 'boss' | 'bossKill'
  | 'stage' | 'area' | 'forge' | 'merge' | 'achieve' | 'tick' | 'zap' | 'shoot' | 'cast' | 'burst';

const MIN_GAP: Partial<Record<SoundName, number>> = {
  swing: 0.06, hit: 0.045, crit: 0.06, kill: 0.05, coin: 0.07, shard: 0.09, hurt: 0.12, zap: 0.08, tick: 0.03, shoot: 0.06, cast: 0.06, burst: 0.06,
};
const MAX_VOICES = 14;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SoundName, number>();
  private voices = 0;
  enabled = true;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // Gentle limiter so stacked effects never clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // iOS also wants a sound actually started inside the gesture: play one silent sample.
    try {
      const b = this.ctx.createBufferSource();
      b.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      b.connect(this.ctx.destination);
      b.start(0);
    } catch { /* ignore */ }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => { /* retried on next gesture */ });
  }

  /** True once the browser has actually let audio start. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Pause the audio thread entirely while the game is hidden (saves battery). */
  suspend(): void { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  // `state` can also be 'interrupted' on iOS (calls, Siri), so resume anything not running.
  resume(): void { if (this.ctx && this.ctx.state !== 'running' && this.enabled) void this.ctx.resume().catch(() => { /* next tap retries */ }); }

  play(name: SoundName, intensity = 1): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0;
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);

    switch (name) {
      case 'swing': this.noiseSweep(now, 0.09, 1800, 500, 0.12 * intensity, 'bandpass'); break;
      case 'hit': this.tone(now, 'triangle', 240, 110, 0.07, 0.22); this.noiseSweep(now, 0.03, 3000, 1500, 0.08, 'highpass'); break;
      case 'crit': this.tone(now, 'square', 700, 260, 0.1, 0.16); this.noiseSweep(now, 0.06, 4000, 1200, 0.14, 'highpass'); break;
      case 'kill': this.tone(now, 'sine', 420, 880, 0.09, 0.18); break;
      case 'coin': this.tone(now, 'square', 1320, 1320, 0.05, 0.05); this.tone(now + 0.05, 'square', 1760, 1760, 0.08, 0.05); break;
      case 'shard': this.tone(now, 'triangle', 1100, 1650, 0.12, 0.12); this.tone(now + 0.06, 'sine', 2200, 2200, 0.1, 0.06); break;
      case 'hurt': this.tone(now, 'sawtooth', 160, 70, 0.14, 0.12); break;
      case 'die': this.tone(now, 'sawtooth', 300, 40, 0.6, 0.2); this.noiseSweep(now, 0.5, 800, 100, 0.15, 'lowpass'); break;
      case 'zap': this.tone(now, 'sawtooth', 1400, 300, 0.08, 0.08); this.noiseSweep(now, 0.08, 6000, 2000, 0.08, 'highpass'); break;
      case 'boss': this.tone(now, 'sawtooth', 70, 55, 0.9, 0.22); this.tone(now, 'square', 104, 82, 0.9, 0.1); this.noiseSweep(now, 0.8, 400, 120, 0.18, 'lowpass'); break;
      case 'bossKill': this.arp(now, [392, 523, 659, 784, 1047], 0.07, 'square', 0.12); this.noiseSweep(now, 0.4, 2000, 200, 0.15, 'lowpass'); break;
      case 'stage': this.arp(now, [523, 659, 784], 0.07, 'triangle', 0.16); break;
      case 'area': this.arp(now, [392, 494, 587, 784, 988], 0.09, 'triangle', 0.16); break;
      case 'forge': this.tone(now, 'square', 880, 860, 0.25, 0.08); this.tone(now, 'triangle', 1320, 1300, 0.35, 0.1); this.noiseSweep(now, 0.05, 5000, 3000, 0.12, 'highpass'); break;
      case 'merge': this.tone(now, 'sine', 400, 1200, 0.22, 0.18); this.tone(now + 0.12, 'triangle', 1200, 1600, 0.15, 0.1); break;
      case 'achieve': this.arp(now, [784, 988, 1175, 1568], 0.08, 'square', 0.09); break;
      case 'tick': this.tone(now, 'sine', 1000, 900, 0.025, 0.06); break;
      // Bowstring twang / crossbow thunk, a spell's whoosh, and a magic orb popping.
      case 'shoot': this.tone(now, 'triangle', 520, 180, 0.08, 0.12 * intensity); this.noiseSweep(now, 0.06, 2600, 900, 0.07 * intensity, 'bandpass'); break;
      case 'cast': this.tone(now, 'sine', 300, 900, 0.12, 0.1 * intensity); this.noiseSweep(now, 0.1, 1200, 4000, 0.05 * intensity, 'bandpass'); break;
      case 'burst': this.tone(now, 'sine', 500, 120, 0.16, 0.14); this.noiseSweep(now, 0.14, 3000, 400, 0.1, 'lowpass'); break;
    }
  }

  private track(node: AudioScheduledSourceNode): void {
    this.voices++;
    node.onended = () => { this.voices--; };
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    this.track(o);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseSweep(t: number, dur: number, f0: number, f1: number, vol: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    this.track(src);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private arp(t: number, notes: number[], step: number, type: OscillatorType, vol: number): void {
    notes.forEach((n, i) => this.tone(t + i * step, type, n, n, step * 1.8, vol));
  }
}

export const sfx = new Sfx();

/** Light vibration on supporting devices (Android; iOS Safari ignores it). */
export function haptic(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}
