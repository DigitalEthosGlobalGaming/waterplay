import { liveTunable } from './registry.ts';

/** One Gerstner wave (§6.1). */
export interface WaveParams {
  /** Travel direction in degrees, 0 = +Z, 90 = +X. */
  directionDeg: number;
  /** Metres crest to crest. */
  wavelength: number;
  /** Metres, crest height above rest. */
  amplitude: number;
  /**
   * Crest sharpness 0..1 (k × horizontal displacement). The sum over all waves
   * must stay below 1 or crests loop over themselves; it is clamped if not.
   */
  sharpness: number;
  /** Multiplier on deep-water wave speed. 1 = physical. */
  speedScale: number;
}

export interface WaterParams {
  /** Global multiplier on every wave's amplitude. 0 = flat calm. */
  amplitudeScale: number;
  waves: WaveParams[];
}

/** Shared by the TS water function and the shader. Change either → both. */
export const waterParams = liveTunable<WaterParams>('water', {
  amplitudeScale: 1,
  waves: [
    { directionDeg: 20, wavelength: 62, amplitude: 0.55, sharpness: 0.25, speedScale: 1 },
    { directionDeg: -35, wavelength: 31, amplitude: 0.3, sharpness: 0.25, speedScale: 1 },
    { directionDeg: 70, wavelength: 17, amplitude: 0.14, sharpness: 0.2, speedScale: 1 },
    { directionDeg: 145, wavelength: 9, amplitude: 0.06, sharpness: 0.15, speedScale: 1 },
  ],
});

/** Render-only look of the water (§6.3). Lighting comes from the day/night cycle (data/sky.ts). */
export interface WaterLook {
  deepColour: string;
  /** Crest / scattered-light colour. */
  shallowColour: string;
  foamColour: string;
  /** Foam fades in as the crest fold drops from foamEnd to foamStart (1 = flat, 0 = folding). */
  foamStart: number;
  foamEnd: number;
  /** Reflectance looking straight down (Schlick F0). */
  fresnel: number;
  /** Overall strength of the sky reflection. */
  reflection: number;
  specular: number;
  shininess: number;
  diffuse: number;
  /** Light glowing through crests when looking toward the sun. */
  scatter: number;
  /** 0..1 of a cell: how far vertices are nudged off the grid for an organic low-poly look. */
  jitter: number;
  /** Distances (m) over which facets calm to flat, to stop far-away shimmer. */
  normalFadeStart: number;
  normalFadeEnd: number;
  /** Distances (m) over which waves fade to flat at the edge of the water mesh. */
  waveFadeStart: number;
  waveFadeEnd: number;
}

export const waterLook = liveTunable<WaterLook>('waterLook', {
  deepColour: '#0b4f7c',
  shallowColour: '#2bb5c6',
  foamColour: '#ffffff',
  foamStart: 0.32,
  foamEnd: 0.5,
  fresnel: 0.04,
  reflection: 0.85,
  specular: 1.2,
  shininess: 140,
  diffuse: 0.55,
  scatter: 0.5,
  jitter: 0.7,
  normalFadeStart: 150,
  normalFadeEnd: 700,
  waveFadeStart: 400,
  waveFadeEnd: 900,
});

import.meta.hot?.accept();
