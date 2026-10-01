import { liveTunable } from './registry.ts';

/** Chase camera (§7.3). Rates are "per second" for exponential smoothing. */
export interface CameraTunables {
  fov: number;
  /** Extra FOV (degrees) at fovSpeedRef and above. */
  fovBoost: number;
  fovSpeedRef: number;
  near: number;
  far: number;
  /** Radians per second at full stick deflection. */
  stickYawSpeed: number;
  stickPitchSpeed: number;
  /** Radians per pixel of mouse movement. */
  mouseSensitivity: number;
  minPitch: number;
  maxPitch: number;
  defaultPitch: number;
  /** Distance behind the boat at rest, plus distancePerSpeed metres per m/s. */
  distance: number;
  distancePerSpeed: number;
  /** Height of the look-at point above the boat. */
  targetHeight: number;
  /** How fast the camera swings back behind the boat. Lower = more lag on turns. */
  yawFollowRate: number;
  pitchFollowRate: number;
  /** Seconds after manual camera input before auto-follow resumes. */
  recenterDelay: number;
  /** Below this speed (m/s) the camera stays where the player put it. */
  recenterMinSpeed: number;
  positionFollowRate: number;
  /** Slower vertical follow so bobbing doesn't shake the view. */
  verticalFollowRate: number;
  zoomFollowRate: number;
}

export const cameraTunables = liveTunable<CameraTunables>('camera', {
  fov: 60,
  fovBoost: 10,
  fovSpeedRef: 18,
  near: 0.1,
  far: 4000,
  stickYawSpeed: 2.5,
  stickPitchSpeed: 1.5,
  mouseSensitivity: 0.004,
  minPitch: 0.05,
  maxPitch: 1.3,
  defaultPitch: 0.28,
  distance: 11,
  distancePerSpeed: 0.25,
  targetHeight: 1.6,
  yawFollowRate: 2.2,
  pitchFollowRate: 1.5,
  recenterDelay: 1.5,
  recenterMinSpeed: 1,
  positionFollowRate: 10,
  verticalFollowRate: 3,
  zoomFollowRate: 1.5,
});

import.meta.hot?.accept();
