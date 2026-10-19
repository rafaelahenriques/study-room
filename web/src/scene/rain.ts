import * as THREE from 'three/webgpu';
import { Fn, abs, float, floor, fract, mix, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';

/**
 * Placeholder rain-on-glass material (TSL) so the whole pipeline works today:
 * simple falling streaks scaled by `rain`. Replace `drops()` with the real port of
 * the Shadertoy shader — the glass quad's UVs are 0–1 with v pointing up.
 */
export function createRainGlass() {
  const rain = uniform(0);
  const c = new THREE.Color('#dcebf0');
  const tint = uniform(new THREE.Vector3(c.r, c.g, c.b));

  const drops = Fn(() => {
    const st = uv();
    const cols = float(14);
    const col = floor(st.x.mul(cols));
    const rnd = fract(sin(col.mul(12.9898)).mul(43758.5453));
    const speed = rnd.mul(0.35).add(0.25);
    const y = fract(st.y.add(time.mul(speed)).add(rnd.mul(7.0)));
    const x = abs(fract(st.x.mul(cols)).sub(0.5));
    const across = float(1).sub(smoothstep(0.05, 0.3, x));
    const along = smoothstep(0.0, 0.02, y).mul(float(1).sub(smoothstep(0.03, 0.22, y)));
    return across.mul(along);
  });

  const d = drops();
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'M_WindowGlass_Rain';
  // drops read as darker, refracted water against the bright sky
  material.colorNode = mix(tint, vec3(0.35, 0.45, 0.52), d.mul(rain));
  material.opacityNode = mix(float(0.12), float(0.3), rain).add(d.mul(rain).mul(0.6));

  let eased = 0;
  return {
    material,
    /** call every frame with the target rain amount (0–1) */
    update(dt: number, target: number) {
      eased += (target - eased) * (1 - Math.exp(-dt * 1.2));
      rain.value = eased;
    },
  };
}
