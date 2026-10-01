import type { Action } from '../input/actions.ts';
import { liveTunable } from './registry.ts';

/**
 * Binding sources. Keys use KeyboardEvent.code (layout-independent).
 * Gamepad indices follow the W3C "standard" mapping (Xbox layout).
 */
export type Binding =
  | { kind: 'key'; code: string }
  /** Digital axis from two keys: -1 / +1. */
  | { kind: 'keyAxis'; negative: string; positive: string }
  /** Digital 2D axis from four keys. +y is down, matching screen space. */
  | { kind: 'keyStick'; left: string; right: string; up: string; down: string }
  | { kind: 'mouseButton'; button: number }
  /** Pointer movement while pointer-locked or dragging. Reported via InputSnapshot.axis2Delta. */
  | { kind: 'mouseDelta' }
  | { kind: 'mouseWheel' }
  | { kind: 'padButton'; index: number }
  /** Axis from two analogue buttons (e.g. RT / LT): positive - negative. */
  | { kind: 'padButtonAxis'; negative: number; positive: number }
  | { kind: 'padAxis'; index: number; invert?: boolean }
  /** 2D axis from a stick. */
  | { kind: 'padStick'; x: number; y: number; invertY?: boolean };

export type BindingMap = Partial<Record<Action, Binding[]>>;

export interface BindingSet {
  kbm: BindingMap;
  gamepad: BindingMap;
  /** Radial deadzone for sticks and axes. */
  deadzone: number;
}

/** Defaults from §11.2. */
export const defaultBindings = liveTunable<BindingSet>('bindings', {
  deadzone: 0.15,
  kbm: {
    throttle: [{ kind: 'keyAxis', negative: 'KeyS', positive: 'KeyW' }],
    steer: [{ kind: 'keyAxis', negative: 'KeyA', positive: 'KeyD' }],
    boost: [{ kind: 'key', code: 'ShiftLeft' }],
    camera: [{ kind: 'mouseDelta' }],
    interact: [{ kind: 'key', code: 'KeyE' }],
    openInventory: [
      { kind: 'key', code: 'Tab' },
      { kind: 'key', code: 'KeyI' },
    ],
    activityMenu: [{ kind: 'key', code: 'KeyQ' }],
    pause: [{ kind: 'key', code: 'Escape' }],
    uiConfirm: [
      { kind: 'mouseButton', button: 0 },
      { kind: 'key', code: 'Enter' },
    ],
    uiBack: [
      { kind: 'key', code: 'Escape' },
      { kind: 'mouseButton', button: 2 },
    ],
    uiRotate: [{ kind: 'key', code: 'KeyR' }, { kind: 'mouseWheel' }],
    uiNavigate: [
      {
        kind: 'keyStick',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        up: 'ArrowUp',
        down: 'ArrowDown',
      },
    ],
  },
  gamepad: {
    throttle: [{ kind: 'padButtonAxis', negative: 6, positive: 7 }],
    steer: [{ kind: 'padAxis', index: 0 }],
    boost: [{ kind: 'padButton', index: 0 }],
    camera: [{ kind: 'padStick', x: 2, y: 3 }],
    interact: [{ kind: 'padButton', index: 2 }],
    openInventory: [{ kind: 'padButton', index: 3 }],
    activityMenu: [{ kind: 'padButton', index: 8 }],
    pause: [{ kind: 'padButton', index: 9 }],
    uiConfirm: [{ kind: 'padButton', index: 0 }],
    uiBack: [{ kind: 'padButton', index: 1 }],
    uiRotate: [{ kind: 'padButton', index: 3 }],
    uiSplitStack: [{ kind: 'padButton', index: 2 }],
    uiTabLeft: [{ kind: 'padButton', index: 4 }],
    uiTabRight: [{ kind: 'padButton', index: 5 }],
    uiNavigate: [{ kind: 'padStick', x: 0, y: 1 }],
  },
});

import.meta.hot?.accept();
