import { liveTunable } from './registry.ts';

/**
 * Placeholder platforms (§9.4). Grows into the full PlatformDef (dock zones,
 * inventories, produces/wants) in M4.
 */
export interface PlaceholderPlatform {
  id: string;
  name: string;
  /** Absolute world coordinates. */
  position: { x: number; z: number };
  size: { x: number; y: number; z: number };
  colour: string;
}

export const platforms = liveTunable<{ list: PlaceholderPlatform[] }>('platforms', {
  list: [
    {
      id: 'saltmarket',
      name: 'Saltmarket',
      position: { x: 60, z: -40 },
      size: { x: 20, y: 4, z: 20 },
      colour: '#d9a066',
    },
    {
      id: 'kelpwick',
      name: 'Kelpwick',
      position: { x: -90, z: -120 },
      size: { x: 20, y: 4, z: 20 },
      colour: '#8fbf6a',
    },
    {
      id: 'coralhaven',
      name: 'Coral Haven',
      position: { x: 140, z: 110 },
      size: { x: 20, y: 4, z: 20 },
      colour: '#c97a9a',
    },
  ],
});

import.meta.hot?.accept();
