import {
  BoxGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EntityId, Quat, Vec3 } from '../core/interfaces/common.ts';
import { type BoatTypeId, boatTypes } from '../data/boats.ts';
import { cameraTunables } from '../data/camera.ts';
import { platforms } from '../data/platforms.ts';
import type { InputSnapshot } from '../input/actions.ts';
import { ChaseCamera } from './camera.ts';
import { loadModel } from './models.ts';
import { Clouds } from './sky/clouds.ts';
import { Sky } from './sky/sky.ts';
import { type WakeView, WaterMesh } from './water/water-mesh.ts';

export interface RenderBoat {
  id: EntityId;
  boatType: BoatTypeId;
  position: Vec3;
  rotation: Quat;
}

/** Read-only view of sim state the renderer needs each frame (already interpolated). */
export interface RenderView {
  /** World clock (s) for the water surface. */
  time: number;
  boats: RenderBoat[];
  wakes: readonly WakeView[];
  /** The boat the camera chases. */
  focus: { id: EntityId; heading: number; speed: number } | null;
}

/** How far from the focus the shadow-casting light sits. */
const LIGHT_DISTANCE = 150;

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly chase: ChaseCamera;
  /** Root for everything in world space; shifted for the floating origin in M4. */
  readonly worldRoot = new Group();

  private readonly sun = new DirectionalLight();
  private readonly sky = new Sky();
  private readonly clouds = new Clouds(7);
  private readonly water = new WaterMesh(this.sky.uniforms);
  private readonly fog = new Fog(0xffffff);
  private readonly boats = new Map<EntityId, Group>();
  private readonly focusPosition = new Vector3();
  private readonly projected = new Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    const t = cameraTunables;
    this.chase = new ChaseCamera(new PerspectiveCamera(t.fov, 1, t.near, t.far));

    this.scene.fog = this.fog;
    this.scene.add(this.worldRoot, this.sky.hemisphere, this.sun, this.sun.target, this.sky.dome);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });
    this.worldRoot.add(this.water, this.clouds);

    // Built once; platform edits apply on the next reload (they become chunked world data in M4).
    for (const p of platforms.list) {
      const box = new Mesh(
        new BoxGeometry(p.size.x, p.size.y, p.size.z),
        new MeshStandardMaterial({ color: p.colour, flatShading: true }),
      );
      box.position.set(p.position.x, p.size.y / 2 - 1, p.position.z);
      box.castShadow = box.receiveShadow = true;
      box.name = p.id;
      this.worldRoot.add(box);
    }

    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.chase.camera.aspect = w / Math.max(1, h);
    this.chase.camera.updateProjectionMatrix();
  }

  render(view: RenderView, input: InputSnapshot, frameSeconds: number): void {
    this.syncBoats(view.boats);

    const focusBoat = view.focus ? this.boats.get(view.focus.id) : undefined;
    if (focusBoat) this.focusPosition.copy(focusBoat.position);
    this.chase.update(input, frameSeconds, {
      position: this.focusPosition,
      heading: view.focus?.heading ?? 0,
      speed: view.focus?.speed ?? 0,
    });

    const cam = this.chase.camera.position;
    this.sky.update(view.time, cam, this.sun, this.fog);
    // The shadow frustum follows the action; the light comes from the sun (or moon).
    const light = this.sky.lighting;
    this.sun.position.copy(this.focusPosition).addScaledVector(light.lightDir, LIGHT_DISTANCE);
    this.sun.target.position.copy(this.focusPosition);
    this.clouds.update(view.time, cam);
    this.water.update({
      time: view.time,
      centreX: cam.x,
      centreZ: cam.z,
      lighting: light,
      wakes: view.wakes,
    });

    this.renderer.render(this.scene, this.chase.camera);
  }

  /** Where a world point lands on screen (CSS pixels), or null if behind the camera. */
  screenPoint(p: Vec3): { x: number; y: number; distance: number } | null {
    const camera = this.chase.camera;
    const v = this.projected.set(p.x, p.y, p.z);
    const distance = v.distanceTo(camera.position);
    v.project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return {
      x: ((v.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - v.y) / 2) * this.canvas.clientHeight,
      distance,
    };
  }

  dispose(): void {
    this.water.dispose();
    this.sky.dispose();
    this.clouds.dispose();
    this.renderer.dispose();
  }

  private syncBoats(boats: RenderBoat[]): void {
    const seen = new Set<EntityId>();
    for (const b of boats) {
      seen.add(b.id);
      let group = this.boats.get(b.id);
      if (!group) {
        const g = new Group();
        group = g;
        g.name = b.id;
        this.boats.set(b.id, g);
        this.worldRoot.add(g);
        const type = boatTypes[b.boatType];
        void loadModel(type.model).then((model) => {
          model.scale.setScalar(type.modelScale);
          g.add(model);
        });
      }
      group.position.set(b.position.x, b.position.y, b.position.z);
      group.quaternion.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
    }
    for (const [id, group] of this.boats) {
      if (seen.has(id)) continue;
      group.removeFromParent();
      this.boats.delete(id);
    }
  }
}
