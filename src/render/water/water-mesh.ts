import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { MAX_WAVES, waveConstants, wavePhases } from '../../core/water/gerstner.ts';
import { simTunables } from '../../data/sim.ts';
import { waterLook, waterParams } from '../../data/water.ts';
import { SKY_COMMON_GLSL, type SkyLighting, type SkyUniforms } from '../sky/sky.ts';
import fragmentShader from './water.frag.glsl?raw';
import vertexShader from './water.vert.glsl?raw';

/** Inner grid: uniform cells, so snapping by one cell never makes it swim. */
const INNER_CELLS = 110;
/** Big enough that individual facets read as low-poly. */
const CELL_SIZE = 3;
/** Outer rings: each cell GROWTH× the last, reaching ~1.3 km. Fog hides the coarse edge. */
const OUTER_CELLS = 50;
const GROWTH = 1.06;
/**
 * The mesh follows the camera in steps of two cells, so each vertex stays on
 * the same world grid point and the alternating triangle diagonals never flip.
 */
const SNAP = CELL_SIZE * 2;

const materials = new Set<ShaderMaterial>();

export interface WaterFrame {
  /** World clock (s) to draw the surface at. */
  time: number;
  /** World xz the grid should centre on (usually the camera). */
  centreX: number;
  centreZ: number;
  lighting: SkyLighting;
}

/**
 * The visible sea: a camera-following grid displaced by the same Gerstner
 * function the simulation uses for buoyancy.
 */
export class WaterMesh extends Mesh<BufferGeometry, ShaderMaterial> {
  private readonly u: ReturnType<typeof waterUniforms>;

  constructor(sky: SkyUniforms) {
    const u = waterUniforms();
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader: SKY_COMMON_GLSL + fragmentShader,
      fog: true,
      // Fog uniforms are cloned by merge; ours and the sky's are shared by reference.
      uniforms: { ...UniformsUtils.merge([UniformsLib.fog]), ...u, ...sky },
    });
    super(buildGrid(), material);
    this.u = u;
    this.frustumCulled = false;
    materials.add(material);
  }

  /** Called once per frame; reads water tunables live so they hot swap. */
  update(f: WaterFrame): void {
    this.position.set(Math.round(f.centreX / SNAP) * SNAP, 0, Math.round(f.centreZ / SNAP) * SNAP);

    const waves = waveConstants(waterParams, simTunables.gravity, simTunables.worldClockLoopPeriod);
    const phases = wavePhases(waves, f.time);
    let amplitude = 0;
    const u = this.u;
    waves.forEach((w, i) => {
      u.uWaveA.value[i]?.set(w.dirX, w.dirZ, w.k, phases[i] ?? 0);
      u.uWaveB.value[i]?.set(w.amplitude, w.horiz);
      amplitude += w.amplitude;
    });

    const look = waterLook;
    u.uWaveCount.value = waves.length;
    u.uCentre.value.set(this.position.x, this.position.z);
    u.uFadeStart.value = look.waveFadeStart;
    u.uFadeEnd.value = Math.max(look.waveFadeStart + 1, look.waveFadeEnd);
    u.uCell.value = CELL_SIZE;
    u.uJitter.value = look.jitter;
    u.uJitterRadius.value = INNER_CELLS * CELL_SIZE - SNAP;
    u.uDeep.value.set(look.deepColour);
    u.uShallow.value.set(look.shallowColour);
    u.uFoam.value.set(look.foamColour);
    u.uLightDir.value.copy(f.lighting.lightDir);
    u.uLightColour.value.copy(f.lighting.lightColour);
    u.uAmbientSky.value.copy(f.lighting.ambientSky);
    u.uAmbientGround.value.copy(f.lighting.ambientGround);
    u.uDiffuse.value = look.diffuse;
    u.uAmplitude.value = Math.max(0.01, amplitude);
    u.uFoamStart.value = look.foamStart;
    u.uFoamEnd.value = Math.max(look.foamStart + 0.001, look.foamEnd);
    u.uFresnel.value = look.fresnel;
    u.uReflection.value = look.reflection;
    u.uSpecular.value = look.specular;
    u.uShininess.value = look.shininess;
    u.uScatter.value = look.scatter;
    u.uNormalFadeStart.value = look.normalFadeStart;
    u.uNormalFadeEnd.value = Math.max(look.normalFadeStart + 1, look.normalFadeEnd);
  }

  override dispose(): void {
    materials.delete(this.material);
    this.geometry.dispose();
    this.material.dispose();
  }
}

function waterUniforms() {
  return {
    uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new Vector4()) },
    uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new Vector2()) },
    uWaveCount: { value: 0 },
    uCentre: { value: new Vector2() },
    uFadeStart: { value: 0 },
    uFadeEnd: { value: 1 },
    uCell: { value: CELL_SIZE },
    uJitter: { value: 0 },
    uJitterRadius: { value: 0 },
    uDeep: { value: new Color() },
    uShallow: { value: new Color() },
    uFoam: { value: new Color() },
    uLightDir: { value: new Vector3(0, 1, 0) },
    uLightColour: { value: new Color() },
    uAmbientSky: { value: new Color() },
    uAmbientGround: { value: new Color() },
    uDiffuse: { value: 0.6 },
    uAmplitude: { value: 1 },
    uFoamStart: { value: 0.3 },
    uFoamEnd: { value: 0.5 },
    uFresnel: { value: 0.04 },
    uReflection: { value: 1 },
    uSpecular: { value: 1 },
    uShininess: { value: 100 },
    uScatter: { value: 0.5 },
    uNormalFadeStart: { value: 150 },
    uNormalFadeEnd: { value: 700 },
  };
}

/** Grid coordinates along one axis: uniform near the centre, then growing outward. */
function axisCoordinates(): number[] {
  const positive: number[] = [];
  for (let i = 1; i <= INNER_CELLS; i++) positive.push(i * CELL_SIZE);
  let at = INNER_CELLS * CELL_SIZE;
  let step = CELL_SIZE;
  for (let i = 0; i < OUTER_CELLS; i++) {
    step *= GROWTH;
    at += step;
    positive.push(at);
  }
  return [...positive.map((v) => -v).reverse(), 0, ...positive];
}

function buildGrid(): BufferGeometry {
  const axis = axisCoordinates();
  const n = axis.length;
  const positions = new Float32Array(n * n * 3);
  let p = 0;
  for (const z of axis) {
    for (const x of axis) {
      positions[p++] = x;
      positions[p++] = 0;
      positions[p++] = z;
    }
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Alternate the diagonal for a less regular low-poly look.
      if ((i + j) % 2 === 0) {
        indices.set([a, c, b, b, c, d], q);
      } else {
        indices.set([a, c, d, a, d, b], q);
      }
      q += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  return g;
}

// Shader hot swap (§13.4.6): recompile in place, no reload.
if (import.meta.hot) {
  import.meta.hot.accept(['./water.vert.glsl?raw', './water.frag.glsl?raw'], ([vert, frag]) => {
    for (const m of materials) {
      if (vert) m.vertexShader = String(vert.default);
      if (frag) m.fragmentShader = SKY_COMMON_GLSL + String(frag.default);
      m.needsUpdate = true;
    }
  });
}
