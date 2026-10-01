import { liveTunable } from './registry.ts';

/**
 * One point on the day cycle. `t` is time of day: 0 midnight, 0.25 sunrise,
 * 0.5 noon, 0.75 sunset. Colours blend between neighbouring keyframes.
 */
export interface SkyKeyframe {
  t: number;
  zenith: string;
  horizon: string;
  /** Colour of the main light (the sun by day, the moon by night). */
  light: string;
  lightIntensity: number;
  /** Hemisphere ambient: sky side and water side. */
  ambientSky: string;
  ambientGround: string;
  ambientIntensity: number;
}

export interface SkyTunables {
  /** Seconds per full day. Snapped so a whole number of days fits the world clock loop. */
  dayLengthSeconds: number;
  /** Time of day (0..1) when the world clock is 0. Scrub this to preview the cycle. */
  timeOffset: number;
  /** How far the sun's path leans toward the south (radians). 0 passes straight overhead. */
  sunTilt: number;
  fogNear: number;
  fogFar: number;
  sunDiscSize: number;
  starDensity: number;
  keyframes: SkyKeyframe[];
}

export const skyTunables = liveTunable<SkyTunables>('sky', {
  dayLengthSeconds: 1200,
  timeOffset: 0.33,
  sunTilt: 0.45,
  fogNear: 250,
  fogFar: 1300,
  sunDiscSize: 0.035,
  starDensity: 0.5,
  keyframes: [
    {
      t: 0,
      zenith: '#070b1f',
      horizon: '#1a2547',
      light: '#8fa8ff',
      lightIntensity: 0.45,
      ambientSky: '#2a3a6e',
      ambientGround: '#0a1630',
      ambientIntensity: 0.55,
    },
    {
      t: 0.21,
      zenith: '#141c45',
      horizon: '#4a4670',
      light: '#8fa8ff',
      lightIntensity: 0.35,
      ambientSky: '#3a3f72',
      ambientGround: '#121b3a',
      ambientIntensity: 0.6,
    },
    {
      t: 0.27,
      zenith: '#4b74b8',
      horizon: '#f5a66e',
      light: '#ffb27a',
      lightIntensity: 1.3,
      ambientSky: '#9aa8d6',
      ambientGround: '#3a4a6a',
      ambientIntensity: 0.8,
    },
    {
      t: 0.36,
      zenith: '#4f9ee6',
      horizon: '#bfe4f5',
      light: '#fff0d8',
      lightIntensity: 2,
      ambientSky: '#bfe0ff',
      ambientGround: '#2f7fa0',
      ambientIntensity: 1,
    },
    {
      t: 0.5,
      zenith: '#3f97e6',
      horizon: '#c9ecfa',
      light: '#ffffff',
      lightIntensity: 2.3,
      ambientSky: '#c9e6ff',
      ambientGround: '#2f86a8',
      ambientIntensity: 1.1,
    },
    {
      t: 0.66,
      zenith: '#4a92dc',
      horizon: '#cfe6f0',
      light: '#fff1dc',
      lightIntensity: 2,
      ambientSky: '#c0dcf5',
      ambientGround: '#2f7fa0',
      ambientIntensity: 1,
    },
    {
      t: 0.74,
      zenith: '#4a5a9e',
      horizon: '#ff9a5c',
      light: '#ff9055',
      lightIntensity: 1.3,
      ambientSky: '#b08fb0',
      ambientGround: '#3a3f60',
      ambientIntensity: 0.8,
    },
    {
      t: 0.8,
      zenith: '#1a2050',
      horizon: '#6e4870',
      light: '#8fa8ff',
      lightIntensity: 0.35,
      ambientSky: '#3e3a70',
      ambientGround: '#121a38',
      ambientIntensity: 0.6,
    },
  ],
});

/** Clouds: low-poly puffs that drift with the wind (render only). */
export interface CloudTunables {
  count: number;
  minHeight: number;
  maxHeight: number;
  /** Clouds tile over a square this wide (m) around the camera. */
  spread: number;
  /** m/s */
  windX: number;
  windZ: number;
  colour: string;
}

export const cloudTunables = liveTunable<CloudTunables>('clouds', {
  count: 36,
  minHeight: 140,
  maxHeight: 240,
  spread: 2400,
  windX: 4,
  windZ: 1.5,
  colour: '#ffffff',
});

import.meta.hot?.accept();
