import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { cameraTunables } from '../data/camera.ts';
import type { InputSnapshot } from '../input/actions.ts';

/** In the session snapshot (§13.4.3). Absolute yaw/pitch of the camera around its target. */
export interface CameraState {
  yaw: number;
  pitch: number;
}

export interface ChaseTarget {
  position: Vector3;
  /** Boat heading, radians about +Y (0 faces +Z). */
  heading: number;
  /** m/s */
  speed: number;
  /** Bigger boats pull the camera back and up. Default 1. */
  scale?: number;
}

/**
 * Chase camera (§7.4): springs behind the boat, lags on turns, pulls back and
 * widens with speed, and never rolls (horizon-stabilised). Players can swing it
 * with the camera action; it drifts back behind the boat once they let go.
 */
export class ChaseCamera {
  state: CameraState = { yaw: Math.PI, pitch: cameraTunables.defaultPitch };

  // Transient smoothing state; rebuilt from the target on the first frame.
  private readonly focus = new Vector3();
  private hasFocus = false;
  private distance = cameraTunables.distance;
  private fov = cameraTunables.fov;
  private sinceManual = Number.POSITIVE_INFINITY;

  constructor(readonly camera: PerspectiveCamera) {}

  update(input: InputSnapshot, dt: number, target: ChaseTarget): void {
    const t = cameraTunables;

    const rate = input.axis2('camera');
    const delta = input.axis2Delta('camera');
    const dYaw = rate.x * t.stickYawSpeed * dt + delta.x * t.mouseSensitivity;
    const dPitch = rate.y * t.stickPitchSpeed * dt + delta.y * t.mouseSensitivity;
    if (dYaw !== 0 || dPitch !== 0) this.sinceManual = 0;
    else this.sinceManual += dt;
    this.state.yaw -= dYaw;
    this.state.pitch += dPitch;

    // Auto-follow: swing back behind the boat once the player lets go and we're moving.
    if (this.sinceManual > t.recenterDelay && target.speed > t.recenterMinSpeed) {
      const behind = target.heading + Math.PI;
      this.state.yaw += wrapAngle(behind - this.state.yaw) * smoothing(t.yawFollowRate, dt);
      this.state.pitch += (t.defaultPitch - this.state.pitch) * smoothing(t.pitchFollowRate, dt);
    }
    this.state.yaw = wrapAngle(this.state.yaw);
    this.state.pitch = MathUtils.clamp(this.state.pitch, t.minPitch, t.maxPitch);

    const scale = target.scale ?? 1;
    const restDistance = t.distance * scale;
    if (!this.hasFocus) {
      this.focus.copy(target.position);
      this.distance = restDistance + target.speed * t.distancePerSpeed;
      this.hasFocus = true;
    }
    const k = smoothing(t.positionFollowRate, dt);
    this.focus.x += (target.position.x - this.focus.x) * k;
    this.focus.z += (target.position.z - this.focus.z) * k;
    this.focus.y += (target.position.y - this.focus.y) * smoothing(t.verticalFollowRate, dt);

    const zoom = smoothing(t.zoomFollowRate, dt);
    this.distance += (restDistance + target.speed * t.distancePerSpeed - this.distance) * zoom;
    const speedFov = t.fov + t.fovBoost * MathUtils.clamp(target.speed / t.fovSpeedRef, 0, 1);
    this.fov += (speedFov - this.fov) * zoom;

    const c = this.camera;
    if (c.fov !== this.fov || c.near !== t.near || c.far !== t.far) {
      c.fov = this.fov;
      c.near = t.near;
      c.far = t.far;
      c.updateProjectionMatrix();
    }

    const { yaw, pitch } = this.state;
    const lookY = this.focus.y + t.targetHeight * scale;
    c.position.set(
      this.focus.x + Math.sin(yaw) * Math.cos(pitch) * this.distance,
      lookY + Math.sin(pitch) * this.distance,
      this.focus.z + Math.cos(yaw) * Math.cos(pitch) * this.distance,
    );
    // Keep the camera above the waves.
    c.position.y = Math.max(c.position.y, 1);
    c.up.set(0, 1, 0);
    c.lookAt(this.focus.x, lookY, this.focus.z);
  }

  /** Snap to the target next frame (after a restore or teleport). */
  resetSmoothing(): void {
    this.hasFocus = false;
  }
}

/** Frame-rate independent exponential smoothing factor. */
function smoothing(ratePerSecond: number, dt: number): number {
  return 1 - Math.exp(-ratePerSecond * dt);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
