import {
  createRapierPhysicsWorld,
  type RapierPhysicsWorld,
} from '../adapters/physics/rapier/rapier-physics-world.ts';
import { restingBoatState } from '../core/boats/boat.ts';
import type { EntityId } from '../core/interfaces/common.ts';
import type { Platform } from '../core/interfaces/platform.ts';
import type { PeerId, Transport } from '../core/interfaces/transport.ts';
import { headingOf, quatFromYaw } from '../core/math/vec.ts';
import { wrapDelta } from '../core/net/interpolation.ts';
import { FixedStepAccumulator } from '../core/sim/fixed-step.ts';
import { EntityIdAllocator } from '../core/sim/ids.ts';
import { Sim, type SimOptions } from '../core/sim/sim.ts';
import { type BoatTypeId, boatTypes } from '../data/boats.ts';
import { applyTunableOverrides, getTunableOverrides } from '../data/registry.ts';
import { simTunables } from '../data/sim.ts';
import type { InputSnapshot } from '../input/actions.ts';
import { InputSystem } from '../input/input-system.ts';
import { GameRenderer, type RenderBoat } from '../render/game-renderer.ts';
import { Hud } from '../ui/hud.ts';
import { Menu } from '../ui/menu.ts';
import { NameTags } from '../ui/name-tags.ts';
import { NetStatusView } from '../ui/net-status.ts';
import { loadBoatChoice, saveBoatChoice } from './boat-choice.ts';
import { Multiplayer } from './multiplayer.ts';
import { randomPlayerName } from './player-name.ts';
import type { RestoredSession, SessionState } from './session.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  platform: Platform;
  seed: number;
  /** A fresh transport for each host/join (PeerJS in the shipped game). */
  createTransport: () => Transport;
}

/**
 * Boats are keyed per owner on the wire (`${peer}/${entityId}`), so local ids
 * don't need to be globally unique and stay stable across sessions.
 */
const LOCAL_PEER = 'local' as PeerId;

/** New boats start somewhere on this ring around the origin, so friends don't spawn inside each other. */
const SPAWN_RING = { min: 12, max: 40 };

/**
 * Composition root (§4): wires core + adapters + input + render + ui. The only
 * place that knows about all of them.
 */
export class Game {
  readonly platform: Platform;
  readonly input: InputSystem;
  readonly renderer: GameRenderer;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly multiplayer: Multiplayer;
  readonly physics: RapierPhysicsWorld;
  sim: Sim;
  /** The boat this player drives. */
  localBoatId: EntityId;
  /** Freeform flags from the URL / command line, kept across reloads. */
  devFlags: Record<string, unknown> = {};
  /** While true the sim doesn't advance (used during restore/resync, §13.4.4). */
  paused = false;
  /** Boats left out of the session snapshot (dev dummies). */
  readonly transientBoats = new Set<EntityId>();
  /** Hooks for dev tools; called once per rendered frame. */
  readonly frameHooks = new Set<(frameSeconds: number) => void>();

  private readonly ids = new EntityIdAllocator(LOCAL_PEER);
  private readonly loop = new FixedStepAccumulator(() => simTunables);
  private lastFrame = 0;
  private rafId = 0;
  private alpha = 1;
  private readonly onResize = () => this.renderer.resize();
  private readonly netStatus: NetStatusView;
  private readonly nameTags: NameTags;

  /** Rapier's WASM loads asynchronously, so construction is too. */
  static async create(opts: GameOptions): Promise<Game> {
    return new Game(opts, await createRapierPhysicsWorld());
  }

  private constructor(opts: GameOptions, physics: RapierPhysicsWorld) {
    this.platform = opts.platform;
    this.physics = physics;
    this.sim = this.createSim({ seed: opts.seed });
    this.input = new InputSystem(opts.canvas);
    this.renderer = new GameRenderer(opts.canvas);
    this.hud = new Hud(opts.uiRoot);
    this.netStatus = new NetStatusView(opts.uiRoot);
    this.nameTags = new NameTags(opts.uiRoot);
    // The world is read through getters: applySession can swap the Sim.
    const sim = () => this.sim;
    this.multiplayer = new Multiplayer(
      {
        get seed() {
          return sim().seed;
        },
        get worldClock() {
          return sim().worldClock;
        },
        setWorldClock: (t) => sim().setWorldClock(t),
        ownedBoats: () => [...sim().allBoats()].map((b) => b.state()),
      },
      opts.createTransport,
    );
    this.multiplayer.session.onNotice((text) => this.netStatus.notice(text));
    this.menu = new Menu(opts.uiRoot, this.multiplayer, randomPlayerName, {
      current: () => this.sim.getBoat(this.localBoatId)?.type ?? loadBoatChoice(),
      choose: (type) => this.changeBoat(type),
    });
    this.localBoatId = this.spawnLocalBoat();
    window.addEventListener('resize', this.onResize);
  }

  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      const frameSeconds = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const input = this.input.poll();
      const menuOpen = this.menu.update(input, frameSeconds);
      if (!this.paused) {
        // Multiplayer can't pause, so the menu just takes the boat's controls.
        this.applyControls(menuOpen ? null : input);
        const { steps, alpha } = this.loop.advance(frameSeconds);
        for (let i = 0; i < steps; i++) {
          this.sim.step();
          this.multiplayer.session.tick(simTunables.dt);
        }
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
    void this.multiplayer.leave();
    this.sim.dispose();
    this.physics.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.netStatus.dispose();
    this.nameTags.dispose();
  }

  captureSession(): SessionState {
    return {
      net: this.multiplayer.snapshot(),
      local: {
        boats: [...this.sim.allBoats()]
          .filter((b) => !this.transientBoats.has(b.id))
          .map((b) => b.state()),
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
      this.sim = this.createSim(s.world);
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

  private createSim(world: SimOptions['world']): Sim {
    const sim = new Sim({ physics: this.physics, world });
    // Bump into what you see: other players' boats as drawn at that moment.
    // (Optional chaining: the first Sim exists before multiplayer is set up.)
    sim.remoteHulls = (t) => this.multiplayer?.session.remoteBoats(t) ?? [];
    return sim;
  }

  /** Swap the player's boat for another type, where it is (§7.3). Remembered for next time. */
  changeBoat(type: BoatTypeId): void {
    saveBoatChoice(type);
    this.sim.changeBoatType(this.localBoatId, type);
  }

  /** A new id for a boat this instance owns. */
  nextEntityId(): EntityId {
    return this.ids.next();
  }

  private spawnLocalBoat(): EntityId {
    // App layer, so real randomness is fine here (§14.9 applies to core).
    const angle = Math.random() * Math.PI * 2;
    const r = SPAWN_RING.min + Math.random() * (SPAWN_RING.max - SPAWN_RING.min);
    const state = restingBoatState(
      this.ids.next(),
      loadBoatChoice(),
      Math.cos(angle) * r,
      Math.sin(angle) * r,
      quatFromYaw(Math.random() * Math.PI * 2),
    );
    return this.sim.addBoat(state).id;
  }

  /** Game code reads actions, never keys (§14.4). Null input lets go of everything. */
  private applyControls(input: InputSnapshot | null): void {
    const boat = this.sim.getBoat(this.localBoatId);
    if (!boat) return;
    boat.controls = {
      throttle: input?.axis('throttle') ?? 0,
      steer: input?.axis('steer') ?? 0,
      boost: input?.held('boost') ?? false,
    };
  }

  private renderFrame(input: InputSnapshot, frameSeconds: number): void {
    const boats: RenderBoat[] = [];
    for (const b of this.sim.allBoats()) {
      const pose = this.sim.interpolatedPose(b.id, this.alpha);
      if (pose) boats.push({ id: b.id, boatType: b.type, ...pose });
    }
    // Interpolated like the boats so water and hulls stay in step.
    const time = this.sim.worldClock - simTunables.dt * (1 - this.alpha);
    const session = this.multiplayer.session;
    const remotes = session.remoteBoats(time);
    for (const r of remotes) {
      boats.push({ id: r.key, boatType: r.boatType, position: r.position, rotation: r.rotation });
    }
    const local = this.sim.getBoat(this.localBoatId);
    const localPose = boats.find((b) => b.id === this.localBoatId);
    this.renderer.render(
      {
        time,
        boats,
        wakes: this.sim.wakes.emitters.map((w) => ({
          x: w.x,
          z: w.z,
          age: wrapDelta(w.t0, time, simTunables.worldClockLoopPeriod),
          amplitude: w.amplitude,
        })),
        focus:
          local && localPose
            ? {
                id: local.id,
                heading: headingOf(localPose.rotation),
                speed: local.telemetry.speed,
                cameraScale: boatTypes[local.type].cameraScale,
              }
            : null,
      },
      input,
      frameSeconds,
    );
    this.nameTags.update(
      remotes.map((r) => ({
        key: r.key,
        name: r.name,
        screen: this.renderer.screenPoint({
          x: r.position.x,
          y: r.position.y + 3,
          z: r.position.z,
        }),
      })),
    );
    this.netStatus.update(session.status, session.players().length);
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
