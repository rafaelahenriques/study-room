/*
 * Rain on glass — a TSL (WebGPU) port of "Heartfelt"
 *
 *   Original: "Heartfelt" by Martijn Steinrucken aka BigWings, 2017
 *   https://www.shadertoy.com/view/ltffzl
 *   License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
 *            https://creativecommons.org/licenses/by-nc-sa/3.0/
 *
 * As required by that license, this file (a derivative work) is shared under the same
 * CC BY-NC-SA 3.0 license.
 *
 * What is ported 1:1: N13 / N hashes, Saw, DropLayer2, StaticDrops, Drops, the
 * three-tap normals, the focus/blur logic, the colour shift and the lightning flicker.
 *
 * Changes for this project:
 *  - runs on the window glass quad instead of full screen; `iChannel0` is replaced by the
 *    real rendered scene behind the glass (viewportMipTexture), so drops refract the
 *    outside view and stay correct when the camera orbits/zooms
 *  - rainAmount comes from live weather; like the original's iMouse, dragging on the window
 *    sets it (vertical) and scrubs drop time (horizontal)
 *  - fog/blur scales with the weather so a dry window is clear
 *  - the HAS_HEART story mode, zoom animation, vignette and fade-in are not used
 *  - lightning is computed on the CPU (same formula) so it can also flash the room lights
 */
import * as THREE from 'three/webgpu';
import {
  abs, clamp, dot, float, floor, fract, length, max, mix, screenUV, sin, sqrt, time, uniform, uv, vec2, vec3,
  viewportMipTexture,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const f = (x: F | number): F => (typeof x === 'number' ? float(x) : x);

/** #define S(a, b, t) smoothstep(a, b, t) — written out so reversed edges (a > b) behave as in GLSL */
const S = (a: F | number, b: F | number, t: F): F => {
  const A = f(a);
  const B = f(b);
  const x = clamp(t.sub(A).div(B.sub(A)), 0, 1);
  return x.mul(x).mul(float(3).sub(x.mul(2)));
};

/** N13 — hash by Dave Hoskins */
const N13 = (p: F): V3 => {
  let p3 = fract(vec3(p, p, p).mul(vec3(0.1031, 0.11369, 0.13787)));
  p3 = p3.add(dot(p3, p3.yzx.add(19.19)));
  return fract(vec3(p3.x.add(p3.y).mul(p3.z), p3.x.add(p3.z).mul(p3.y), p3.y.add(p3.z).mul(p3.x)));
};

const N = (t: F): F => fract(sin(t.mul(12345.564)).mul(7658.76));

const Saw = (b: number, t: F): F => S(0, b, t).mul(S(1, b, t));

/** DropLayer2 → vec2(drop mask, trail) */
function DropLayer2(uvIn: V2, t: F): V2 {
  const UV = uvIn;
  const uvA = vec2(uvIn.x, uvIn.y.add(t.mul(0.75)));
  const a = vec2(6, 1);
  const grid = a.mul(2);
  const id0 = floor(uvA.mul(grid));

  const colShift = N(id0.x);
  const uvB = vec2(uvA.x, uvA.y.add(colShift));

  const id = floor(uvB.mul(grid));
  const n = N13(id.x.mul(35.2).add(id.y.mul(2376.1)));
  const st = fract(uvB.mul(grid)).sub(vec2(0.5, 0));

  const x0 = n.x.sub(0.5);
  const yw = UV.y.mul(20);
  const wiggle = sin(yw.add(sin(yw)));
  const x = x0.add(wiggle.mul(float(0.5).sub(abs(x0))).mul(n.z.sub(0.5))).mul(0.7);
  const ti = fract(t.add(n.z));
  const y = Saw(0.85, ti).sub(0.5).mul(0.9).add(0.5);
  const p = vec2(x, y);

  const d = length(st.sub(p).mul(a.yx));
  const mainDrop = S(0.4, 0.0, d);

  const r = sqrt(S(1.0, y, st.y));
  const cd = abs(st.x.sub(x));
  const trailFront = S(-0.02, 0.02, st.y.sub(y));
  const trail = S(r.mul(0.23), r.mul(r).mul(0.15), cd).mul(trailFront).mul(r).mul(r);

  // (the original's first `droplets` value is overwritten, so only this one matters)
  const yd = fract(UV.y.mul(10)).add(st.y.sub(0.5));
  const dd = length(st.sub(vec2(x, yd)));
  const droplets = S(0.3, 0.0, dd);
  const m = mainDrop.add(droplets.mul(r).mul(trailFront));

  return vec2(m, trail);
}

function StaticDrops(uvIn: V2, t: F): F {
  const uv40 = uvIn.mul(40);
  const id = floor(uv40);
  const g = fract(uv40).sub(0.5);
  const n = N13(id.x.mul(107.45).add(id.y.mul(3543.654)));
  const p = n.xy.sub(0.5).mul(0.7);
  const d = length(g.sub(p));
  const fade = Saw(0.025, fract(t.add(n.z)));
  return S(0.3, 0.0, d).mul(fract(n.z.mul(10))).mul(fade);
}

/** Drops → vec2(coverage, trail) */
function Drops(uvIn: V2, t: F, l0: F, l1: F, l2: F): V2 {
  const s = StaticDrops(uvIn, t).mul(l0);
  const m1 = DropLayer2(uvIn, t).mul(l1);
  const m2 = DropLayer2(uvIn.mul(1.85), t).mul(l2);
  const c = S(0.3, 1.0, s.add(m1.x).add(m2.x));
  return vec2(c, max(m1.y.mul(l0), m2.y.mul(l1)));
}

/** The original's lightning flicker (USE_POST_PROCESSING), t = (T + 3) * 0.5 */
function lightningAt(t: number): number {
  return Math.sin(t * Math.sin(t * 10)) * Math.pow(Math.max(0, Math.sin(t + Math.sin(t))), 10);
}

export interface RainGlassOptions {
  dom: HTMLElement;
  camera: THREE.Camera;
  /** orbit controls (disabled while dragging on the glass) */
  controls: { enabled: boolean };
}

export function createRainGlass(glass: THREE.Mesh, opts: RainGlassOptions) {
  const rainAmount = uniform(0);   // 0–1, the original's rainAmount
  const fog = uniform(0);          // 0 = clear dry glass … 1 = full Heartfelt fog
  const speed = uniform(1);
  const scrub = uniform(0);        // the original's iMouse.x * 2 time offset
  const lightning = uniform(0);
  const dropScale = uniform(1.0);  // drop size: <1 bigger drops, >1 smaller
  const blurScale = uniform(0.85); // mip-level scale for this screen size
  const axisU = uniform(new THREE.Vector2(0.1, 0)); // glass uv (1,0) in screen-uv units
  const axisV = uniform(new THREE.Vector2(0, -0.1)); // glass uv (0,1) in screen-uv units

  // glass UVs from the GLB have v = 0 at the top; Heartfelt expects y up
  const st = vec2(uv().x, float(1).sub(uv().y));
  const T = time.mul(speed).add(scrub);
  const t = T.mul(0.2);
  const p = st.sub(0.5).mul(dropScale);

  const maxBlur = mix(float(3), float(6), rainAmount);
  const minBlur = float(2);
  const staticDrops = S(-0.5, 1.0, rainAmount).mul(2);
  const layer1 = S(0.25, 0.75, rainAmount);
  const layer2 = S(0.0, 0.5, rainAmount);

  const c = Drops(p, t, staticDrops, layer1, layer2);
  const e = 0.001;
  const cx = Drops(p.add(vec2(e, 0)), t, staticDrops, layer1, layer2).x;
  const cy = Drops(p.add(vec2(0, e)), t, staticDrops, layer1, layer2).x;
  const n = vec2(cx.sub(c.x), cy.sub(c.x)); // "expensive normals"

  const focus = mix(maxBlur.sub(c.y), minBlur, S(0.1, 0.2, c.x));
  const offset = vec2(axisU).mul(n.x).add(vec2(axisV).mul(n.y));
  const sample = viewportMipTexture(screenUV.add(offset), focus.mul(blurScale).mul(fog)) as unknown as Node<'vec4'>;
  let col = sample.rgb;

  // USE_POST_PROCESSING: subtle colour shift + lightning (vignette/fade are full-screen only)
  const tt = T.add(3).mul(0.5);
  const colFade = sin(tt.mul(0.2)).mul(0.5).add(0.5);
  col = col.mul(mix(vec3(1, 1, 1), vec3(0.8, 0.9, 1.3), colFade.mul(fog).mul(0.6)));
  col = col.mul(float(1).add(lightning));

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'M_WindowGlass_Heartfelt';
  material.colorNode = col;
  glass.material = material;

  // ---- glass corners → screen axes (refraction offsets follow the camera)
  const pos = glass.geometry.getAttribute('position');
  const uvs = glass.geometry.getAttribute('uv');
  const corner = (u: number, v: number) => {
    for (let i = 0; i < uvs.count; i++) {
      if (Math.abs(uvs.getX(i) - u) < 1e-3 && Math.abs(uvs.getY(i) - v) < 1e-3)
        return new THREE.Vector3().fromBufferAttribute(pos, i);
    }
    throw new Error('Window_Glass corner not found');
  };
  const c00 = corner(0, 1); // st (0,0): bottom-left
  const c10 = corner(1, 1); // st (1,0)
  const c01 = corner(0, 0); // st (0,1)
  const w = new THREE.Vector3();
  const toScreen = (local: THREE.Vector3, camera: THREE.Camera) => {
    w.copy(local);
    glass.localToWorld(w).project(camera);
    return new THREE.Vector2((w.x + 1) / 2, (1 - w.y) / 2);
  };

  // ---- interaction: drag on the glass like the original's iMouse
  const drag = { active: false, x: 0, y: 0, used: false };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const glassUV = (ev: PointerEvent): THREE.Vector2 | null => {
    const r = opts.dom.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, opts.camera);
    return ray.intersectObject(glass, false)[0]?.uv ?? null;
  };
  const updateDrag = (hit: THREE.Vector2) => {
    drag.x = hit.x;
    drag.y = 1 - hit.y; // y up
  };
  // capture phase so this runs before OrbitControls and can stop the orbit
  opts.dom.addEventListener('pointerdown', (ev) => {
    const hit = glassUV(ev);
    if (!hit) return;
    drag.active = true;
    drag.used = true;
    updateDrag(hit);
    opts.controls.enabled = false;
    opts.dom.setPointerCapture(ev.pointerId);
  }, { capture: true });
  opts.dom.addEventListener('pointermove', (ev) => {
    if (!drag.active) return;
    const hit = glassUV(ev);
    if (hit) updateDrag(hit);
  });
  const end = (ev: PointerEvent) => {
    if (!drag.active) return;
    drag.active = false;
    opts.controls.enabled = true;
    if (opts.dom.hasPointerCapture(ev.pointerId)) opts.dom.releasePointerCapture(ev.pointerId);
  };
  opts.dom.addEventListener('pointerup', end);
  opts.dom.addEventListener('pointercancel', end);

  const eased = { rain: 0, fog: 0, storm: 0, scrub: 0 };
  let clock = 0;

  return {
    material,
    /** true while the visitor is dragging on the window */
    get dragging() { return drag.active; },
    /** current lightning flash (0 … ~1), for the room lights */
    get flash() { return lightning.value; },

    update(dt: number, camera: THREE.Camera, target: { rain: number; fog: number; storm: boolean }) {
      const k = 1 - Math.exp(-dt * (drag.active ? 6 : 0.8));
      const rainTarget = drag.active ? drag.y : target.rain;
      eased.rain += (rainTarget - eased.rain) * k;
      const fogTarget = drag.active ? Math.max(target.fog, 0.6 + 0.4 * drag.y) : target.fog;
      eased.fog += (fogTarget - eased.fog) * k * 0.6;
      eased.storm += ((target.storm ? 1 : 0) - eased.storm) * (1 - Math.exp(-dt));
      if (drag.used) eased.scrub += (drag.x * 2 - eased.scrub) * (1 - Math.exp(-dt * 8));

      rainAmount.value = eased.rain;
      fog.value = eased.fog;
      scrub.value = eased.scrub;
      speed.value += ((target.storm ? 1.4 : 1) - speed.value) * k;

      clock += dt * speed.value;
      lightning.value = Math.max(0, lightningAt((clock + eased.scrub + 3) * 0.5)) * eased.storm;

      const s0 = toScreen(c00, camera);
      axisU.value.copy(toScreen(c10, camera)).sub(s0);
      axisV.value.copy(toScreen(c01, camera)).sub(s0);
    },
  };
}
