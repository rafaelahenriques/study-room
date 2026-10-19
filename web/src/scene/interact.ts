import * as THREE from 'three/webgpu';
import type { Room } from './room';

export type PickHandler = (kind: string, object: THREE.Object3D) => void;

/** Hover cursor + click picking via the `interactive` tags exported from Blender. */
export class Interactions {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly dom: HTMLElement,
    private readonly room: Room,
    private readonly onPick: PickHandler,
  ) {
    dom.addEventListener('pointermove', (e) => {
      dom.style.cursor = this.pick(e) ? 'pointer' : 'grab';
    });
    dom.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointerup', (e) => {
      // ignore drags (camera orbit)
      if (!this.downAt || Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) return;
      const hit = this.pick(e);
      if (hit) this.onPick(hit.userData.interactive as string, hit);
    });
  }

  private pick(e: PointerEvent): THREE.Object3D | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    let o: THREE.Object3D | null = this.ray.intersectObject(this.room.root, true)[0]?.object ?? null;
    while (o && !o.userData.interactive) o = o.parent;
    return o;
  }
}
