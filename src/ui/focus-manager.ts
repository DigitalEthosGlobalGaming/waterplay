import type { InputSnapshot } from '../input/actions.ts';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** Lets a focused element use directions itself (e.g. cycling code characters) before they move focus. */
export type NavHandler = (el: HTMLElement, dir: NavDirection, input: InputSnapshot) => boolean;

const REPEAT_DELAY = 0.4;
const REPEAT_INTERVAL = 0.12;
const NAV_THRESHOLD = 0.5;

/**
 * Controller-friendly focus for DOM UI (§12.3, §14.5). Elements marked
 * `data-focus` inside the root form a list: uiNavigate moves through it (with
 * key-repeat), uiConfirm clicks on gamepad (keyboard Enter already clicks
 * natively), and the mouse focuses whatever it hovers.
 */
export class FocusManager {
  private items: HTMLElement[] = [];
  private index = 0;
  private heldDir: NavDirection | null = null;
  private repeatIn = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly onNav?: NavHandler,
  ) {
    // Enter activates the focused button ourselves, so it behaves the same everywhere.
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.target instanceof HTMLButtonElement)) return;
      e.preventDefault();
      e.target.click();
    });
    root.addEventListener('pointermove', (e) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-focus]');
      if (el && el !== document.activeElement && this.items.includes(el)) this.focus(el);
    });
  }

  get current(): HTMLElement | undefined {
    return this.items[this.index];
  }

  /** Re-scan after the content changes. Keeps focus on `prefer`, else on the same position. */
  refresh(prefer?: HTMLElement | null): void {
    this.items = [...this.root.querySelectorAll<HTMLElement>('[data-focus]')].filter(
      (el) => !el.hidden && !(el as HTMLButtonElement).disabled,
    );
    const i = prefer ? this.items.indexOf(prefer) : -1;
    this.index = i >= 0 ? i : Math.min(this.index, Math.max(0, this.items.length - 1));
    this.current?.focus({ preventScroll: true });
  }

  focus(el: HTMLElement): void {
    const i = this.items.indexOf(el);
    if (i < 0) return;
    this.index = i;
    el.focus({ preventScroll: true });
  }

  update(input: InputSnapshot, frameSeconds: number): void {
    // Keep our index honest if the mouse or Tab moved DOM focus.
    const active = document.activeElement;
    const i = active instanceof HTMLElement ? this.items.indexOf(active) : -1;
    if (i >= 0) this.index = i;

    const dir = this.repeatingDirection(input, frameSeconds);
    if (dir) this.navigate(dir, input);

    if (input.activeDevice === 'gamepad' && input.pressed('uiConfirm')) this.current?.click();
  }

  private navigate(dir: NavDirection, input: InputSnapshot): void {
    const el = this.current;
    if (el && this.onNav?.(el, dir, input)) return;
    // Arrow keys move the caret inside text fields; only up/down leave them.
    if (el instanceof HTMLInputElement && input.activeDevice === 'kbm') {
      if (dir === 'left' || dir === 'right') return;
    }
    if (this.items.length === 0) return;
    const step = dir === 'up' || dir === 'left' ? -1 : 1;
    this.index = (this.index + step + this.items.length) % this.items.length;
    this.current?.focus({ preventScroll: true });
  }

  /** Fires once on press, then repeats while held, like a keyboard. */
  private repeatingDirection(input: InputSnapshot, dt: number): NavDirection | null {
    const { x, y } = input.axis2('uiNavigate');
    let dir: NavDirection | null = null;
    if (Math.max(Math.abs(x), Math.abs(y)) > NAV_THRESHOLD) {
      dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
    }
    if (dir !== this.heldDir) {
      this.heldDir = dir;
      this.repeatIn = REPEAT_DELAY;
      return dir;
    }
    if (!dir) return null;
    this.repeatIn -= dt;
    if (this.repeatIn > 0) return null;
    this.repeatIn = REPEAT_INTERVAL;
    return dir;
  }
}
