import type { ActiveDevice } from '../input/actions.ts';

export interface HudInfo {
  /** m/s */
  speed: number;
  /** -1..1 actual (ramped) throttle. */
  throttle: number;
  boosting: boolean;
  device: ActiveDevice;
}

const MS_TO_KNOTS = 1.943844;

/** Prompts per device (§11.2). Swap instantly with the active device. */
const PROMPTS: Record<ActiveDevice, [keys: string, label: string][]> = {
  kbm: [
    ['W / S', 'Throttle'],
    ['A / D', 'Steer'],
    ['Shift', 'Boost'],
    ['Drag mouse', 'Look'],
  ],
  gamepad: [
    ['RT / LT', 'Throttle'],
    ['LS', 'Steer'],
    ['A', 'Boost'],
    ['RS', 'Look'],
  ],
};

/** Driving HUD: speed, throttle and control prompts. DOM, over the canvas. */
export class Hud {
  private readonly el = document.createElement('div');
  private readonly speed = document.createElement('div');
  private readonly throttleFill = document.createElement('div');
  private readonly prompts = document.createElement('div');
  private shown = { knots: -1, throttle: Number.NaN, boosting: false, device: '' };

  constructor(root: HTMLElement) {
    this.el.className = 'hud';
    this.speed.className = 'hud-speed';
    const bar = document.createElement('div');
    bar.className = 'hud-throttle';
    this.throttleFill.className = 'hud-throttle-fill';
    bar.append(this.throttleFill);
    this.prompts.className = 'hud-prompts';
    this.el.append(this.speed, bar, this.prompts);
    root.append(this.el);
  }

  update(info: HudInfo): void {
    const knots = Math.round(info.speed * MS_TO_KNOTS);
    const throttle = Math.round(info.throttle * 50) / 50;
    const s = this.shown;
    if (knots !== s.knots) this.speed.innerHTML = `${knots}<small> kn</small>`;
    if (throttle !== s.throttle || info.boosting !== s.boosting) {
      this.throttleFill.style.transform = `scaleX(${Math.abs(throttle)})`;
      this.throttleFill.dataset.reverse = String(throttle < 0);
      this.throttleFill.dataset.boost = String(info.boosting && throttle > 0);
    }
    if (info.device !== s.device) {
      this.prompts.replaceChildren(
        ...PROMPTS[info.device].map(([keys, label]) => {
          const row = document.createElement('div');
          const k = document.createElement('kbd');
          k.textContent = keys;
          row.append(k, ` ${label}`);
          return row;
        }),
      );
    }
    this.shown = { knots, throttle, boosting: info.boosting, device: info.device };
  }

  dispose(): void {
    this.el.remove();
  }
}
