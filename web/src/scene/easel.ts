import * as THREE from 'three/webgpu';
import type { Room } from './room';

/**
 * Doodle on the easel. Clicking the easel flies the camera to face the canvas
 * (Easel_Painting_1, the 0–1 UV quad with M_CanvasArt), hides the painted colour blocks and
 * lets the visitor draw on a canvas texture. The drawing is kept in this browser
 * (localStorage), so it's still on the easel next time; "Save image" downloads it as a PNG.
 */

const W = 512;
const H = 640;                                      // the canvas on the easel is about 47 × 59 cm
const PAPER = '#f4efe6';
const STORE_KEY = 'studyroom.doodle';
const COLORS = ['#3b3633', '#c66f4e', '#6f8a6e', '#d9a441', '#6c8ea8', '#e3a6a0'];
const SIZES = { S: 4, M: 10, L: 22 };
const FLY_SECONDS = 0.8;

const load = (): string | null => {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
};
const save = (data: string | null): boolean => {
  try {
    if (data) localStorage.setItem(STORE_KEY, data); else localStorage.removeItem(STORE_KEY);
    return true;
  } catch {
    return false;                                    // private window or storage full: drawing still works
  }
};

export interface EaselOptions {
  camera: THREE.OrthographicCamera;
  controls: { enabled: boolean; target: THREE.Vector3 };
  dom: HTMLElement;
  toast: (msg: string) => void;
}

export const createEasel = (room: Room, opts: EaselOptions) => {
  const { camera, controls, dom } = opts;
  const canvasMesh = room.node<THREE.Mesh>('Easel_Painting_1');
  const blocks = room.node('Easel_Painting').children.filter((c) => c !== canvasMesh);

  // ---- the drawing surface
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;                                 // glTF UVs: v = 0 at the top
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // seen from the front, the quad's u runs right-to-left: mirror it, so the canvas pixels
  // match what the visitor sees (and the downloaded PNG isn't flipped)
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1;
  tex.offset.x = 1;
  const original = canvasMesh.material;
  // a little self-light so the paper reads as paper beside the window, at any time of day
  const drawn = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 });
  drawn.name = 'M_CanvasArt_Doodle';

  let hasDrawing = false;
  const showDrawing = (on: boolean) => {
    canvasMesh.material = on ? drawn : original;
    for (const b of blocks) b.visible = !on;
  };
  const saved = load();
  if (saved) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
      tex.needsUpdate = true;
      hasDrawing = true;
      if (!active) showDrawing(true);
    };
    img.src = saved;
  }

  // ---- where the camera goes: straight in front of the canvas (room side), close enough that nothing gets in between
  const geo = canvasMesh.geometry;
  geo.computeBoundingBox();
  canvasMesh.updateWorldMatrix(true, false);
  const centre = geo.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(canvasMesh.matrixWorld);
  const pos = geo.getAttribute('position');
  const idx = geo.index!;
  const corner = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(canvasMesh.matrixWorld);
  const a = corner(0), b = corner(1), c = corner(2);
  const front = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(); // faces the room
  const size = new THREE.Box3().setFromObject(canvasMesh).getSize(new THREE.Vector3());
  const canvasHeight = size.y;
  const canvasWidth = Math.hypot(size.x, size.z);

  const from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), zoom: 1, up: new THREE.Vector3() };
  const to = { pos: new THREE.Vector3(), target: centre.clone(), zoom: 1 };
  let fly: { t: number; dir: 1 | -1 } | null = null;
  let active = false;
  const look = new THREE.Vector3();

  // ---- toolbar
  const bar = document.createElement('div');
  bar.id = 'doodle-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Doodle tools');
  bar.innerHTML = `
    <div class="doodle-group" role="group" aria-label="Colour">
      ${COLORS.map((c, i) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Colour ${i + 1}"></button>`).join('')}
      <button type="button" class="swatch eraser" data-color="${PAPER}" aria-label="Eraser">⌫</button>
    </div>
    <div class="doodle-group" role="group" aria-label="Brush size">
      ${Object.keys(SIZES).map((s) => `<button type="button" class="size" data-size="${s}">${s}</button>`).join('')}
    </div>
    <div class="doodle-group">
      <button type="button" id="doodle-undo">Undo</button>
      <button type="button" id="doodle-clear">Clear</button>
      <button type="button" id="doodle-save">Save image</button>
      <button type="button" id="doodle-done" class="primary">Done</button>
    </div>`;
  document.body.appendChild(bar);
  let color = COLORS[0];
  let width = SIZES.M;
  const press = () => {
    bar.querySelectorAll<HTMLElement>('[data-color]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.color === color)));
    bar.querySelectorAll<HTMLElement>('[data-size]').forEach((el) => el.setAttribute('aria-pressed', String(SIZES[el.dataset.size as keyof typeof SIZES] === width)));
  };
  press();
  bar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    if (t.dataset.color) color = t.dataset.color;
    if (t.dataset.size) width = SIZES[t.dataset.size as keyof typeof SIZES];
    press();
  });

  // ---- undo history (a few snapshots, taken when a stroke starts)
  const history: ImageData[] = [];
  const snapshot = () => {
    history.push(ctx.getImageData(0, 0, W, H));
    if (history.length > 15) history.shift();
  };
  const persist = () => {
    if (!save(hasDrawing ? canvas.toDataURL('image/png') : null)) opts.toast('Couldn’t save the drawing in this browser');
  };
  bar.querySelector('#doodle-undo')!.addEventListener('click', () => {
    const last = history.pop();
    if (!last) return;
    ctx.putImageData(last, 0, 0);
    tex.needsUpdate = true;
    persist();
  });
  bar.querySelector('#doodle-clear')!.addEventListener('click', () => {
    snapshot();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    tex.needsUpdate = true;
    hasDrawing = false;
    persist();
  });
  bar.querySelector('#doodle-save')!.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'study-room-doodle.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
  bar.querySelector('#doodle-done')!.addEventListener('click', () => exit());

  // ---- drawing: raycast the pointer onto the canvas quad
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let last: { x: number; y: number } | null = null;
  let pointerId = -1;
  const toCanvas = (e: PointerEvent) => {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const uv = ray.intersectObject(canvasMesh, false)[0]?.uv;
    return uv ? { x: (1 - uv.x) * W, y: uv.y * H } : null;
  };
  const dot = (p: { x: number; y: number }) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  dom.addEventListener('pointerdown', (e) => {
    if (!active || fly) return;
    const p = toCanvas(e);
    if (!p) return;
    snapshot();
    pointerId = e.pointerId;
    try { dom.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    last = p;
    dot(p);
    hasDrawing = true;
    tex.needsUpdate = true;
  });
  dom.addEventListener('pointermove', (e) => {
    if (!active || !last || e.pointerId !== pointerId) return;
    const p = toCanvas(e);
    if (!p) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    tex.needsUpdate = true;
  });
  const endStroke = (e: PointerEvent) => {
    if (!last || e.pointerId !== pointerId) return;
    last = null;
    pointerId = -1;
    persist();
  };
  dom.addEventListener('pointerup', endStroke);
  dom.addEventListener('pointercancel', endStroke);
  window.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') exit();
  });

  const enter = () => {
    if (active) return;
    active = true;
    controls.enabled = false;
    from.pos.copy(camera.position);
    from.target.copy(controls.target);
    from.zoom = camera.zoom;
    from.up.copy(camera.up);
    // zoom so the whole canvas fits, with a margin; the frustum height comes from fitCamera()
    const halfH = (camera.top - camera.bottom) / 2;
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    const need = Math.max(canvasHeight / 2, canvasWidth / 2 / aspect) * 1.25;
    to.zoom = halfH / need;
    to.pos.copy(centre).addScaledVector(front, 0.12);
    showDrawing(true);
    bar.hidden = false;
    fly = { t: 0, dir: 1 };
    opts.toast('Draw on the canvas. Press Done (or Esc) to step back.');
  };
  const exit = () => {
    if (!active || (fly && fly.dir === -1)) return;
    bar.hidden = true;
    last = null;
    if (!hasDrawing) showDrawing(false);              // nothing drawn: the painting comes back
    fly = { t: fly ? 1 - fly.t : 0, dir: -1 };
  };

  return {
    get active() { return active; },
    enter,
    exit,
    /** call every frame; while active the caller skips controls.update() */
    update(dt: number) {
      if (!fly) {
        if (active) camera.lookAt(centre);            // stay square-on after a resize
        return;
      }
      fly.t = Math.min(1, fly.t + dt / FLY_SECONDS);
      const k = fly.t * fly.t * (3 - 2 * fly.t);
      const s = fly.dir === 1 ? k : 1 - k;            // 0 = room view, 1 = at the canvas
      camera.position.lerpVectors(from.pos, to.pos, s);
      camera.zoom = THREE.MathUtils.lerp(from.zoom, to.zoom, s);
      camera.updateProjectionMatrix();
      camera.lookAt(look.lerpVectors(from.target, to.target, s));
      if (fly.t >= 1) {
        if (fly.dir === -1) {
          camera.position.copy(from.pos);
          camera.zoom = from.zoom;
          camera.up.copy(from.up);
          camera.updateProjectionMatrix();
          controls.target.copy(from.target);
          controls.enabled = true;
          active = false;
        }
        fly = null;
      }
    },
  };
};
