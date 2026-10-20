import * as THREE from 'three/webgpu';
import { abs, clamp, float, floor, fract, mix, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, length, wgslFn } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Room } from './room';
import snowShader from '../shaders/snow/fragment.wgsl?raw';

/**
 * The view outside the window, painted on `Window_Backdrop`: sky gradient, sun/moon,
 * drifting clouds, distant hills and rooftops with lit windows at night. The rain
 * shader refracts whatever is rendered here, so it needs real detail.
 *
 * Weather layers: rain streaks, and snowfall ported from Shadertoy Mdt3Df (WGSL, see
 * src/shaders/snow/fragment.wgsl, plugged in with wgslFn).
 *
 * Masks are generated once into a DataTexture (R hills, G rooftops, B clouds, A lit windows).
 * In three.js the glTF UVs have v = 0 at the TOP, which matches canvas rows.
 */

const W = 512;
const H = 416; // backdrop quad is 160 × 130 cm

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function paintLayer(draw: (ctx: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  draw(ctx);
  return ctx.getImageData(0, 0, W, H).data;
}

function buildMasks(): THREE.DataTexture {
  const r = rand(7);

  const hills = paintLayer((ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const y = H * (0.5 + 0.035 * Math.sin(x * 0.012) + 0.02 * Math.sin(x * 0.037 + 1.3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.fill();
    for (let x = 0; x < W; x += 9) {           // tree line along the ridge
      const y = H * (0.5 + 0.035 * Math.sin(x * 0.012) + 0.02 * Math.sin(x * 0.037 + 1.3));
      ctx.beginPath();
      ctx.arc(x + r() * 6, y + 2, 5 + r() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const houses: { x: number; y: number; w: number; h: number }[] = [];
  const roofs = paintLayer((ctx) => {
    let x = -10;
    while (x < W) {
      const w = 46 + r() * 50;
      const h = H * (0.2 + r() * 0.14);
      const y = H - h;
      ctx.fillRect(x, y, w, h);
      if (r() > 0.35) {                          // gable roof
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + w / 2, y - 18 - r() * 16);
        ctx.lineTo(x + w + 4, y);
        ctx.fill();
      }
      if (r() > 0.5) ctx.fillRect(x + w * 0.7, y - 26, 7, 22); // chimney
      houses.push({ x, y, w, h });
      x += w + 4 + r() * 14;
    }
  });

  const clouds = paintLayer((ctx) => {
    for (let i = 0; i < 14; i++) {
      const cx = r() * W;
      const cy = H * (0.08 + r() * 0.34);
      for (let k = 0; k < 6; k++) {
        const px = cx + (r() - 0.5) * 90;
        const py = cy + (r() - 0.5) * 22;
        const rad = 18 + r() * 30;
        for (const ox of [-W, 0, W]) {           // wrap so clouds can scroll seamlessly
          const g = ctx.createRadialGradient(px + ox, py, 0, px + ox, py, rad);
          g.addColorStop(0, 'rgba(255,255,255,0.85)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px + ox - rad, py - rad, rad * 2, rad * 2);
        }
      }
    }
  });

  const lights = paintLayer((ctx) => {
    for (const hs of houses) {
      for (let wy = hs.y + 10; wy < H - 14; wy += 20) {
        for (let wx = hs.x + 8; wx < hs.x + hs.w - 12; wx += 16) {
          if (r() < 0.4) ctx.fillRect(wx, wy, 7, 9);
        }
      }
    }
  });

  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = hills[i * 4];
    data[i * 4 + 1] = roofs[i * 4];
    data[i * 4 + 2] = clouds[i * 4];
    data[i * 4 + 3] = lights[i * 4];
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const C = (hex: string) => new THREE.Color(hex);
const P = {
  zenith: { day: C('#6fa8d6'), night: C('#0b1430'), dawn: C('#8b8fc4'), grey: C('#98a2ab') },
  horizon: { day: C('#d4e6f0'), night: C('#27315c'), dawn: C('#ffc29a'), grey: C('#c3c7cb') },
  cloud: { day: C('#ffffff'), night: C('#38406a'), dawn: C('#ffd6bd'), grey: C('#b1b7bd') },
  hills: { day: C('#9db39a'), night: C('#1b2340') },
  roofs: { day: C('#b88b70'), night: C('#121828') },
};

/** Colour uniform as vec3 (TSL mixes vec3 nodes cleanly). */
function colorUniform(c: THREE.Color) {
  return uniform(new THREE.Vector3(c.r, c.g, c.b));
}
function setColor(u: { value: THREE.Vector3 }, c: THREE.Color) {
  u.value.set(c.r, c.g, c.b);
}

export interface OutsideInputs {
  hour: number;
  day: number;      // 0 night … 1 day (eased)
  overcast: number; // 0 … 1 (eased)
  rain: number;     // 0 … 1 (eased)
  /** 0 … 1 snowing (eased here) */
  snow: number;
  /** lightning flash 0 … ~1 */
  flash?: number;
}

export function createOutsideView(room: Room) {
  const masks = buildMasks();
  const u = {
    zenith: colorUniform(P.zenith.day),
    horizon: colorUniform(P.horizon.day),
    cloud: colorUniform(P.cloud.day),
    hills: colorUniform(P.hills.day),
    roofs: colorUniform(P.roofs.day),
    orb: colorUniform(C('#fff6e0')),
    orbPos: uniform(new THREE.Vector2(0.5, 0.3)),
    orbSize: uniform(0.045),
    orbGlow: uniform(1),
    cloudAmount: uniform(0.3),
    windows: uniform(0),
    rain: uniform(0),
    snow: uniform(0),
    flake: colorUniform(C('#ffffff')),
  };

  const st = uv();
  const m = texture(masks, st);
  const cloudMask = texture(masks, st.add(vec2(time.mul(0.004), 0))).b;
  const aspect = float(W / H);

  const skyT = smoothstep(0.1, 0.62, st.y);          // 0 at top → 1 near the horizon
  let col = mix(vec3(u.zenith), vec3(u.horizon), skyT);
  const d = length(st.sub(u.orbPos).mul(vec2(aspect, 1)));
  const disc = float(1).sub(smoothstep(u.orbSize.mul(0.85), u.orbSize, d));
  const glow = float(1).sub(smoothstep(0.0, u.orbSize.mul(6), d)).mul(0.35);
  col = col.add(vec3(u.orb).mul(disc.add(glow)).mul(u.orbGlow));
  col = mix(col, vec3(u.cloud), cloudMask.mul(u.cloudAmount));
  col = mix(col, mix(vec3(u.hills), vec3(u.horizon), 0.35), m.r);
  col = mix(col, vec3(u.roofs), m.g);
  col = mix(col, vec3(1.0, 0.78, 0.42), m.a.mul(m.g).mul(u.windows));

  // rain streaks falling outside
  const cols = float(150);
  const rnd = fract(sin(floor(st.x.mul(cols)).mul(12.9898)).mul(43758.5453));
  const fall = fract(st.y.mul(1.6).sub(time.mul(rnd.mul(0.6).add(1.3))).add(rnd.mul(13)));
  const across = float(1).sub(smoothstep(0.0, 0.2, abs(fract(st.x.mul(cols)).sub(0.5))));
  const streak = across.mul(float(1).sub(smoothstep(0.0, 0.14, fall))).mul(smoothstep(0.45, 0.55, rnd));
  col = mix(col, vec3(u.horizon).mul(1.25), streak.mul(u.rain).mul(0.45));

  // snowfall: WGSL port of Shadertoy Mdt3Df. Shadertoy's fragCoord starts bottom-left, so the
  // glTF uv is flipped; 0.85 zooms in a little so the flakes read through the window
  const snowfall = wgslFn(snowShader);
  const iResolution = vec2(W, H);
  const snowFragCoord = vec2(st.x, float(1).sub(st.y)).mul(iResolution).mul(0.85);
  const snow = snowfall({ fragCoord: snowFragCoord, iTime: time, iResolution, amount: u.snow }) as unknown as Node<'vec4'>;
  const flakes = clamp(snow.x.mul(1.8), 0, 1);
  col = mix(col, vec3(u.flake), flakes.mul(u.snow));

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'M_WindowSky_Outside';
  material.colorNode = col;
  room.node<THREE.Mesh>('Window_Backdrop').material = material;

  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  const blend = (set: { day: THREE.Color; night: THREE.Color; dawn?: THREE.Color; grey?: THREE.Color }, i: OutsideInputs, dawn: number) => {
    tmp.lerpColors(set.night, set.day, i.day);
    if (set.dawn) tmp.lerp(set.dawn, dawn * (1 - i.overcast));
    if (set.grey) tmp.lerp(tmp2.copy(set.grey).multiplyScalar(0.25 + 0.75 * i.day), i.overcast * 0.85);
    return tmp;
  };

  let snowEased = 0;
  return {
    update(i: OutsideInputs, dt: number) {
      const elev = Math.sin((Math.PI * (i.hour - 6)) / 12);
      const dawn = (1 - smoothstepJS(0.0, 0.35, Math.abs(elev))) * Math.min(1, i.day * 2);
      const snowDim = 1 - 0.3 * snowEased; // a heavier, darker sky so the flakes stand out
      setColor(u.zenith, blend(P.zenith, i, dawn).multiplyScalar((1 + 2.5 * (i.flash ?? 0)) * snowDim));
      setColor(u.horizon, blend(P.horizon, i, dawn).multiplyScalar((1 + 2 * (i.flash ?? 0)) * snowDim));
      setColor(u.cloud, blend(P.cloud, i, dawn));
      snowEased += (i.snow - snowEased) * (1 - Math.exp(-dt * 1.2)); // ~1 s fade, any frame rate
      u.snow.value = snowEased;
      u.rain.value = i.rain;
      const white = tmp2.set('#e8eef3').multiplyScalar(0.3 + 0.7 * i.day);
      setColor(u.hills, tmp.lerpColors(P.hills.night, P.hills.day, i.day).multiplyScalar(1 - 0.3 * i.overcast).lerp(white, snowEased * 0.75));
      setColor(u.roofs, tmp.lerpColors(P.roofs.night, P.roofs.day, i.day).multiplyScalar(1 - 0.35 * i.overcast).lerp(white, snowEased * 0.55));
      setColor(u.flake, tmp.set('#9aa6c4').lerp(C('#ffffff'), i.day));
      u.cloudAmount.value = 0.3 + 0.7 * i.overcast;
      u.windows.value = 1 - i.day;

      // sun by day, moon by night, both travel across the window
      const isDay = elev > -0.05;
      const phase = isDay ? (i.hour - 6) / 12 : (((i.hour + 6) % 24) / 12);
      const arc = Math.sin(Math.PI * THREE.MathUtils.clamp(phase, 0, 1));
      u.orbPos.value.set(0.82 - 0.64 * phase, 0.5 - 0.36 * arc);
      u.orbSize.value = isDay ? 0.05 : 0.035;
      setColor(u.orb, isDay ? tmp.set('#fff1d6').lerp(C('#ffb07a'), dawn) : tmp.set('#e3ecff'));
      u.orbGlow.value = (isDay ? i.day : 1 - i.day) * (1 - 0.9 * i.overcast);
    },
  };
}

function smoothstepJS(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
