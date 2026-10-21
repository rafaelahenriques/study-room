import * as THREE from 'three/webgpu';
import type { Room } from '../scene/room';
import { state } from '../state/roomState';

/**
 * Shows what can be clicked:
 *  - hover: the object under the pointer gets a soft glow and a label next to the cursor
 *  - hotspots: pulsing dots with labels over every clickable thing (on load, and from the
 *    "What can I click?" button), so touch screens without hover can find them too
 */

/** what clicking each `interactive` kind does (kinds not listed here aren't clickable) */
const ACTIONS: Record<string, () => string> = {
  window: () => 'Hold and drag to change the rain',
  lamp: () => (state.motion.keepAwake ? 'Turn the lamp off' : 'Turn the lamp on'),
  lamp_switch: () => (state.motion.keepAwake ? 'Turn the lamp off' : 'Turn the lamp on'),
  headphones: () => (state.music.playing ? 'Stop the music' : 'Play lo-fi music'),
  monitor: () => 'Switch the screen app',
  chair: () => 'Spin the chair',
  paper: () => 'Throw paper at the bin',
  shelf: () => 'Knock the books off',
  drawer: () => 'Open or close the drawer',
  clock: () => 'Check the room’s time',
  bin: () => 'Paper bin (throw from the notepad)',
};
export const isClickable = (kind: string) => kind in ACTIONS;

/** one hotspot per thing worth finding (not per drawer or per book) */
const HOTSPOTS: { node: string; kind: string; label: string; left?: boolean }[] = [
  // labels sit to the right of their dot unless `left` (keeps neighbours from overlapping)
  { node: 'Window_Glass', kind: 'window', label: 'Drag for rain', left: true },
  { node: 'Lamp', kind: 'lamp', label: 'Lamp' },
  { node: 'Headphones', kind: 'headphones', label: 'Music', left: true },
  { node: 'Monitor_Screen', kind: 'monitor', label: 'Screen', left: true },
  { node: 'Chair', kind: 'chair', label: 'Spin' },
  { node: 'Notepad', kind: 'paper', label: 'Throw paper' },
  { node: 'Shelf_2', kind: 'shelf', label: 'Books', left: true },
  { node: 'Drawer_2', kind: 'drawer', label: 'Drawers', left: true },
  { node: 'Clock_Body', kind: 'clock', label: 'Clock' },
];

export function createHints(room: Room, camera: THREE.Camera, dom: HTMLElement) {
  // ---- hover glow: an additive copy of the hovered object's meshes, drawn at the same depth
  const glowMat = new THREE.MeshBasicMaterial({
    color: '#ffcf96', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
    depthWrite: false, depthFunc: THREE.LessEqualDepth,
  });
  const glows = new Map<THREE.Object3D, THREE.Mesh[]>();
  function glowFor(obj: THREE.Object3D) {
    let list = glows.get(obj);
    if (!list) {
      list = [];
      const meshes: THREE.Mesh[] = [];
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.glow) meshes.push(o as THREE.Mesh); });
      for (const m of meshes) {
        const g = new THREE.Mesh(m.geometry, glowMat);   // shares the geometry: no copy
        g.userData.glow = true;                          // physics and picking skip these
        g.raycast = () => {};
        g.renderOrder = 3;
        g.visible = false;
        m.add(g);
        list.push(g);
      }
      glows.set(obj, list);
    }
    return list;
  }

  // ---- hover label next to the cursor
  const tip = document.createElement('div');
  tip.id = 'hover-tip';
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  let hovered: THREE.Object3D | null = null;
  function hover(obj: THREE.Object3D | null, x: number, y: number) {
    if (obj !== hovered) {
      if (hovered) for (const g of glowFor(hovered)) g.visible = false;
      if (obj) for (const g of glowFor(obj)) g.visible = true;
      hovered = obj;
    }
    if (!obj) {
      tip.classList.remove('show');
      return;
    }
    tip.textContent = ACTIONS[obj.userData.interactive as string]?.() ?? '';
    // keep the label on screen near the right and bottom edges
    const flipX = x > window.innerWidth - 220;
    tip.style.transform = `translate(${flipX ? x - 14 : x + 16}px, ${y + 18}px) translateX(${flipX ? '-100%' : '0'})`;
    tip.classList.add('show');
  }

  // ---- hotspots
  const layer = document.createElement('div');
  layer.id = 'hotspots';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  const box = new THREE.Box3();
  const spots = HOTSPOTS.flatMap((h) => {
    const node = room.root.getObjectByName(h.node);
    if (!node) return [];
    box.setFromObject(node);
    const at = box.getCenter(new THREE.Vector3());
    const el = document.createElement('div');
    el.className = h.left ? 'hs left' : 'hs';
    el.innerHTML = '<span class="hs-dot"></span><span class="hs-label"></span>';
    el.querySelector('.hs-label')!.textContent = h.label;
    layer.appendChild(el);
    return [{ at, el }];
  });

  let hideAt = 0;
  let pinned = false;
  const btn = document.getElementById('hints-btn');
  const setShown = (on: boolean) => {
    layer.classList.toggle('show', on);
    btn?.setAttribute('aria-pressed', String(on));
  };
  btn?.addEventListener('click', () => {
    pinned = !(pinned || layer.classList.contains('show'));
    hideAt = 0;
    setShown(pinned);
  });

  const p = new THREE.Vector3();
  return {
    hover,
    /** show the hotspots for a while (e.g. right after loading) */
    flash(seconds: number) {
      hideAt = performance.now() + seconds * 1000;
      setShown(true);
    },
    /** call every frame: keeps the hotspots on their objects while the camera moves */
    update() {
      if (!pinned && hideAt && performance.now() > hideAt) {
        hideAt = 0;
        setShown(false);
      }
      if (!layer.classList.contains('show')) return;
      const r = dom.getBoundingClientRect();
      for (const s of spots) {
        p.copy(s.at).project(camera);
        s.el.style.transform = `translate(${r.left + ((p.x + 1) / 2) * r.width}px, ${r.top + ((1 - p.y) / 2) * r.height}px)`;
      }
    },
  };
}
