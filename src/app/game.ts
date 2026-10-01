import {
  createRapierPhysicsWorld,
  type RapierPhysicsWorld,
} from '../adapters/physics/rapier/rapier-physics-world.ts';
import { restingBoatState } from '../core/boats/boat.ts';
import type { EntityId } from '../core/interfaces/common.ts';
import type { Platform } from '../core/interfaces/platform.ts';
import type { PeerId } from '../core/interfaces/transport.ts';
import { headingOf } from '../core/math/vec.ts';
import { FixedStepAccumulator } from '../core/sim/fixed-step.ts';
import { EntityIdAllocator } from '../core/sim/ids.ts';
import { Sim } from '../core/sim/sim.ts';
import { applyTunableOverrides, getTunableOverrides } from '../data/registry.ts';
import { simTunables } from '../data/sim.ts';
import type { InputSnapshot } from '../input/actions.ts';
import { InputSystem } from '../input/input-system.ts';
import { GameRenderer, type RenderBoat } from '../render/game-renderer.ts';
import { Hud } from '../ui/hud.ts';
import type { RestoredSession, SessionState } from './session.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  platform: Platform;
  seed: number;
}

/** Until M3 there's no network identity; ids look like the real thing. */
const LOCAL_PEER = 'local' as PeerId;

/**
 * Composition root (§4): wires core + adapters + input + render + ui. The only
 * place that knows about all of them.
 */
export class Game {
  readonly platform: Platform;
  readonly input: InputSystem;
  readonly renderer: GameRenderer;
  readonly hud: Hud;
  readonly physics: RapierPhysicsWorld;
  sim: Sim;
  /** The boat this player drives. */
  localBoatId: EntityId;
  /** Freeform flags from the URL / command line, kept across reloads. */
  devFlags: Record<string, unknown> = {};
  /** While true the sim doesn't advance (used during restore/resync, §13.4.4). */
  paused = false;
  /** Hooks for dev tools; called once per rendered frame. */
  readonly frameHooks = new Set<(frameSeconds: number) => void>();

  private readonly ids = new EntityIdAllocator(LOCAL_PEER);
  private readonly loop = new FixedStepAccumulator(() => simTunables);
  private lastFrame = 0;
  private rafId = 0;
  private alpha = 1;
  private readonly onResize = () => this.renderer.resize();

  /** Rapier's WASM loads asynchronously, so construction is too. */
  static async create(opts: GameOptions): Promise<Game> {
    return new Game(opts, await createRapierPhysicsWorld());
  }

  private constructor(opts: GameOptions, physics: RapierPhysicsWorld) {
    this.platform = opts.platform;
    this.physics = physics;
    this.sim = new Sim({ physics, world: { seed: opts.seed } });
    this.input = new InputSystem(opts.canvas);
    this.renderer = new GameRenderer(opts.canvas);
    this.hud = new Hud(opts.uiRoot);
    this.localBoatId = this.spawnLocalBoat();
    window.addEventListener('resize', this.onResize);
  }

  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      const frameSeconds = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const input = this.input.poll();
      if (!this.paused) {
        this.applyControls(input);
        const { steps, alpha } = this.loop.advance(frameSeconds);
        for (let i = 0; i < steps; i++) this.sim.step();
        this.alpha = alpha;
      }
      this.renderFrame(input, frameSeconds);
      for (const hook of this.frameHooks) hook(frameSeconds);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.sim.dispose();
    this.physics.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
  }

  captureSession(): SessionState {
    return {
      // Offline until M3 adds a transport to the game.
      net: { role: 'offline', sessionCode: '', localPeerId: LOCAL_PEER },
      local: {
        boats: [...this.sim.allBoats()].map((b) => b.state()),
        camera: { ...this.renderer.chase.state },
        input: { activeDevice: this.input.activeDevice },
        devFlags: { ...this.devFlags },
        tuningOverrides: getTunableOverrides(),
      },
      world: this.sim.snapshot(),
    };
  }

  applySession(s: RestoredSession): void {
    if (s.local.tuningOverrides) applyTunableOverrides(s.local.tuningOverrides);
    if (s.local.camera) this.renderer.chase.state = { ...s.local.camera };
    if (s.local.input) this.input.activeDevice = s.local.input.activeDevice;
    if (s.local.devFlags) this.devFlags = { ...s.local.devFlags, ...this.devFlags };
    if (s.world) {
      this.sim.dispose();
      this.sim = new Sim({ physics: this.physics, world: s.world });
    }
    if (s.local.boats?.length) {
      for (const b of [...this.sim.allBoats()]) this.sim.removeBoat(b.id);
      for (const b of s.local.boats) this.sim.addBoat(b);
      this.localBoatId = s.local.boats[0]?.id ?? this.localBoatId;
    } else if (!this.sim.getBoat(this.localBoatId)) {
      this.localBoatId = this.spawnLocalBoat();
    }
    this.renderer.chase.resetSmoothing();
  }

  private spawnLocalBoat(): EntityId {
    return this.sim.addBoat(restingBoatState(this.ids.next(), 'speedboat', 0, 0)).id;
  }

  /** Game code reads actions, never keys (§14.4). */
  private applyControls(input: InputSnapshot): void {
    const boat = this.sim.getBoat(this.localBoatId);
    if (!boat) return;
    boat.controls = {
      throttle: input.axis('throttle'),
      steer: input.axis('steer'),
      boost: input.held('boost'),
    };
  }

  private renderFrame(input: InputSnapshot, frameSeconds: number): void {
    const boats: RenderBoat[] = [];
    for (const b of this.sim.allBoats()) {
      const pose = this.sim.interpolatedPose(b.id, this.alpha);
      if (pose) boats.push({ id: b.id, boatType: b.type, ...pose });
    }
    const local = this.sim.getBoat(this.localBoatId);
    const localPose = boats.find((b) => b.id === this.localBoatId);
    this.renderer.render(
      {
        // Interpolated like the boats so water and hulls stay in step.
        time: this.sim.worldClock - simTunables.dt * (1 - this.alpha),
        boats,
        focus:
          local && localPose
            ? {
                id: local.id,
                heading: headingOf(localPose.rotation),
                speed: local.telemetry.speed,
              }
            : null,
      },
      input,
      frameSeconds,
    );
    if (local) {
      this.hud.update({
        speed: local.telemetry.speed,
        throttle: local.throttle,
        boosting: local.controls.boost,
        device: this.input.activeDevice,
      });
    }
  }
}
