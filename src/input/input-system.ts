import { defaultBindings } from '../data/bindings.ts';
import type { Action, ActiveDevice, InputSnapshot } from './actions.ts';
import {
  type ActionValue,
  actionValue,
  evaluateActions,
  gamepadActive,
  HELD_THRESHOLD,
  kbmActive,
  type RawInput,
} from './evaluate.ts';

/**
 * Collects keyboard, mouse and gamepad state from the DOM and turns it into an
 * InputSnapshot once per frame via poll().
 */
export class InputSystem {
  activeDevice: ActiveDevice = 'kbm';

  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private mouseDelta = { x: 0, y: 0 };
  private wheel = 0;
  private pointer = { x: 0, y: 0 };
  private prevHeld = new Set<Action>();
  private detach: () => void;

  constructor(private readonly surface: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      // Keep the browser from tabbing focus away or scrolling while playing.
      if (e.code === 'Tab' || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onMouseDown = (e: MouseEvent) => {
      if (e.target === surface) this.mouseButtons.add(e.button);
    };
    const onMouseUp = (e: MouseEvent) => this.mouseButtons.delete(e.button);
    const onMouseMove = (e: MouseEvent) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      // Camera look only while dragging on the game surface or pointer-locked.
      if (this.mouseButtons.size > 0 || document.pointerLockElement === surface) {
        this.mouseDelta.x += e.movementX;
        this.mouseDelta.y += e.movementY;
      }
    };
    const onWheel = (e: WheelEvent) => {
      this.wheel += Math.sign(e.deltaY);
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onBlur = () => {
      this.keys.clear();
      this.mouseButtons.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    surface.addEventListener('wheel', onWheel, { passive: true });
    surface.addEventListener('contextmenu', onContextMenu);

    this.detach = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('contextmenu', onContextMenu);
    };
  }

  /** Call once per animation frame. */
  poll(): InputSnapshot {
    const raw: RawInput = {
      keys: this.keys,
      mouseButtons: this.mouseButtons,
      mouseDelta: { ...this.mouseDelta },
      wheel: this.wheel,
      gamepad: readGamepad(),
    };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.wheel = 0;

    // Read bindings fresh each frame so they hot swap and rebinding applies instantly.
    const bindings = defaultBindings;
    if (gamepadActive(raw, bindings.deadzone)) this.activeDevice = 'gamepad';
    else if (kbmActive(raw)) this.activeDevice = 'kbm';

    const values = evaluateActions(raw, bindings);
    const held = new Set<Action>();
    for (const [a, v] of values) if (isHeld(v)) held.add(a);
    const prev = this.prevHeld;
    this.prevHeld = held;

    const get = (a: Action) => actionValue(values, a);
    const snapshot: InputSnapshot = {
      axis: (a) => get(a).value,
      axis2: (a) => ({ x: get(a).x, y: get(a).y }),
      axis2Delta: (a) => ({ x: get(a).dx, y: get(a).dy }),
      pressed: (a) => held.has(a) && !prev.has(a),
      held: (a) => held.has(a),
      released: (a) => !held.has(a) && prev.has(a),
      activeDevice: this.activeDevice,
    };
    if (this.activeDevice === 'kbm') {
      const el = document.elementFromPoint(this.pointer.x, this.pointer.y);
      snapshot.pointer = { ...this.pointer, overUi: el !== null && el !== this.surface };
    }
    return snapshot;
  }

  dispose(): void {
    this.detach();
  }
}

function isHeld(v: ActionValue): boolean {
  return Math.abs(v.value) > HELD_THRESHOLD;
}

function readGamepad(): RawInput['gamepad'] {
  // First connected pad with the standard mapping. Multi-pad local play is out of scope for now.
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (pad?.connected && pad.mapping === 'standard') {
      return { buttons: pad.buttons.map((b) => b.value), axes: pad.axes };
    }
  }
  return null;
}
