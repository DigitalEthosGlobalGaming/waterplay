export interface FixedStepConfig {
  /** Seconds per simulation step. */
  dt: number;
  /** Catch-up clamp per frame, to avoid the spiral of death (§4.1). */
  maxStepsPerFrame: number;
}

export interface FrameAdvance {
  steps: number;
  /** Interpolation factor between the previous and current sim state, in [0, 1). */
  alpha: number;
}

/** Accumulator for a fixed simulation step driven by variable frame times. */
export class FixedStepAccumulator {
  private accumulator = 0;

  /** Config is read every frame so tunables can hot swap (§14.14). */
  constructor(private readonly config: () => FixedStepConfig) {}

  advance(frameSeconds: number): FrameAdvance {
    const { dt, maxStepsPerFrame } = this.config();
    this.accumulator += Math.max(0, frameSeconds);
    let steps = Math.floor(this.accumulator / dt);
    if (steps > maxStepsPerFrame) {
      steps = maxStepsPerFrame;
      // Drop the backlog we can't catch up on rather than carrying it forward.
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * dt;
    }
    return { steps, alpha: this.accumulator / dt };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
