import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type ModelId, models } from '../data/models.ts';

const loader = new GLTFLoader();
const cache = new Map<ModelId, Promise<Object3D>>();

/** Loads a Kenney model once and returns a fresh clone per call. */
export async function loadModel(id: ModelId): Promise<Object3D> {
  let pending = cache.get(id);
  if (!pending) {
    pending = loader.loadAsync(`${import.meta.env.BASE_URL}${models[id]}`).then((gltf) => {
      gltf.scene.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      return gltf.scene;
    });
    cache.set(id, pending);
  }
  return (await pending).clone();
}
