import { describe, expect, it } from 'vitest';
import { defaultBindings } from '../../src/data/bindings.ts';
import {
  actionValue,
  applyRadialDeadzone,
  evaluateActions,
  gamepadActive,
  type RawInput,
} from '../../src/input/evaluate.ts';

function raw(overrides: Partial<RawInput> = {}): RawInput {
  return {
    keys: new Set(),
    mouseButtons: new Set(),
    mouseDelta: { x: 0, y: 0 },
    wheel: 0,
    gamepad: null,
    ...overrides,
  };
}

function pad(buttons: Record<number, number> = {}, axes: Record<number, number> = {}) {
  const b = Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0);
  const a = Array.from({ length: 4 }, (_, i) => axes[i] ?? 0);
  return { buttons: b, axes: a };
}

describe('input evaluation', () => {
  it('maps W/S to throttle', () => {
    const v = evaluateActions(raw({ keys: new Set(['KeyW']) }), defaultBindings);
    expect(actionValue(v, 'throttle').value).toBe(1);
    const s = evaluateActions(raw({ keys: new Set(['KeyS']) }), defaultBindings);
    expect(actionValue(s, 'throttle').value).toBe(-1);
  });

  it('maps RT/LT to throttle on gamepad', () => {
    const v = evaluateActions(raw({ gamepad: pad({ 7: 0.6, 6: 0.1 }) }), defaultBindings);
    expect(actionValue(v, 'throttle').value).toBeCloseTo(0.5);
  });

  it('largest magnitude wins when both devices are used', () => {
    const v = evaluateActions(
      raw({ keys: new Set(['KeyA']), gamepad: pad({}, { 0: 0.3 }) }),
      defaultBindings,
    );
    expect(actionValue(v, 'steer').value).toBe(-1);
  });

  it('applies stick deadzone', () => {
    const v = evaluateActions(raw({ gamepad: pad({}, { 2: 0.1, 3: 0.05 }) }), defaultBindings);
    expect(actionValue(v, 'camera')).toMatchObject({ x: 0, y: 0 });
  });

  it('reports mouse movement as camera delta, not rate', () => {
    const v = evaluateActions(raw({ mouseDelta: { x: 12, y: -4 } }), defaultBindings);
    expect(actionValue(v, 'camera')).toMatchObject({ x: 0, y: 0, dx: 12, dy: -4 });
  });

  it('normalises diagonal keyStick input', () => {
    const v = evaluateActions(raw({ keys: new Set(['ArrowRight', 'ArrowDown']) }), defaultBindings);
    const nav = actionValue(v, 'uiNavigate');
    expect(Math.hypot(nav.x, nav.y)).toBeCloseTo(1);
  });

  it('D-pad navigates menus', () => {
    const buttons = Array.from({ length: 17 }, () => 0);
    buttons[12] = 1; // up
    buttons[15] = 1; // right
    const v = evaluateActions(raw({ gamepad: { buttons, axes: [0, 0, 0, 0] } }), defaultBindings);
    expect(actionValue(v, 'uiNavigate')).toMatchObject({ x: 1, y: -1 });
  });

  it('radial deadzone rescales to reach full deflection', () => {
    expect(applyRadialDeadzone(1, 0, 0.15).x).toBeCloseTo(1);
    expect(applyRadialDeadzone(0.1, 0.1, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('detects gamepad activity beyond resting noise', () => {
    expect(gamepadActive(raw({ gamepad: pad({}, { 0: 0.05 }) }), 0.15)).toBe(false);
    expect(gamepadActive(raw({ gamepad: pad({ 0: 1 }) }), 0.15)).toBe(true);
  });
});
