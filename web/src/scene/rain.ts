import * as THREE from 'three/webgpu';
import {
  abs, clamp, dot, float, floor, fract, length, max, mix, screenUV, sin, smoothstep, step, time, uniform, uv, vec2, vec3,
  viewportMipTexture,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * Rain on glass (TSL, WebGPU + WebGL2 fallback). Original implementation.
 *
 *  - sliding drops: each grid cell holds one drop that sticks, then slides down (two layers)
 *  - trails: small beads left behind a sliding drop, and a wet path that wipes the condensation
 *  - static beads: tiny droplets that land, sit and evaporate
 *  - condensation: the view behind is blurred (mip level) except inside drops and trails
 *  - refraction: every drop acts as a small lens on the real rendered scene behind the glass
 *    (viewportMipTexture), so it stays correct when the camera orbits or zooms
 *
 * Glass UVs from the GLB have v = 0 at the TOP, so `st` flips them: st.y points up.
 */

type F = Node<'float'>;
type V2 = Node<'vec2'>;

const hash12 = (p: V2): F => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const hash22 = (p: V2): V2 => vec2(hash12(p), hash12(p.add(vec2(37.2, 17.9))));
/** 1 inside `a`, fading to 0 at `b` (a < b) */
const inside = (a: F | number, b: F | number, x: F): F => float(1).sub(smoothstep(a, b, x));

interface Layer { off: V2; cov: F; clear: F }

/** Drops that stick, then slide down, leaving beads and a wet, clear trail. */
function slidingDrops(st: V2, t: F, cols: number, rows: number, amount: F, seed: number): Layer {
  const g = st.mul(vec2(cols, rows)).add(vec2(0, t.mul(0.12)));
  const id = floor(g).add(seed);
  const f = fract(g).sub(0.5);
  const n = hash22(id);
  const on = step(hash12(id.add(5.31)), amount);

  const phase = fract(t.mul(n.y.mul(0.25).add(0.12)).add(n.x));
  const py = float(0.38).sub(smoothstep(0.5, 0.95, phase).mul(0.76));          // stick … then slide
  const fade = smoothstep(0.0, 0.06, phase).mul(inside(0.9, 1.0, phase)).mul(on);
  const px = n.x.sub(0.5).mul(0.55).add(sin(f.y.mul(7).add(n.y.mul(6.283))).mul(0.035));

  const k = cols / rows; // keeps drops round in glass space
  const p = vec2(f.x.sub(px), f.y.sub(py).mul(k));
  const r = n.y.mul(0.05).add(0.12);
  const drop = inside(r.mul(0.7), r, length(p)).mul(fade);

  const above = f.y.sub(py);
  const trail = smoothstep(-0.02, 0.04, above).mul(inside(0.0, 0.55, above)).mul(fade);
  const by = fract(above.mul(8)).sub(0.5).div(8).mul(k);
  const bp = vec2(p.x, by);
  const bead = inside(0.012, 0.03, length(bp)).mul(trail).mul(inside(0.0, 0.4, above));
  const clear = trail.mul(inside(0.03, 0.1, abs(p.x)));

  const off = p.mul(drop).add(bp.mul(bead)).mul(-2.6 / cols);
  return { off, cov: max(drop, bead), clear };
}

/** Small droplets that appear, sit and evaporate. */
function staticBeads(st: V2, t: F, cells: number, amount: F, seed: number): Layer {
  const g = st.mul(cells);
  const id = floor(g).add(seed);
  const f = fract(g).sub(0.5);
  const n = hash22(id);
  const life = fract(t.mul(0.05).add(hash12(id.add(3.7))));
  const fade = smoothstep(0.0, 0.08, life).mul(inside(0.5, 1.0, life)).mul(step(hash12(id.add(9.1)), amount));
  const p = f.sub(n.sub(0.5).mul(0.6));
  const r = n.x.mul(0.12).add(0.1);
  const bead = inside(r.mul(0.4), r, length(p)).mul(fade);
  return { off: p.mul(bead).mul(-2.0 / cells), cov: bead, clear: float(0) };
}

export function createRainGlass(glass: THREE.Mesh) {
  const rain = uniform(0);        // 0–1 drop amount
  const fog = uniform(0);         // 0–1 condensation
  const speed = uniform(1);       // storm runs faster
  const axisU = uniform(new THREE.Vector2(0.1, 0)); // glass st (1,0) in screen-uv units
  const axisV = uniform(new THREE.Vector2(0, -0.1)); // glass st (0,1) in screen-uv units
  const tintDay = new THREE.Color('#dfe9ee');
  const tintNight = new THREE.Color('#2b3350');
  const tintC = new THREE.Color();
  const tint = uniform(new THREE.Vector3(tintDay.r, tintDay.g, tintDay.b));

  const st = vec2(uv().x, float(1).sub(uv().y));
  const t = time.mul(speed);

  const a = slidingDrops(st, t, 5, 2, rain, 0);
  const b = slidingDrops(st, t.add(3.1), 9, 3, rain.mul(0.8), 17);
  const s = staticBeads(st, t, 26, clamp(rain.mul(1.3), 0, 1), 41);

  const off = a.off.add(b.off).add(s.off);
  const cov = clamp(a.cov.add(b.cov).add(s.cov), 0, 1);
  const clear = clamp(a.clear.add(b.clear), 0, 1);
  const mist = fog.mul(float(1).sub(clear)).mul(float(1).sub(cov));

  const screenOff = vec2(axisU).mul(off.x).add(vec2(axisV).mul(off.y));
  // viewportMipTexture is typed as a bare Node in @types/three; it is a vec4 texture sample
  const behind = (viewportMipTexture(screenUV.add(screenOff), mist.mul(5.0)) as unknown as Node<'vec4'>).rgb;
  const ring = cov.mul(float(1).sub(cov)).mul(4);
  let col = mix(behind, vec3(tint), mist.mul(0.12).add(0.03));
  col = col.mul(float(1).sub(ring.mul(0.35))).add(cov.mul(0.03));

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'M_WindowGlass_Rain';
  material.colorNode = col;
  glass.material = material;

  // glass corners (by UV) for mapping glass-space offsets to the screen
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

  const eased = { rain: 0, fog: 0 };
  return {
    material,
    /** `day` is the eased 0 (night) … 1 (day) level from Lighting */
    update(dt: number, camera: THREE.Camera, target: { rain: number; fog: number; storm: boolean; day: number }) {
      const k = 1 - Math.exp(-dt * 0.8);
      eased.rain += (target.rain - eased.rain) * k;
      eased.fog += (target.fog - eased.fog) * k * 0.6;
      rain.value = eased.rain;
      fog.value = eased.fog;
      speed.value += ((target.storm ? 1.5 : 1) - speed.value) * k;
      tintC.lerpColors(tintNight, tintDay, target.day);
      tint.value.set(tintC.r, tintC.g, tintC.b);

      const s0 = toScreen(c00, camera);
      axisU.value.copy(toScreen(c10, camera)).sub(s0);
      axisV.value.copy(toScreen(c01, camera)).sub(s0);
    },
  };
}
