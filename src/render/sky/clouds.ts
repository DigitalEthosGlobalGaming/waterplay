import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../../core/sim/rng.ts';
import { cloudTunables } from '../../data/sky.ts';

const MAX_PUFFS_PER_CLOUD = 6;
const MAX_CLOUDS = 128;

interface Puff {
  offset: Vector3;
  scale: Vector3;
  rotation: Quaternion;
}

interface CloudShape {
  /** Position within the tile, metres. */
  x: number;
  z: number;
  /** 0..1, mapped between min and max height. */
  height: number;
  size: number;
  puffs: Puff[];
}

/**
 * Low-poly clouds: a few flattened icosahedron puffs per cloud, drifting with
 * the wind and tiling around the camera so the sky never runs out. Driven by
 * the world clock, so every player sees the same clouds. Render only.
 */
export class Clouds extends InstancedMesh<IcosahedronGeometry, MeshLambertMaterial> {
  private readonly shapes: CloudShape[];
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(seed: number) {
    super(
      new IcosahedronGeometry(1, 1),
      new MeshLambertMaterial({ color: new Color('#ffffff'), flatShading: true, fog: false }),
      MAX_CLOUDS * MAX_PUFFS_PER_CLOUD,
    );
    this.instanceMatrix.setUsage(DynamicDrawUsage);
    this.frustumCulled = false;
    this.castShadow = false;
    this.receiveShadow = false;
    this.shapes = buildShapes(new Rng(seed));
  }

  update(worldClock: number, camera: Vector3): void {
    const t = cloudTunables;
    this.material.color.set(t.colour);
    const spread = Math.max(100, t.spread);
    const count = Math.min(MAX_CLOUDS, Math.max(0, Math.floor(t.count)));
    let n = 0;
    for (let i = 0; i < count; i++) {
      const c = this.shapes[i];
      if (!c) break;
      // Drift with the wind, then wrap into the tile centred on the camera.
      const x = wrap(c.x * spread + t.windX * worldClock - camera.x, spread) + camera.x;
      const z = wrap(c.z * spread + t.windZ * worldClock - camera.z, spread) + camera.z;
      const y = t.minHeight + (t.maxHeight - t.minHeight) * c.height;
      for (const puff of c.puffs) {
        this.p.set(x, y, z).addScaledVector(puff.offset, c.size);
        this.s.copy(puff.scale).multiplyScalar(c.size);
        this.m.compose(this.p, puff.rotation, this.s);
        this.setMatrixAt(n++, this.m);
      }
    }
    this.count = n;
    this.instanceMatrix.needsUpdate = true;
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}

function buildShapes(rng: Rng): CloudShape[] {
  const shapes: CloudShape[] = [];
  for (let i = 0; i < MAX_CLOUDS; i++) {
    const puffs: Puff[] = [];
    const puffCount = rng.int(3, MAX_PUFFS_PER_CLOUD + 1);
    for (let j = 0; j < puffCount; j++) {
      // Puffs line up roughly along x, biggest in the middle, flattened underneath.
      const along = (j - (puffCount - 1) / 2) * rng.range(0.9, 1.3);
      const r = rng.range(0.8, 1.4) * (1 - Math.abs(along) * 0.12);
      puffs.push({
        offset: new Vector3(along, rng.range(-0.1, 0.35), rng.range(-0.4, 0.4)),
        scale: new Vector3(r * 1.2, r * 0.75, r),
        rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, Math.PI)),
      });
    }
    shapes.push({
      x: rng.next(),
      z: rng.next(),
      height: rng.next(),
      size: rng.range(14, 30),
      puffs,
    });
  }
  return shapes;
}

/** Wrap v into [-size/2, size/2). */
function wrap(v: number, size: number): number {
  return v - size * Math.floor(v / size + 0.5);
}
