/**
 * Hard limits on tunables. The dev tuning UI rejects edits that break these,
 * and the simulation guards the critical ones too, since a data file edit can
 * bypass the UI.
 */

/** kg. Zero or negative mass makes the physics explode (infinite acceleration). */
export const MIN_MASS = 1;

/** Smallest allowed value per property name, and whether it may equal the limit. */
const LOWER_BOUNDS: Record<string, { min: number; inclusive: boolean }> = {
  mass: { min: MIN_MASS, inclusive: true },
  wavelength: { min: 0, inclusive: false },
  throttleResponse: { min: 0, inclusive: false },
  maxBuoyancyDepth: { min: 0, inclusive: false },
  idleTurnFadeSpeed: { min: 0, inclusive: false },
  fovSpeedRef: { min: 0, inclusive: false },
  near: { min: 0, inclusive: false },
  far: { min: 0, inclusive: false },
  distance: { min: 0, inclusive: false },
  buoyancyStrength: { min: 0, inclusive: true },
  maxThrust: { min: 0, inclusive: true },
  dragForward: { min: 0, inclusive: true },
  dragForwardLinear: { min: 0, inclusive: true },
  dragSideways: { min: 0, inclusive: true },
  dragVertical: { min: 0, inclusive: true },
  wakeScale: { min: 0, inclusive: true },
  cameraScale: { min: 0, inclusive: false },
  modelScale: { min: 0, inclusive: false },
  // Wakes: a zero interval would drop an emitter every step and starve the shader's 256.
  dropInterval: { min: 0.02, inclusive: true },
  lifetime: { min: 0, inclusive: false },
  ringSpeed: { min: 0, inclusive: true },
  width: { min: 0, inclusive: false },
  spreadRadius: { min: 0, inclusive: false },
  fadeIn: { min: 0, inclusive: true },
};

/** Returns why `value` is not allowed for `prop`, or null if it's fine. */
export function checkTunable(prop: string, value: unknown): string | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return `${prop} must be a finite number`;
  const bound = LOWER_BOUNDS[prop];
  if (!bound) return null;
  const ok = bound.inclusive ? value >= bound.min : value > bound.min;
  if (ok) return null;
  return `${prop} must be ${bound.inclusive ? 'at least' : 'greater than'} ${bound.min}`;
}

/** A usable mass even if the data says otherwise. */
export function safeMass(mass: number): number {
  return Number.isFinite(mass) ? Math.max(MIN_MASS, mass) : MIN_MASS;
}
