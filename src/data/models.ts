/**
 * Game model IDs → Kenney Watercraft Kit files, used as-is (§14.11).
 * Paths are relative to the served assets root.
 */
export const models = {
  'boat.rowSmall': 'kenney-watercraft/boat-row-small.glb',
  'boat.rowLarge': 'kenney-watercraft/boat-row-large.glb',
  'boat.fishingSmall': 'kenney-watercraft/boat-fishing-small.glb',
  'boat.speedA': 'kenney-watercraft/boat-speed-a.glb',
  'boat.speedJ': 'kenney-watercraft/boat-speed-j.glb',
  'boat.fan': 'kenney-watercraft/boat-fan.glb',
  'boat.sailA': 'kenney-watercraft/boat-sail-a.glb',
  'boat.tugA': 'kenney-watercraft/boat-tug-a.glb',
  'ship.cargoA': 'kenney-watercraft/ship-cargo-a.glb',
  'ship.large': 'kenney-watercraft/ship-large.glb',
  'prop.buoy': 'kenney-watercraft/buoy.glb',
  'prop.buoyFlag': 'kenney-watercraft/buoy-flag.glb',
  'prop.gate': 'kenney-watercraft/gate.glb',
  'prop.gateFinish': 'kenney-watercraft/gate-finish.glb',
  'prop.cargoPileA': 'kenney-watercraft/cargo-pile-a.glb',
} as const satisfies Record<string, string>;

export type ModelId = keyof typeof models;
