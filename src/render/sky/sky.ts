import {
  BackSide,
  Color,
  type DirectionalLight,
  type Fog,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { cyclicKeyframes, sunDirection, timeOfDay } from '../../core/world/time-of-day.ts';
import { simTunables } from '../../data/sim.ts';
import { type SkyKeyframe, skyTunables } from '../../data/sky.ts';
import skyFragment from './sky.frag.glsl?raw';
import skyCommon from './sky-common.glsl?raw';

const SKY_RADIUS = 3000;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Uniform objects shared (by reference) with every material that uses sky-common.glsl. */
export function createSkyUniforms() {
  return {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunGlow: { value: new Color() },
  };
}
export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

export const SKY_COMMON_GLSL = skyCommon;

/** This frame's lighting, derived from the world clock (§ day/night). */
export interface SkyLighting {
  timeOfDay: number;
  /** 0 full day .. 1 full night. */
  night: number;
  /** Direction toward whichever of sun/moon lights the world. */
  lightDir: Vector3;
  /** Light colour already multiplied by intensity. */
  lightColour: Color;
  ambientSky: Color;
  ambientGround: Color;
}

/**
 * Day/night cycle: owns the sky dome, the hemisphere light and drives the
 * directional light and fog. Everything is a pure function of the world clock
 * and data/sky.ts, read live each frame.
 */
export class Sky {
  readonly uniforms = createSkyUniforms();
  readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  readonly hemisphere = new HemisphereLight();
  readonly lighting: SkyLighting = {
    timeOfDay: 0,
    night: 0,
    lightDir: new Vector3(0, 1, 0),
    lightColour: new Color(),
    ambientSky: new Color(),
    ambientGround: new Color(),
  };

  private readonly domeUniforms = {
    uSunDisc: { value: new Color() },
    uSunDiscSize: { value: 0.03 },
    uNight: { value: 0 },
    uStarDensity: { value: 0.5 },
  };
  private readonly a = new Color();
  private readonly b = new Color();

  constructor() {
    const material = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyCommon + skyFragment,
      uniforms: { ...this.uniforms, ...this.domeUniforms },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 16), material);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    domes.add(material);
  }

  update(worldClock: number, cameraPosition: Vector3, sun: DirectionalLight, fog: Fog): void {
    const s = skyTunables;
    const t = timeOfDay(worldClock, s, simTunables.worldClockLoopPeriod);
    const L = this.lighting;
    L.timeOfDay = t;

    const keys = s.keyframes;
    const { from, to, f } = cyclicKeyframes(
      keys.map((k) => k.t),
      t,
    );
    const k0 = keys[from];
    const k1 = keys[to];
    if (!k0 || !k1) return;
    const blend = (pick: (k: SkyKeyframe) => string, out: Color) =>
      out.lerpColors(this.a.set(pick(k0)), this.b.set(pick(k1)), f);
    const mix = (pick: (k: SkyKeyframe) => number) => pick(k0) + (pick(k1) - pick(k0)) * f;

    const sunDir = sunDirection(t, s.sunTilt);
    const u = this.uniforms;
    u.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z);
    blend((k) => k.zenith, u.uZenith.value);
    blend((k) => k.horizon, u.uHorizon.value);

    // Sun by day, moon by night. The light fades out right at the horizon so the swap is invisible.
    const elevation = sunDir.y;
    const sign = elevation >= 0 ? 1 : -1;
    L.lightDir.set(sunDir.x * sign, sunDir.y * sign, sunDir.z * sign);
    const horizonFade = smoothstep(0, 0.08, Math.abs(elevation));
    blend((k) => k.light, L.lightColour).multiplyScalar(mix((k) => k.lightIntensity) * horizonFade);
    L.night = smoothstep(0.05, -0.12, elevation);

    const sunVisible = smoothstep(-0.04, 0.02, elevation);
    blend((k) => k.light, u.uSunGlow.value).multiplyScalar(sunVisible);
    this.domeUniforms.uSunDisc.value.copy(u.uSunGlow.value).multiplyScalar(4);
    this.domeUniforms.uSunDiscSize.value = s.sunDiscSize;
    this.domeUniforms.uNight.value = L.night;
    this.domeUniforms.uStarDensity.value = s.starDensity;

    const ambient = mix((k) => k.ambientIntensity);
    blend((k) => k.ambientSky, L.ambientSky).multiplyScalar(ambient);
    blend((k) => k.ambientGround, L.ambientGround).multiplyScalar(ambient);
    this.hemisphere.color.copy(L.ambientSky);
    this.hemisphere.groundColor.copy(L.ambientGround);
    this.hemisphere.intensity = 1;

    blend((k) => k.light, sun.color);
    sun.intensity = mix((k) => k.lightIntensity) * horizonFade;

    fog.color.copy(u.uHorizon.value);
    fog.near = s.fogNear;
    fog.far = s.fogFar;

    this.dome.position.copy(cameraPosition);
  }

  dispose(): void {
    domes.delete(this.dome.material);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
  }
}

const domes = new Set<ShaderMaterial>();

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Shader hot swap (§13.4.6).
if (import.meta.hot) {
  import.meta.hot.accept(['./sky-common.glsl?raw', './sky.frag.glsl?raw'], ([common, frag]) => {
    for (const m of domes) {
      m.fragmentShader =
        String(common?.default ?? skyCommon) + String(frag?.default ?? skyFragment);
      m.needsUpdate = true;
    }
  });
}
