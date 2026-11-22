import type { Scene } from '../render/scene';
import type { Sim } from '../sim/sim';

const JOY_RADIUS = 46;   // px the knob can travel
const DEADZONE = 0.12;
const FULL_SPEED_AT = 0.4;  // fraction of JOY_RADIUS at which the hero reaches full speed
const MIN_SPEED = 0.55;     // speed just outside the dead zone

/**
 * Player controls over the battlefield:
 *  - Touch: floating virtual joystick — press anywhere, drag to move, release to stop.
 *  - Mouse: click (or hold and drag) to walk toward the pointer.
 *  - Keyboard: WASD / arrow keys.
 * With no input for a moment, the sim's auto-hunt takes over (if enabled).
 */
export class Input {
  private joyId: number | null = null;
  private mouseId: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly keys = new Set<string>();
  private readonly world = { x: 0, y: 0 };
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly marker: HTMLElement;

  constructor(private readonly surface: HTMLElement, private readonly sim: Sim, private readonly scene: Scene) {
    this.base = document.createElement('div');
    this.base.className = 'joy';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    this.marker = document.createElement('div');
    this.marker.className = 'move-marker';
    surface.append(this.base, this.marker);

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => { this.keys.clear(); this.applyKeys(); });
  }

  private capture(id: number): void {
    // Keeps receiving moves if the finger/mouse leaves the battlefield; harmless if unsupported.
    try { this.surface.setPointerCapture(id); } catch { /* ignore */ }
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.surface.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent) => {
    // Let HUD buttons on top of the battlefield handle their own taps.
    if ((e.target as HTMLElement).closest('button')) return;
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      this.mouseId = e.pointerId;
      this.capture(e.pointerId);
      this.walkTo(p.x, p.y, true);
      return;
    }
    if (this.joyId !== null) return;
    this.joyId = e.pointerId;
    this.capture(e.pointerId);
    this.ox = p.x; this.oy = p.y;
    this.base.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.add('show');
    e.preventDefault();
  };

  private readonly onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (e.pointerId === this.mouseId) { this.walkTo(p.x, p.y, false); return; }
    if (e.pointerId !== this.joyId) return;
    let dx = p.x - this.ox, dy = p.y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      // Drag past the rim: the base follows the finger, so reversing direction is instant
      // instead of having to drag all the way back across the stick.
      this.ox += dx - (dx * JOY_RADIUS) / d;
      this.oy += dy - (dy * JOY_RADIUS) / d;
      this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
      dx *= JOY_RADIUS / d; dy *= JOY_RADIUS / d;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, d / JOY_RADIUS);
    if (mag < DEADZONE) { this.sim.setMove(0, 0); return; }
    // Short drags already run: full speed from FULL_SPEED_AT of the radius, with a small
    // walk band just past the dead zone for fine positioning.
    const k = Math.min(1, MIN_SPEED + ((1 - MIN_SPEED) * (mag - DEADZONE)) / (FULL_SPEED_AT - DEADZONE));
    this.sim.setMove((dx / (d || 1)) * k, (dy / (d || 1)) * k);
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId === this.mouseId) { this.mouseId = null; return; }
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    this.base.classList.remove('show');
    this.sim.setMove(0, 0);
  };

  private walkTo(sx: number, sy: number, showMarker: boolean): void {
    this.scene.screenToWorld(sx, sy, this.world);
    this.sim.moveTo(this.world.x, this.world.y);
    if (showMarker) {
      this.marker.style.transform = `translate(${sx}px, ${sy}px)`;
      this.marker.classList.remove('show');
      void this.marker.offsetWidth; // restart the ping animation
      this.marker.classList.add('show');
    }
  }

  private readonly onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    if ((e.target as HTMLElement).closest?.('input, textarea')) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(k); else this.keys.delete(k);
    this.applyKeys();
  };

  private applyKeys(): void {
    const has = (a: string, b: string) => this.keys.has(a) || this.keys.has(b);
    const x = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
    const y = (has('s', 'arrowdown') ? 1 : 0) - (has('w', 'arrowup') ? 1 : 0);
    if (this.joyId === null) this.sim.setMove(x, y);
  }
}
