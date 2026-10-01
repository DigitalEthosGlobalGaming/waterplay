import { liveTunable } from './registry.ts';

export interface SimTunables {
  /** Fixed simulation step in seconds (§4.1). */
  dt: number;
  maxStepsPerFrame: number;
  /** World clock wraps at this period to avoid float precision decay (§6.1). */
  worldClockLoopPeriod: number;
  /** m/s². Applied by our own code, not the physics engine (§5.1). Also drives wave speed. */
  gravity: number;
}

export const simTunables = liveTunable<SimTunables>('sim', {
  dt: 1 / 60,
  maxStepsPerFrame: 5,
  worldClockLoopPeriod: 3600,
  gravity: 9.81,
});

import.meta.hot?.accept();
