import * as THREE from 'three/webgpu';
import type { Room } from './room';

/**
 * Ambient occlusion baked in Blender (blender/bake_ao.py, Cycles) into one atlas:
 * web/public/textures/room_ao.jpg. The baked meshes carry a second UV map (glTF TEXCOORD_1
 * → three.js `uv1`), so the texture is used as `aoMap` on channel 1.
 *
 * Unlike the course's fully baked room (MeshBasicMaterial + baked.jpg), only the occlusion is
 * baked here: the lighting itself stays real-time because it follows the time of day, the
 * weather and the desk lamp. aoMap darkens the ambient/hemisphere light in the corners,
 * under the furniture and behind the shelves.
 */
export async function applyBakedAO(room: Room, url: string, intensity = 1): Promise<number> {
  const ao = await new THREE.TextureLoader().loadAsync(url);
  ao.flipY = false;                 // glTF UVs: no flip (same as the course's baked.jpg)
  ao.colorSpace = THREE.NoColorSpace; // occlusion is data, not a colour
  ao.channel = 1;                   // read it with the second UV map (uv1)

  // materials are shared with meshes that have no uv1, so baked meshes get their own copy
  const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  let count = 0;
  room.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('uv1')) return;
    const swap = (m: THREE.Material) => {
      let copy = copies.get(m);
      if (!copy) {
        copy = (m as THREE.MeshStandardMaterial).clone();
        copy.aoMap = ao;
        copy.aoMapIntensity = intensity;
        copies.set(m, copy);
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    count++;
  });
  return count;
}
