# Waterplay — Design & Architecture

> This document is the foundation for the project. It is written to be read by humans **and** by AI coding agents. When in doubt, follow the rules in [§14 Rules for AI agents](#14-rules-for-ai-agents).

---

## 1. Vision

A cosy, low-poly, open-water multiplayer game. Players live in a magical world where all food and resources come from the ocean. They sail between floating platforms, pick up and deliver goods, fish, race, and help each other.

**Pillars**

1. **Boats feel good.** Boats have weight, momentum and respond to waves and other players' wakes. If driving around an empty ocean isn't fun, nothing else matters.
2. **Open world first.** Players free-roam by default. Structured play happens through opt-in **Activities** and **Jobs**.
3. **Physical stuff.** Items are physical objects that take up space on your boat, can be dropped into the sea, and can be handed to other players.
4. **Play together easily.** Share a code, friend joins. No accounts, no servers to run (beyond signalling/relay).
5. **Controller and keyboard/mouse are equal citizens** from day one.

**Art:** Kenney Watercraft Kit (CC0). Platforms use placeholder boxes until real assets exist.

---

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript 7** | Native Go compiler, ~10x faster type-checking. Strict mode on. |
| Build / dev server | **Vite** | HMR for instant reload. Vite transpiles only; type-checking runs separately via `tsc --noEmit`. |
| Rendering | **Three.js** | Plain Three.js, no React Three Fiber. |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Behind our own `PhysicsWorld` wrapper. `-compat` embeds the WASM, so it works in Vite, Node tests and Electron with no loader config. |
| Networking | **PeerJS** | Behind our own `Transport` wrapper. Swappable for Cloudflare Realtime, Trystero, or Steam Networking later. |
| Desktop / Steam | **Electron** + **steamworks.js** | Behind our own `Platform` wrapper. Web build has a no-op/browser platform. |
| Unit / integration tests | **Vitest** | Runs the simulation headless in Node. |
| E2E smoke tests | **Playwright** | Few, fast, only for critical flows. |
| Lint / format | **Biome** (or oxlint + Prettier) | `typescript-eslint` depends on the TS compiler API, which TS 7.0 doesn't ship yet. Biome is fast and needs no TS API. |
| Debug UI | **lil-gui** | Live tuning of boat/water parameters in dev builds only. |
| Package manager | **npm** | Commit `package-lock.json`; use `npm ci` in CI. npm workspaces if we split packages later. |

> Note: verify current versions when scaffolding. Pin exact versions in `package.json`.

---

## 3. Repository structure

```
/
├─ apps/
│  ├─ web/                 # Vite entry for browser build (index.html, main.ts)
│  └─ desktop/             # Electron main + preload, steamworks.js integration
├─ src/
│  ├─ core/                # PURE simulation. No DOM, no Three.js, no PeerJS.
│  │  ├─ sim/              # Fixed-step loop, world state, entity registry
│  │  ├─ water/            # waterHeight(), Gerstner waves, wake emitters (shared maths)
│  │  ├─ boats/            # Boat controller, buoyancy, handling params
│  │  ├─ items/            # Item definitions, shapes, inventory grid logic
│  │  ├─ activities/       # Activity framework + fishing, racing
│  │  ├─ jobs/             # Job framework + pickup/delivery jobs
│  │  ├─ world/            # World layout, platforms, chunking, spawn tables
│  │  └─ net/              # Message schemas, replication logic (transport-agnostic)
│  ├─ adapters/            # Implementations of our wrapper interfaces
│  │  ├─ physics/rapier/
│  │  ├─ transport/peerjs/
│  │  ├─ transport/loopback/   # In-memory transport for tests and local dev
│  │  ├─ transport/devsocket/  # Dev-only: local WebSocket relay transport for multi-instance Electron
│  │  └─ platform/{web,steam}/
│  ├─ render/              # Three.js: scene, water shader, models, camera, VFX
│  ├─ input/               # Action mapping, device detection, rebinding
│  ├─ ui/                  # HUD, inventory UI, menus, focus navigation
│  ├─ app/                 # Composition root: wires core + adapters + render + ui
│  ├─ dev/                 # Dev-only: session save/restore, HMR handlers, debug overlays (stripped from prod)
│  └─ data/                # Tunables and content as typed TS/JSON (boats, items, platforms)
├─ assets/
│  └─ kenney-watercraft/   # GLB models, untouched originals
├─ tests/
│  ├─ unit/
│  ├─ sim/                 # Headless multi-tick simulation tests
│  └─ e2e/                 # Playwright
├─ tools/
│  ├─ dev-electron.ts      # Dev orchestrator: Vite + relay + N Electron instances + restarts
│  └─ dev-relay.ts         # Tiny local WebSocket relay used by DevSocketTransport
├─ .dev-sessions/          # Git-ignored. Per-instance session snapshots during development
├─ docs/                   # This file and future design notes
└─ CLAUDE.md               # Short pointer to §14 for AI agents
```

**The single most important rule:** `src/core` must never import from `render`, `ui`, `input`, `adapters`, or any browser/Node API. It talks to the outside world only through interfaces. This is what makes testing fast and swapping libraries cheap. Enforce it with a lint rule (Biome `noRestrictedImports` or a tiny custom check script).

---

## 4. Architecture overview

```
            ┌──────────────── app (composition root) ────────────────┐
            │                                                         │
  input ──► │  core/sim  ◄──── PhysicsWorld (interface) ◄── rapier    │
  (actions) │     │       ◄──── Transport (interface)   ◄── peerjs    │
            │     │       ◄──── Platform (interface)    ◄── web/steam │
            │     ▼                                                    │
            │  read-only state snapshot ──► render (Three.js)          │
            │                           └─► ui (HUD, inventory)        │
            └─────────────────────────────────────────────────────────┘
```

### 4.1 Game loop

- **Fixed simulation step:** 60 Hz (`dt = 1/60`). Physics, buoyancy, activities, jobs all tick here.
- **Render:** every animation frame, interpolating between the last two sim states.
- **Network send:** 20 Hz for boat state; event messages sent immediately.
- Accumulator pattern; clamp catch-up to max 5 steps per frame to avoid spiral of death.

### 4.2 Entities

Simple ID + typed component records. No heavy ECS library needed at first.

```ts
type EntityId = string; // e.g. `${peerId}:${localCounter}` so IDs are unique across peers

interface BoatEntity {
  id: EntityId;
  ownerPeer: PeerId;
  boatType: BoatTypeId;        // references data/boats.ts
  bodyHandle: BodyHandle;      // from PhysicsWorld
  inventory: InventoryId;
  activity?: ActivityInstanceId;
  job?: JobInstanceId;
}
```

---

## 5. Wrapper interfaces

These are the seams. Game code depends on these, never on Rapier/PeerJS/steamworks.js directly.

### 5.1 PhysicsWorld

```ts
export type BodyHandle = number & { __brand: 'BodyHandle' };

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

export type ColliderShape =
  | { kind: 'box'; halfExtents: Vec3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'capsule'; halfHeight: number; radius: number }
  | { kind: 'convexHull'; points: Float32Array };

export interface BodyDesc {
  type: 'dynamic' | 'kinematic' | 'static';
  position: Vec3;
  rotation?: Quat;
  mass?: number;                 // dynamic only
  centerOfMass?: Vec3;           // local; boats want this LOW for stability
  linearDamping?: number;
  angularDamping?: number;
  colliders: Array<{ shape: ColliderShape; offset?: Vec3; friction?: number; restitution?: number; sensor?: boolean }>;
  userData?: EntityId;
}

export interface CollisionEvent { a: EntityId; b: EntityId; started: boolean; impulse?: number }

export interface PhysicsWorld {
  createBody(desc: BodyDesc): BodyHandle;
  removeBody(h: BodyHandle): void;

  getTransform(h: BodyHandle): { position: Vec3; rotation: Quat };
  setTransform(h: BodyHandle, position: Vec3, rotation: Quat): void;   // teleport / rebase
  getLinearVelocity(h: BodyHandle): Vec3;
  getAngularVelocity(h: BodyHandle): Vec3;
  setVelocities(h: BodyHandle, linear: Vec3, angular: Vec3): void;

  applyForceAtPoint(h: BodyHandle, force: Vec3, worldPoint: Vec3): void;
  applyImpulseAtPoint(h: BodyHandle, impulse: Vec3, worldPoint: Vec3): void;
  applyTorque(h: BodyHandle, torque: Vec3): void;

  localToWorld(h: BodyHandle, local: Vec3): Vec3;

  step(dt: number): void;
  drainCollisionEvents(): CollisionEvent[];

  /** Shift every body by -offset. Used for floating origin. */
  rebase(offset: Vec3): void;
}
```

Rules: gravity, buoyancy and drag are **our** code, applied through `applyForceAtPoint` each step. Rapier only integrates and resolves collisions. Keep a `NullPhysicsWorld` (simple Euler integration, sphere collisions) for ultra-fast tests where Rapier isn't needed.

### 5.2 Transport

```ts
export type PeerId = string & { __brand: 'PeerId' };

export type Channel = 'reliable' | 'unreliable';

export interface Transport {
  readonly localId: PeerId;
  readonly isHost: boolean;

  /** Host: create a session and return a short share code. */
  host(): Promise<{ shareCode: string }>;
  /** Client: join using a share code. */
  join(shareCode: string): Promise<void>;
  leave(): Promise<void>;

  send(to: PeerId | 'all' | 'host', channel: Channel, data: Uint8Array): void;

  onMessage(cb: (from: PeerId, channel: Channel, data: Uint8Array) => void): Unsubscribe;
  onPeerJoined(cb: (peer: PeerId) => void): Unsubscribe;
  onPeerLeft(cb: (peer: PeerId) => void): Unsubscribe;
  onConnectionStateChanged(cb: (s: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void): Unsubscribe;
}
```

Implementations:

- **`LoopbackTransport`** — in-memory, with optional simulated latency/jitter/packet loss. Used in all networking tests and for "two players in one tab" dev mode. Build this **first**.
- **`PeerJsTransport`** — PeerJS DataConnections. One reliable connection (ordered) and one unreliable (`reliable: false`) per peer. Star topology: clients connect to host only; host relays.
- **`DevSocketTransport`** (dev only) — talks to a local WebSocket relay started by the dev orchestrator. Stable peer IDs per dev instance, no internet or PeerJS cloud needed, reconnects in milliseconds. Used for multi-instance Electron development (§13.4).
- **Later:** `SteamTransport` (Steam Networking Messages + lobbies, relay included), `CloudflareTransport`, `TrysteroTransport`.

Share codes: 6 characters from an unambiguous alphabet (no 0/O, 1/I/L), e.g. `K7M-Q4X`. Host PeerJS ID is derived from the code with a game-specific prefix (e.g. `waterplay-K7MQ4X`). Configure ICE servers with a TURN fallback (Cloudflare TURN or Metered) because some NATs will block direct connections.

Serialisation: binary for hot-path messages (boat state), compact JSON or msgpack for events. Every message has a `type` byte and a protocol `version`.

### 5.3 Platform

```ts
export interface Platform {
  readonly kind: 'web' | 'steam';
  getPlayerName(): string;
  unlockAchievement(id: string): void;
  saveData(key: string, data: Uint8Array): Promise<void>;   // Steam Cloud on Steam, IndexedDB on web
  loadData(key: string): Promise<Uint8Array | null>;
  openInviteOverlay?(): void;                                 // Steam only
  onJoinRequested?(cb: (shareCodeOrLobby: string) => void): Unsubscribe;
}
```

steamworks.js only runs in Electron's main process; expose a narrow API to the renderer via `preload` + `contextBridge`. Use Steam's test App ID (480) during development.

### 5.4 Input (see §11)

---

## 6. Water and wakes

### 6.1 The shared water function

All water lives in **one** deterministic function implemented twice, identically: once in TypeScript (`core/water`) for buoyancy, once in GLSL (`render/water`) for drawing.

```
waterHeight(x, z, t) = gerstnerSum(x, z, t) + wakeSum(x, z, t)
```

- `t` is the **shared world clock** (host-authoritative, synced at join and periodically corrected).
- Use `t mod LOOP_PERIOD` (e.g. 3600s, chosen so all wave periods divide cleanly) to avoid float precision decay over long sessions.
- **Gerstner sum:** 3–5 waves. Parameters (direction, wavelength, steepness, speed) in `data/water.ts`. Weather can lerp between parameter sets.
- **Unit test:** a golden-value test samples `waterHeight` at fixed points and compares against stored values. A matching GLSL test renders a tiny offscreen grid and compares (dev-only, can be manual at first).

### 6.2 Wakes

- Each boat drops a **wake emitter** every ~0.15s while moving above a speed threshold: `{ x, z, t0, speed, heading, strength }`.
- Each emitter contributes a decaying, expanding ring (or Kelvin-style V when we get fancy) to `wakeSum`.
- Emitters expire after ~6–8s. Cap the global count (e.g. 256) and pass them to the shader as a uniform array or data texture.
- **Emitters are derived from replicated boat positions**, so every client generates the same wakes locally. Wakes are never sent over the network.
- CPU optimisation: spatial hash of emitters so buoyancy sampling only checks nearby ones.

### 6.3 Look

- Low-poly flat shading (face normals via screen-space derivatives).
- Colour ramp by height and view angle; white foam on crests and around wake rings.
- Shoreline/obstacle foam using the depth texture.
- Grid mesh follows the camera (snapped to grid size to avoid swimming), with LOD rings for distance.
- Distance fog blends to sky colour; hides the edge of the water mesh and draw distance.

---

## 7. Boat handling ("weight")

Boats should feel heavy: slow to start, slow to stop, carve wide turns at speed, lean and pitch on waves.

### 7.1 Forces applied each sim step

1. **Gravity** at centre of mass.
2. **Buoyancy** at 6–8 hull sample points: `depth = waterHeight(p) - p.y`; if `depth > 0`, apply upward force `k * min(depth, maxDepth)` at that point. Uneven forces naturally produce pitch and roll on waves.
3. **Water drag** — split into components in boat-local space:
   - Forward: low drag (boats glide).
   - Sideways: **high** drag (the keel effect; this is what makes turns carve instead of sliding).
   - Vertical: medium drag (damps bobbing).
4. **Thrust** at the stern, below the waterline. Throttle **ramps** toward target (`throttleResponse`), never instant. No thrust when the propeller point is out of the water.
5. **Rudder/steering** as a sideways force at the stern, scaled by forward speed. Slow boats turn poorly; stationary boats barely turn. Small idle turn assist so players never feel stuck.
6. **Angular damping** high on roll/pitch, moderate on yaw.
7. **Cargo mass:** inventory contents add mass. A full cargo hold genuinely handles worse.

### 7.2 Tunables (per boat type, in `data/boats.ts`)

```ts
interface BoatHandling {
  mass: number;
  centerOfMassOffset: Vec3;   // keep low for stability
  buoyancyPoints: Vec3[];
  buoyancyStrength: number;
  maxThrust: number;
  reverseThrustRatio: number;
  throttleResponse: number;   // how fast throttle reaches target (per second)
  dragForward: number;
  dragSideways: number;
  dragVertical: number;
  rudderStrength: number;
  rudderSpeedCurve: [speed: number, factor: number][];
  angularDamping: Vec3;
  cargoGrid: { width: number; height: number };
}
```

All of these are exposed in lil-gui in dev builds with a "copy as TS" button so good values can be pasted back into the data file.

### 7.3 Camera

Chase camera with spring damping, lags slightly on turns (sells weight), pulls back with speed, gentle FOV increase at top speed. Horizon-stabilised so roll doesn't make players sick.

---

## 8. Networking model

### 8.1 Topology and authority

Star topology through the host. This is a cosy co-op game, so authority favours responsiveness over anti-cheat.

| State | Authority |
|---|---|
| Own boat transform & velocity | Owning client |
| World clock | Host |
| Activity & job instances (creation, membership, results) | Host |
| Inventory contents & item transfers | Host (prevents duplication) |
| Dropped world items (floating crates) | Host |
| Fish spawns, resource node respawns | Host |
| Cosmetic effects (splashes, particles) | Local only |

### 8.2 Replication

- **Boat snapshots** at 20 Hz on the unreliable channel: `{ entityId, seq, t, pos, rot, linVel, angVel, throttle, steer }`.
- Remote boats are rendered with **snapshot interpolation** (~120ms buffer, on the shared world clock). They have no physics body; each peer sees them as hulls (`RemoteHull`).
- **Bumps:** each peer pushes only the boats it owns away from remote hulls, using a spring-damper on the pair's reduced mass (`core/boats/contacts.ts`). Both sides compute equal and opposite pushes from the same states, so no bump messages are needed. Good enough for a cosy game.
- **Clock:** clients ease their world clock toward the host's using ping/pong round trips (snap if more than 1 s off).
- **Protocol version:** every message starts with `[protocolVersion u8][type u8]`. Peers on different versions are refused with a clear "refresh to update" message rather than misreading each other.
- **Events** (reliable channel): join/leave, activity/job changes, inventory transactions, chat/emotes.

### 8.3 Inventory transactions

All inventory changes go through the host as **requests**:

```
client → host: MoveItemRequest { txId, itemId, from: {inv, x, y, rot}, to: {inv, x, y, rot} }
host → all:   MoveItemResult  { txId, ok, reason?, newState }
```

The client may show the move optimistically, but rolls back if the host rejects it. Hosts validate fit, proximity (for cross-inventory moves), and ownership.

### 8.4 Join flow

1. Host clicks "Play with friends" → `transport.host()` → shows share code.
2. Friend enters code → `transport.join(code)`.
3. Host sends `Welcome { protocolVersion, worldSeed, worldClock, fullStateSnapshot }`.
4. Mismatched `protocolVersion` → clear error message, not a silent failure.

### 8.5 Host leaves

For v1: session ends gracefully with a message; everyone keeps their own saved progress. Host migration is a later stretch goal.

---

## 9. World

### 9.1 Scale

The world is large: target **~8 km × 8 km** initially (tune by how it feels to cross at average boat speed; aim for 3–5 minutes edge to edge at top speed).

### 9.2 Precision: floating origin

32-bit floats (GPU, and Rapier's default build) lose precision far from the origin, causing jitter. Use a **floating origin**:

- When the local player is > 2 km from the local origin, shift the world origin to the player.
- Call `physics.rebase(offset)`, shift Three.js scene root, and track `originOffset` in world coordinates.
- **Network messages and all saved data use absolute world coordinates** (float64 in JS). Only local physics/render use rebased coordinates.
- Water function takes absolute coordinates (shader receives `originOffset` as a uniform, split into high/low parts if needed).

### 9.3 Chunks

- World divided into chunks (e.g. 512 m). Platforms, rocks, resource nodes and dropped items are loaded/unloaded by chunk around the local player.
- Physics bodies only exist for nearby chunks.
- World content is generated from a **seed** plus hand-authored data, so every peer builds the same world without transferring it.

### 9.4 Platforms (placeholder)

For now each platform is a box mesh (e.g. 20 × 4 × 20 m, distinct colour per type) with:

- A static collider.
- A **dock zone** (sensor) on one side: entering it allows interaction.
- A **platform inventory** (grid) for drop-off/pick-up.
- A name label and a job board.

```ts
interface PlatformDef {
  id: PlatformId;
  name: string;
  position: { x: number; z: number };   // absolute world coords
  size: Vec3;
  colour: string;
  dockZones: Array<{ offset: Vec3; halfExtents: Vec3 }>;
  inventoryGrid?: { width: number; height: number };
  produces?: ItemId[];   // items available for pickup jobs
  wants?: ItemId[];      // items requested for delivery jobs
}
```

Later these are replaced by Kenney docks/buildings and bespoke models without changing the data shape.

---

## 10. Gameplay systems

### 10.1 Free roam

Default state. Sail anywhere, collect floating resources, visit platforms, fish casually, bump into friends. No timers, no fail states.

### 10.2 Activities

An **activity** is a short, structured session a player starts. Other players can be invited or join nearby. The activity defines how participants interact with each other.

```ts
interface ActivityDef<Config, State> {
  id: ActivityTypeId;               // 'fishing' | 'racing' | ...
  minPlayers: number;
  maxPlayers: number;
  joinPolicy: 'solo' | 'invite' | 'open-nearby';
  /** Pure: given config + participants, build initial state. */
  create(config: Config, participants: PeerId[], ctx: SimContext): State;
  /** Pure-ish: advance one fixed step. Returns events. */
  tick(state: State, ctx: SimContext): ActivityEvent[];
  onAction(state: State, from: PeerId, action: ActivityAction, ctx: SimContext): ActivityEvent[];
  isFinished(state: State): boolean;
  results(state: State): ActivityResult;
}
```

Lifecycle (host-authoritative state machine):

```
Proposed → Lobby (invites, ready-up) → Countdown → Running → Finished → Rewards → Closed
```

Activity UI shows: who's in, objective, timer, and a clear "Leave activity" action.

**Fishing**

- Start anywhere; better spots are marked by bubbles/birds. Must be slow or stopped.
- Minigame: cast (power meter) → wait (bobber, ambient) → bite → reel (tension bar: keep the marker in the zone; fish pulls; line snaps if tension stays maxed).
- Fish table depends on region, time of day, weather.
- Caught fish are **physical items** that go into the boat's cargo grid. Full grid = must drop or discard.
- Multiplayer interactions: **shared fishing spot** (fish school depletes faster but spawns rarer fish with more people), **assist** (a nearby friend can press a button during the reel to reduce tension), joint catches for big fish (stretch).

**Racing**

- Started at a race buoy, or by a player placing a temporary course (stretch).
- Course = ordered list of gates (Kenney arch gates), defined in `data/races.ts`.
- Countdown → race → finish. Missed gates must be retaken (arrow guides).
- Multiplayer interactions: **wakes matter** (drafting behind is faster, crossing wakes slows/bounces), bumping, live positions on HUD.
- Rewards: currency, cosmetic unlocks, personal best ghosts (stretch).

### 10.3 Jobs

A **job** is a longer, objective-based task, typically pickup and/or delivery. One active job per player at a time (initially). Jobs can be shared with party members.

```ts
type JobObjective =
  | { kind: 'pickup';  item: ItemId; qty: number; at: PlatformId | WorldPoint }
  | { kind: 'deliver'; item: ItemId; qty: number; to: PlatformId }
  | { kind: 'collect'; item: ItemId; qty: number; region?: RegionId }; // e.g. gather kelp anywhere

interface JobDef {
  id: JobTypeId;
  title: string;
  description: string;
  objectives: JobObjective[];          // ordered
  timeLimitSec?: number;               // optional; most jobs untimed (cosy)
  modifiers?: Array<'fragile' | 'heavy' | 'bulky' | 'perishable'>;
  reward: { currency: number; items?: ItemStack[]; reputation?: { platform: PlatformId; amount: number } };
}
```

- Jobs are offered on **platform job boards** (generated from each platform's `produces`/`wants` plus some hand-written jobs).
- Delivery is **physical**: you must dock, open the platform inventory, and move the items in. The job completes when the platform inventory contains them.
- Modifiers:
  - `fragile` — item takes damage from hard impacts and big wave slams; value drops.
  - `heavy` — adds lots of mass; boat sits lower and handles slower.
  - `bulky` — awkward multi-cell shape; inventory tetris.
  - `perishable` — loses value over time (fish!).
- Shared jobs: party members can each carry part of the cargo.

### 10.4 Progression (later)

Currency (shells), platform reputation, boat unlocks (the Kenney boats map nicely to tiers: rowboat → small motorboat → speedboat → cargo boat → galleon), cargo grid upgrades, cosmetics.

---

## 11. Input

### 11.1 Action-based input

Game code never reads keys or buttons. It reads **actions**.

```ts
type Action =
  // Boat
  | 'throttle'        // axis -1..1
  | 'steer'           // axis -1..1
  | 'boost'
  | 'interact'        // context: dock, open nearby inventory, pick up floating item
  | 'openInventory'
  | 'activityMenu'
  | 'camera'          // 2D axis
  // UI
  | 'uiNavigate'      // 2D digital (d-pad/stick/arrows)
  | 'uiConfirm' | 'uiBack' | 'uiRotate' | 'uiSplitStack'
  | 'uiTabLeft' | 'uiTabRight'
  | 'uiDrop'
  | 'pause';
```

```ts
interface InputSnapshot {
  axis(a: Action): number;
  axis2(a: Action): { x: number; y: number };
  pressed(a: Action): boolean;     // this frame
  held(a: Action): boolean;
  released(a: Action): boolean;
  activeDevice: 'kbm' | 'gamepad';
  pointer?: { x: number; y: number; overUi: boolean };  // KBM only
}
```

- Default bindings in `data/bindings.ts` for KBM and gamepad (Xbox layout; map glyphs for PlayStation/Switch/Steam Deck).
- **Active device** switches on last input; UI button prompts update instantly.
- Rebinding stored via `Platform.saveData`.
- On Steam, Steam Input can remap on top; we still read the standard Gamepad API.

### 11.2 Default bindings (draft)

| Action | KBM | Gamepad |
|---|---|---|
| throttle | W / S | RT / LT |
| steer | A / D | Left stick X |
| boost | Shift | A (hold) |
| camera | Mouse move | Right stick |
| interact | E | X |
| openInventory | Tab / I | Y |
| activityMenu | Q | View/Back |
| pause | Esc | Menu/Start |
| uiConfirm / pick up / place | Left click / Enter | A |
| uiBack | Esc / right click | B |
| uiRotate | R / mouse wheel | Y (while holding item) |
| uiSplitStack | Shift + click | X |
| uiTabLeft / Right | — / click tabs | LB / RB |
| uiDrop (into sea) | drag outside grid | hold B / dedicated button |

---

## 12. Inventory

### 12.1 Model

Grid-based, Resident Evil / Tarkov style. Every inventory is a grid owned by something: a boat, a platform, a floating crate.

```ts
type CellShape = boolean[][];        // [row][col], true = occupied

interface ItemDef {
  id: ItemId;
  name: string;
  shape: CellShape;                  // e.g. 1x1 fish, 2x1 plank, L-shaped coral
  mass: number;                      // adds to boat mass
  maxStack: number;                  // 1 for most physical items
  tags: string[];                    // 'fish', 'fragile', 'perishable', ...
  modelId?: string;                  // world model when dropped
}

interface ItemInstance {
  id: ItemInstanceId;
  defId: ItemId;
  qty: number;
  condition?: number;                // 0..1 for fragile/perishable
}

interface PlacedItem {
  item: ItemInstance;
  x: number; y: number;              // top-left cell
  rotation: 0 | 1 | 2 | 3;           // 90° steps
}

interface InventoryGrid {
  id: InventoryId;
  owner: EntityId;
  width: number;
  height: number;
  blockedCells?: Array<[number, number]>;   // irregular hulls
  items: PlacedItem[];
}
```

Pure functions in `core/items` (all unit-tested, no UI):

- `rotateShape(shape, rotation)`
- `canPlace(grid, item, x, y, rotation, ignoreItemId?)`
- `place(grid, ...) / remove(grid, itemId) / move(...)`
- `findFirstFit(grid, item)` (tries all rotations) — used for auto-pickup and "quick transfer".
- `totalMass(grid)`
- `tryStack(grid, item)`

### 12.2 Interactions

- **Open own inventory** anywhere.
- **Open nearby inventory** (`interact`) when within range of a platform dock zone, another player's boat (if they allow it), or a floating crate. Shows two grids side by side.
- **Move** items within and between grids (validated by host, §8.3).
- **Rotate** while holding.
- **Drop into the world:** drag outside both grids (KBM) or press `uiDrop` (gamepad). Spawns a floating physical item/crate beside the boat that bobs on the water. Anyone can pick it up. Despawns after a long timeout.
- **Quick transfer:** shortcut to move the focused item to the other grid's first fit.
- **Pick up floating items:** sail into them with `interact` → auto `findFirstFit`; if no space, open inventory with the item "held" so the player can make room.

### 12.3 UI behaviour by device

**Keyboard & mouse**

- Click to pick up (item follows cursor), click to place. Also supports press-drag-release.
- Ghost preview shows footprint: green = fits, red = blocked, yellow = will swap with one item.
- R or mouse wheel rotates the held item.
- Right click / Esc while holding returns the item to its original slot.

**Controller**

- A **grid cursor** that moves cell by cell with d-pad/left stick (with repeat on hold).
- A picks up the item under the cursor; the item snaps to the cursor; A places.
- Y rotates the held item. B cancels (returns item).
- LB/RB switch focus between your grid and the other grid; the cursor jumps to the nearest sensible cell.
- Moving off the edge of a grid toward the other grid also switches focus.
- Hold B (or a dedicated button) to drop the held item into the sea, with a short hold-progress ring to prevent accidents.

**Both**

- Tooltip panel for the focused item (name, mass, condition, job relevance).
- Cargo mass bar showing effect on handling.
- Job-relevant items highlighted.

The inventory UI is built in the DOM (HTML/CSS) over the canvas, not in Three.js. It's faster to iterate on, accessible, and easy to test. A single `FocusManager` handles controller navigation for all menus.

---

## 13. Development speed and testing

The goal: **save a file → see it in under a second; run the full unit/sim suite in a few seconds.**

### 13.1 Local development

- `npm run dev` — Vite dev server in the browser with HMR. Fastest loop for solo work on visuals, UI and handling. Session restore works here too (snapshot stored via the web `Platform`).
- **Two players, one machine:** `?players=2` URL flag runs two sim instances connected by `LoopbackTransport`, rendered split-screen or with a toggle. Also `?peer=host` / `?peer=join&code=XXX` for two real browser tabs over PeerJS.
- **Dev URL flags:** `?spawn=x,z`, `?boat=speedboat`, `?activity=racing`, `?seed=123`, `?debug=physics,water,net`.
- **Debug overlays:** buoyancy points, force vectors, wake emitters, chunk bounds, net stats (RTT, packet loss, snapshot buffer).
- **lil-gui** for live-tuning boat handling and water.
- `npm run dev:desktop` — one Electron instance with full hot reload and session restore (§13.4).
- `npm run dev:duo` — two connected Electron instances (host + client) side by side, both hot reloading and resyncing automatically (§13.4). This is the main way to work on multiplayer features.

### 13.2 Test layers

| Layer | Tool | Speed target | What |
|---|---|---|---|
| Unit | Vitest | < 2s total | Inventory grid logic, shape rotation, water function golden values, job/activity state machines, serialisation round-trips |
| Sim | Vitest + `@dimforge/rapier3d-compat` in Node | < 10s total | Headless N-tick runs: boat floats and stays upright, boat reaches expected top speed, turns carve, heavy cargo slows acceleration, wakes move a nearby boat |
| Network | Vitest + `LoopbackTransport` | < 5s total | Two/three simulated peers: join flow, snapshot replication, inventory transfer validation and rejection, activity lifecycle, host leaving. With simulated latency and packet loss. |
| E2E smoke | Playwright | < 60s, run on CI not every save | App boots, boat drives, inventory opens with keyboard and with a mocked gamepad |

Rules that keep tests fast:

- Simulation tests run with **no rendering** and a fixed step; never wait on real time.
- Use a seeded RNG everywhere in `core` (`ctx.rng`), never `Math.random()`.
- `core` has no async in the tick path.
- Vitest in watch mode while developing; `--changed` in pre-commit.
- Type-check (`tsc --noEmit` with TS 7) runs in parallel to tests, not as part of the dev server.

### 13.3 Scripts

```jsonc
{
  "dev": "vite",
  "dev:desktop": "tsx tools/dev-electron.ts --instances=1",
  "dev:duo": "tsx tools/dev-electron.ts --instances=2",
  "dev:trio": "tsx tools/dev-electron.ts --instances=3",
  "dev:reset": "rimraf .dev-sessions",
  "typecheck": "tsc --noEmit",
  "lint": "biome check .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "check": "concurrently \"npm:typecheck\" \"npm:lint\" \"npm:test\"",
  "build:web": "vite build",
  "build:desktop": "vite build && electron-builder"
}
```

### 13.4 Electron hot reload and session persistence

**Goal:** edit any file, and every running Electron instance picks up the change and carries on exactly where it was: same position, same velocity, same inventory, same open menus, same activity, and still connected to the other instances with state in sync. No clicking through menus, no re-entering share codes.

#### 13.4.1 Reload tiers

Not every change needs the same treatment. The cheapest tier that works is always used.

| What changed | Tier | What happens | Typical time |
|---|---|---|---|
| `src/data/**` (tunables, items, boats) | **Hot swap** | Vite HMR; module accepts the update and the new values are applied to the live sim. No reload. | < 100 ms |
| Shaders (`*.glsl`) | **Hot swap** | HMR; materials recompile in place. No reload. | < 200 ms |
| UI styles (`*.css`) and UI components | **Hot swap** | Vite CSS HMR; UI components re-mount and re-read state from the store. | < 200 ms |
| `src/core/**`, `src/render/**`, `src/adapters/**`, `src/app/**`, input | **Renderer reload + restore** | Session snapshot → full page reload → restore → reconnect. | ~0.5–1.5 s |
| `apps/desktop/main/**`, `preload/**` | **Process restart + restore** | Orchestrator asks every instance to save, kills and relaunches Electron, restore → reconnect. | ~1.5–3 s |
| `package.json` / dependency changes | Manual | Restart `npm run dev:*`. Sessions still restore. | — |

Hot-swapping simulation logic in place (true HMR of `core`) is deliberately **not** attempted. It leads to half-old/half-new state and bugs that only exist in dev. A fast reload with a full snapshot is more reliable and nearly as quick.

#### 13.4.2 Tooling

- **Renderer:** served by the Vite dev server, so it gets standard Vite HMR.
- **Main and preload:** built by esbuild in watch mode (or Vite's build API in watch mode) inside the orchestrator.
- **`tools/dev-electron.ts`** (the orchestrator), run with `tsx`:
  1. Starts the Vite dev server.
  2. Starts the dev relay (`tools/dev-relay.ts`) on `localhost`.
  3. Starts esbuild watchers for main and preload.
  4. Launches N Electron instances, each with: `--dev-instance=A|B|C`, `--dev-role=host|client`, its own `userData` directory (so storage and caches don't collide), and a window position so instances tile side by side.
  5. On main/preload rebuild: runs the coordinated restart (§13.4.5).
  6. Prefixes each instance's logs (`[A]`, `[B]`) in one terminal.

Tools like `electron-vite` handle the single-instance case well, but they don't coordinate several Electron processes, so we own this script (~200 lines). It's dev-only code and it's worth it.

**Steam in multi-instance dev:** only one process per machine can talk to the Steam client for the same account, and Steam networking to yourself doesn't work. So in `dev:duo`/`dev:trio`, instance A may initialise steamworks.js (with App ID 480), and the others use the web `Platform` implementation. All instances use `DevSocketTransport`. Real Steam networking is tested on two machines.

#### 13.4.3 The session snapshot

The snapshot is the same machinery as save games and the late-join `Welcome` message (§8.4), just with extra dev-only fields. Building it once gives us all three.

```ts
interface SessionSnapshot {
  schemaVersion: number;          // bump when the shape changes
  buildId: string;                // hash/timestamp of the code that wrote it
  savedAt: number;                // wall clock, for staleness checks
  instance: DevInstanceId;        // 'A' | 'B' | ...

  net: {
    role: 'host' | 'client' | 'offline';
    sessionCode: string;          // fixed per dev run, e.g. 'DEV-0001'
    localPeerId: PeerId;          // stable per instance: 'dev-A'
  };

  /** Owned by this instance. Always restored locally. */
  local: {
    boats: BoatState[];           // absolute pos, rot, linVel, angVel, throttle, steer
    camera: CameraState;
    ui: UiState;                  // open screens, focused grid cell, held item, tabs
    input: { activeDevice: 'kbm' | 'gamepad' };
    devFlags: Record<string, unknown>;
    tuningOverrides: Record<string, unknown>;   // lil-gui changes not yet pasted into data/
  };

  /** Host only. The authoritative shared world. */
  world?: {
    seed: number;
    worldClock: number;
    rngState: RngState;
    inventories: InventoryGrid[];
    droppedItems: WorldItemState[];
    activities: ActivityInstanceState[];
    jobs: JobInstanceState[];
    platformState: PlatformRuntimeState[];
    remoteBoatsLastKnown: BoatState[];   // so the world isn't empty while clients reconnect
  };
}
```

Rules:

- Snapshots are built from **our own entity state**, never from Rapier internals. On restore, physics bodies are recreated through `PhysicsWorld` with their saved velocities. This keeps the feature independent of the physics engine.
- All positions are **absolute world coordinates** (§9.2). The floating origin is recomputed on restore.
- Everything in `core` state must be either **in the snapshot** or explicitly marked **transient** (particles, wake emitters, interpolation buffers). Wake emitters regenerate within a second, which is fine.
- `serializeSession` / `restoreSession` live in `src/app` (they touch every system); the dev-only extras live in `src/dev`.

**Where it's stored:** written by the main process to `.dev-sessions/<instance>.json` via IPC. Disk (not `sessionStorage`) is used because it survives main-process restarts, crashes and the orchestrator being restarted.

**When it's saved:**

1. On Vite's `vite:beforeFullReload` event (renderer reload tier).
2. When the orchestrator requests it before a process restart (IPC `dev:save-now`, renderer acks).
3. Every 2 seconds as a safety net, so even a crash loses at most a moment.

#### 13.4.4 Restoring after a change

On boot, in dev mode, the app checks for `.dev-sessions/<instance>.json`:

1. **Validate.** Check `schemaVersion`. If it doesn't match, run a migration if one exists; otherwise do a **best-effort restore**: keep what still parses (boat position, camera, UI), drop the rest, and log a clear warning in the console and an on-screen toast. Restore must **never crash the app**. Worst case: fresh start at the saved position.
2. **Rebuild the world.** Same seed → same platforms and chunks. Host restores `world`.
3. **Restore local state.** Boats, camera, UI, held item.
4. **Pause briefly.** The local sim stays paused (with a small "resyncing" indicator) until the network step finishes or 3 seconds pass, so the boat doesn't drift during reconnect.
5. **Reconnect** (below), then resume.

Disable restore any time with `?fresh=1` / `--fresh`, or wipe everything with `npm run dev:reset`.

#### 13.4.5 Multi-instance resync choreography

Both instances load from the same Vite server, so a renderer change hits them at nearly the same moment. The protocol has to handle any order: host first, client first, or simultaneous.

**Stable identity.** Each dev instance always has the same peer ID (`dev-A`, `dev-B`) and the session code is fixed for the dev run. Instance A is host by default (override with `--dev-role`). Nobody has to share a code after a reload.

**Build handshake.** Every `Hello` message includes `buildId`. Peers only resync when their `buildId`s match. If a client reconnects and the host is still on an old build (or is mid-reload), the client shows "Waiting for host to reload…" and retries. This prevents an old-code instance from sending state to a new-code instance in a format it doesn't understand.

**Flow when the host reloads:**

```
Client B: notices host disconnected → enters 'reconnecting', keeps simulating its own boat
Host A:   saves snapshot → reloads → restores world → opens session 'DEV-0001' as dev-A
Client B: reconnects (retry with backoff: 100ms, 200ms, 400ms … max 2s)
B → A:    Hello { buildId, ownedBoats: [current state] }
A → B:    Welcome { world snapshot }
B:        applies world, keeps its own boats (it owns them), resumes
```

**Flow when the client reloads:**

```
Client B: saves snapshot → reloads → restores own boats/UI → reconnects as dev-B
B → A:    Hello { buildId, ownedBoats }
A:        recognises dev-B as a returning peer (doesn't spawn a new boat), sends Welcome
```

**Flow when both reload (the normal case for a renderer change):** both save, both reload, host restores from its snapshot, client restores its own state and retries until the host is up with a matching `buildId`. Result: everyone lands back in the same synced world.

**Process restart (main/preload changed):**

```
Orchestrator → all instances: dev:save-now
Instances → orchestrator:     ack (or 1s timeout)
Orchestrator:                 kill all → relaunch all with the same flags → host first, then clients 300ms later
```

**Authority on reconnect follows §8.1:** clients are the source of truth for their own boats; the host is the source of truth for everything shared. So there's never a merge conflict: each piece of state has exactly one owner, and that owner's snapshot wins.

**Returning peers in production too.** "Peer with a known ID reconnects and reclaims its boat" is the same logic as a real player recovering from a dropped connection, so this dev work directly pays off in the shipping game.

#### 13.4.6 Hot-swap details

- **Data modules:** each file in `src/data` that is safe to hot-swap calls `import.meta.hot.accept(newModule => registry.update(newModule))`. Systems read tunables from the registry each tick (or subscribe to changes), never cache them at startup.
- **Shaders:** GLSL is imported as strings; on update, the material's shader is swapped and `material.needsUpdate = true`. The TS water function is in `core`, so changing it triggers a reload tier, which keeps the two copies in step.
- **lil-gui overrides** are kept in the session snapshot so a code reload doesn't throw away tuning you haven't copied into `src/data` yet.
- **Multi-instance:** data hot swaps happen in every instance at the same time. Tunables that affect shared simulation (e.g. Gerstner wave parameters) include a `dataVersion` in snapshots; if two instances briefly disagree, the host broadcasts its `dataVersion` and clients warn rather than silently desync.

#### 13.4.7 Dev indicator

A small overlay in the corner shows: instance (`A · host`), build ID, net state (`connected · 2 peers`), last restore result (`restored 0.8s ago` / `partial restore: dropped activities`). Clicking it opens the last restore log.

#### 13.4.8 Tests

- **Round-trip:** `restoreSession(serializeSession(state))` produces equal state, for a populated world (boats, inventories with rotated items, an activity mid-run, a job in progress, dropped items).
- **Migration:** old snapshots from `tests/fixtures/sessions/` restore without throwing.
- **Reconnect choreography** over `LoopbackTransport`: host drops and returns; client drops and returns; both drop and return in either order; mismatched `buildId` waits then succeeds. Each test asserts the final world state matches across peers.
- These run in the normal Vitest suite in well under a second each.

#### 13.4.9 Production safety

Everything in `src/dev` and `transport/devsocket` is imported only behind `import.meta.env.DEV` so it's tree-shaken out of production builds. The orchestrator and relay never ship. A CI check greps the production bundle for `dev:save-now` and `DevSocketTransport` and fails if they're present.

---

## 14. Rules for AI agents

Copy the essentials into `CLAUDE.md` (and any other agent instruction file).

1. **`src/core` is pure.** No imports from Three.js, DOM, PeerJS, Rapier, Electron, or `render/ui/input/adapters`. Core talks to the world only through the interfaces in §5.
2. **Never call Rapier, PeerJS or steamworks.js outside `src/adapters`.**
3. **The water function exists twice (TS and GLSL) and must stay identical.** Any change to one requires the same change to the other and an update to the golden-value test.
4. **Game code reads actions, never raw keys/buttons.** Every new interaction needs a KBM binding *and* a gamepad binding *and* a UI prompt.
5. **Every new UI screen must be fully usable with a controller** via `FocusManager`.
6. **All tunable numbers live in `src/data`**, not inline in logic.
7. **Shared/world state changes go through the host.** Clients send requests; the host validates and broadcasts.
8. **Network messages and saves use absolute world coordinates**; physics and rendering use rebased local coordinates.
9. **Seeded RNG only** in `core`.
10. **Add or update tests with every core change.** Prefer sim tests over E2E.
11. **Use Kenney asset filenames as-is**; map them to game IDs in `data/models.ts`.
12. When unsure about an API for a library, read the installed package's types in `node_modules` rather than guessing.
13. **Every new piece of state must be in the session snapshot or explicitly marked transient** (§13.4.3), with the round-trip test updated. If the snapshot shape changes, bump `schemaVersion` and add a migration or make sure best-effort restore handles it.
14. **Tunables are read from the data registry, never cached at startup**, so they can hot swap.
15. **Dev-only code stays behind `import.meta.env.DEV`.**

---

## 15. Milestones

Each milestone ends with something playable.

**M0 — Scaffold**
Vite + TS 7 + Biome + Vitest; empty `core`/`adapters` structure; interfaces from §5 stubbed; `LoopbackTransport`; CI running `npm run check`. Electron shell, dev orchestrator (`dev:desktop`), and the session snapshot skeleton (camera + dev flags only). From here on, **every milestone extends the snapshot** to cover the state it adds.

**M1 — Boat in water**
Gerstner water shader + matching TS function, one Kenney boat with buoyancy and weighted handling, chase camera, lil-gui tuning, KBM + gamepad driving. Sim tests for floating/stability/top speed.
*Exit test: driving around an empty ocean is fun for 5 minutes.*

**M2 — Wakes**
Wake emitters, shader integration, buoyancy integration. AI dummy boat to test wake interaction.

**M3 — Multiplayer**
PeerJS transport, share codes, TURN config, join flow, snapshot interpolation, remote hulls, bumps. Network tests over loopback with latency. `DevSocketTransport`, dev relay, `dev:duo`, returning-peer reconnection and the multi-instance resync choreography (§13.4.5).
*Exit test: two players on different networks drive together and feel each other's wakes.*

**M4 — Large world**
Floating origin, chunk streaming, placeholder platforms with dock zones, world seed, minimap/compass.

**M5 — Inventory**
Grid logic + tests, DOM inventory UI, KBM and controller interaction, cargo mass affecting handling, drop into sea, floating item pickup, platform inventories, host-validated transfers.

**M6 — Jobs**
Job framework, platform job boards, pickup and delivery jobs, modifiers (start with `heavy` and `bulky`), rewards/currency.

**M7 — Activities**
Activity framework and lifecycle, fishing minigame, racing with gates.

**M8 — Desktop & Steam**
Production Electron packaging, steamworks.js via preload, Steam Cloud saves, achievements, Steam invites (still using PeerJS), then evaluate `SteamTransport`.

**Later:** weather and day/night, progression and boat unlocks, real platform art, magical elements (glowing currents, ghost ship trader), host migration, accessibility options, audio.

---

## 16. Open questions

- Max players per session? (Proposed: 4 for v1, design data structures for 8.)
- Persistence: is the world per-host (host's save) or per-player? Proposed: each player saves their own boat, inventory and progression; world state (platform reputation, etc.) saves with the host.
- Can players access each other's boat inventories freely, or only when permission is granted? Proposed: a per-player toggle, default "friends can take/give".
- Should dropped items be visible/collectable by everyone, including strangers in future public lobbies?
- Fishing minigame style: tension bar vs. rhythm/timing — prototype both quickly in M7.
- Do we need a party system separate from the session, or is "everyone in the session" the party for v1?
