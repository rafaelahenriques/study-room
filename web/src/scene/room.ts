import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** Wraps the exported GLB: node/material lookup by name and animation clip helpers. */
export class Room {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private readonly clips: THREE.AnimationClip[];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly drawersOpen = new Map<string, boolean>();

  private constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.clips = gltf.animations;
    this.mixer = new THREE.AnimationMixer(this.root);

    const noShadow = new Set(['Window_Glass', 'Window_Backdrop', 'StringLights_Bulbs', 'Lamp_Bulb']);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = !noShadow.has(mesh.name);
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) this.materials.set(m.name, m as THREE.MeshStandardMaterial);
    });
  }

  static async load(url: string, onProgress?: (fraction: number) => void): Promise<Room> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    return new Room(gltf);
  }

  node<T extends THREE.Object3D = THREE.Object3D>(name: string): T {
    const o = this.root.getObjectByName(name);
    if (!o) throw new Error(`Room node "${name}" not found in GLB`);
    return o as T;
  }

  material(name: string): THREE.MeshStandardMaterial {
    const m = this.materials.get(name);
    if (!m) throw new Error(`Material "${name}" not found in GLB`);
    return m;
  }

  worldPosition(name: string, target = new THREE.Vector3()): THREE.Vector3 {
    return this.node(name).getWorldPosition(target);
  }

  private action(name: string): THREE.AnimationAction {
    const clip = THREE.AnimationClip.findByName(this.clips, name);
    if (!clip) throw new Error(`Clip "${name}" not found in GLB`);
    return this.mixer.clipAction(clip);
  }

  /** One-shot clip that holds its last frame; forward=false plays it back to the start. */
  playOnce(name: string, forward = true): void {
    const a = this.action(name);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = forward ? 1 : -1;
    a.paused = false;
    if (forward && a.time >= a.getClip().duration) a.time = 0;
    a.play();
  }

  /** Restart a one-shot clip from the beginning (e.g. Sound_Bump). */
  trigger(name: string): void {
    const a = this.action(name);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.reset().play();
  }

  loop(name: string, timeScale = 1): THREE.AnimationAction {
    const a = this.action(name);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.timeScale = timeScale;
    a.play();
    return a;
  }

  toggleDrawer(drawerName: string): boolean {
    const open = !this.drawersOpen.get(drawerName);
    this.drawersOpen.set(drawerName, open);
    this.playOnce(`${drawerName}_Open`, open);
    return open;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
