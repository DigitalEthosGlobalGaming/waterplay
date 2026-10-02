import type { Binding, BindingMap, BindingSet } from '../data/bindings.ts';
import type { Action } from './actions.ts';

/** Raw device state for one frame, collected by InputSystem (or faked in tests). */
export interface RawInput {
  keys: ReadonlySet<string>;
  mouseButtons: ReadonlySet<number>;
  mouseDelta: { x: number; y: number };
  /** Wheel notches this frame, positive = down. */
  wheel: number;
  gamepad: { buttons: readonly number[]; axes: readonly number[] } | null;
}

export interface ActionValue {
  /** 1D value, -1..1. */
  value: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const ZERO: ActionValue = { value: 0, x: 0, y: 0, dx: 0, dy: 0 };

/** Digital threshold for treating an analogue value as "held". */
export const HELD_THRESHOLD = 0.5;

export function evaluateActions(raw: RawInput, bindings: BindingSet): Map<Action, ActionValue> {
  const out = new Map<Action, ActionValue>();
  mergeMap(out, raw, bindings.kbm, bindings.deadzone);
  if (raw.gamepad) mergeMap(out, raw, bindings.gamepad, bindings.deadzone);
  return out;
}

export function actionValue(values: Map<Action, ActionValue>, a: Action): ActionValue {
  return values.get(a) ?? ZERO;
}

/** True if any gamepad input is beyond the deadzone. Used for active-device switching. */
export function gamepadActive(raw: RawInput, deadzone: number): boolean {
  if (!raw.gamepad) return false;
  return (
    raw.gamepad.buttons.some((b) => b > HELD_THRESHOLD) ||
    raw.gamepad.axes.some((a) => Math.abs(a) > deadzone * 2)
  );
}

export function kbmActive(raw: RawInput): boolean {
  return (
    raw.keys.size > 0 ||
    raw.mouseButtons.size > 0 ||
    raw.mouseDelta.x !== 0 ||
    raw.mouseDelta.y !== 0 ||
    raw.wheel !== 0
  );
}

function mergeMap(
  out: Map<Action, ActionValue>,
  raw: RawInput,
  map: BindingMap,
  deadzone: number,
): void {
  for (const [action, list] of Object.entries(map) as [Action, Binding[]][]) {
    let acc = out.get(action) ?? { ...ZERO };
    for (const b of list) acc = combine(acc, evalBinding(b, raw, deadzone));
    out.set(action, acc);
  }
}

/** Largest-magnitude source wins per component; deltas add up. */
function combine(a: ActionValue, b: ActionValue): ActionValue {
  return {
    value: Math.abs(b.value) > Math.abs(a.value) ? b.value : a.value,
    x: Math.abs(b.x) > Math.abs(a.x) ? b.x : a.x,
    y: Math.abs(b.y) > Math.abs(a.y) ? b.y : a.y,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
  };
}

function evalBinding(b: Binding, raw: RawInput, deadzone: number): ActionValue {
  const key = (code: string) => (raw.keys.has(code) ? 1 : 0);
  const pad = raw.gamepad;
  switch (b.kind) {
    case 'key':
      return { ...ZERO, value: key(b.code) };
    case 'keyAxis':
      return { ...ZERO, value: key(b.positive) - key(b.negative) };
    case 'keyStick': {
      let x = key(b.right) - key(b.left);
      let y = key(b.down) - key(b.up);
      if (x !== 0 && y !== 0) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
      }
      return { ...ZERO, x, y };
    }
    case 'mouseButton':
      return { ...ZERO, value: raw.mouseButtons.has(b.button) ? 1 : 0 };
    case 'mouseDelta':
      return { ...ZERO, dx: raw.mouseDelta.x, dy: raw.mouseDelta.y };
    case 'mouseWheel':
      return { ...ZERO, value: raw.wheel !== 0 ? 1 : 0 };
    case 'padButton':
      return { ...ZERO, value: pad?.buttons[b.index] ?? 0 };
    case 'padButtonAxis':
      return {
        ...ZERO,
        value: (pad?.buttons[b.positive] ?? 0) - (pad?.buttons[b.negative] ?? 0),
      };
    case 'padAxis': {
      const v = applyDeadzone1(pad?.axes[b.index] ?? 0, deadzone);
      return { ...ZERO, value: b.invert ? -v : v };
    }
    case 'padDpad': {
      const button = (i: number) => ((pad?.buttons[i] ?? 0) > HELD_THRESHOLD ? 1 : 0);
      return { ...ZERO, x: button(15) - button(14), y: button(13) - button(12) };
    }
    case 'padStick': {
      const { x, y } = applyRadialDeadzone(pad?.axes[b.x] ?? 0, pad?.axes[b.y] ?? 0, deadzone);
      return { ...ZERO, x, y: b.invertY ? -y : y };
    }
  }
}

export function applyDeadzone1(v: number, deadzone: number): number {
  const m = Math.abs(v);
  if (m <= deadzone) return 0;
  return (Math.sign(v) * (m - deadzone)) / (1 - deadzone);
}

/** Radial deadzone, rescaled so output still reaches 1 at full deflection. */
export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone: number,
): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= deadzone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - deadzone) / (1 - deadzone));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}
