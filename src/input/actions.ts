/** Game code reads actions, never raw keys or buttons (§11.1, §14.4). */
export type Action =
  // Boat
  | 'throttle'
  | 'steer'
  | 'boost'
  | 'interact'
  | 'openInventory'
  | 'activityMenu'
  | 'camera'
  // UI
  | 'uiNavigate'
  | 'uiConfirm'
  | 'uiBack'
  | 'uiRotate'
  | 'uiSplitStack'
  | 'uiTabLeft'
  | 'uiTabRight'
  | 'uiDrop'
  | 'pause';

export type ActiveDevice = 'kbm' | 'gamepad';

export interface InputSnapshot {
  /** -1..1 */
  axis(a: Action): number;
  /** Rate-style 2D input (sticks, held keys), each component -1..1. */
  axis2(a: Action): { x: number; y: number };
  /** Delta-style 2D input this frame (mouse movement, in pixels). Zero for gamepad. */
  axis2Delta(a: Action): { x: number; y: number };
  /** Went down this frame. */
  pressed(a: Action): boolean;
  held(a: Action): boolean;
  /** Went up this frame. */
  released(a: Action): boolean;
  activeDevice: ActiveDevice;
  /** KBM only. */
  pointer?: { x: number; y: number; overUi: boolean };
}
