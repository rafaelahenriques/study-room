// Rain on the window glass: the WGSL port of "Heartfelt" by BigWings
// https://www.shadertoy.com/view/ltffzl — see src/shaders/heartfelt/fragment.wgsl
//
// Same setup as the course's "Shadertoy shader in Three.js": the WGSL function is imported
// with ?raw, turned into a node with wgslFn, and its Shadertoy inputs are TSL uniform() nodes
// whose .value we update every frame.
import * as THREE from 'three/webgpu';
import { float, screenUV, uniform, uv, vec2, viewportMipTexture, wgslFn } from 'three/tsl';
import type { Node } from 'three/webgpu';
import heartfeltShader from '../shaders/heartfelt/fragment.wgsl?raw';

/** Lightning flicker from Heartfelt's USE_POST_PROCESSING, same formula as in the WGSL */
function lightningAt(T: number): number {
  const t = (T + 3) * 0.5;
  const fade = Math.min(1, Math.max(0, T / 10));
  const s = fade * fade * (3 - 2 * fade);
  return Math.sin(t * Math.sin(t * 10)) * Math.pow(Math.max(0, Math.sin(t + Math.sin(t))), 10) * s;
}

export interface RainGlassOptions {
  dom: HTMLElement;
  camera: THREE.Camera;
  /** orbit controls (disabled while dragging on the glass) */
  controls: { enabled: boolean };
}

export function createRainGlass(glass: THREE.Mesh, opts: RainGlassOptions) {
  // glass corners (by UV) — glTF puts v = 0 at the top of the glass
  const pos = glass.geometry.getAttribute('position');
  const uvs = glass.geometry.getAttribute('uv');
  const corner = (u: number, v: number) => {
    for (let i = 0; i < uvs.count; i++) {
      if (Math.abs(uvs.getX(i) - u) < 1e-3 && Math.abs(uvs.getY(i) - v) < 1e-3)
        return new THREE.Vector3().fromBufferAttribute(pos, i);
    }
    throw new Error('Window_Glass corner not found');
  };
  const c00 = corner(0, 1); // bottom-left
  const c10 = corner(1, 1); // bottom-right
  const c01 = corner(0, 0); // top-left
  const aspect = c00.distanceTo(c10) / c00.distanceTo(c01);

  // Shadertoy inputs (uniforms are TSL nodes, we update their .value every frame)
  const uniforms = {
    iTime: uniform(0),
    iMouse: uniform(new THREE.Vector4(0, 0, 0, 0)),
    iResolution: uniform(new THREE.Vector2(512 * aspect, 512)),
    screenU: uniform(new THREE.Vector2(0.1, 0)),  // glass x axis (0 → 1) in screen uv
    screenV: uniform(new THREE.Vector2(0, -0.1)), // glass y axis (0 → 1) in screen uv
    weatherRain: uniform(0),
    fog: uniform(0),
    storm: uniform(0),
  };

  const heartfelt = wgslFn(heartfeltShader);
  // iChannel0 = what is rendered behind the glass (passed twice: as texture and as sampler)
  const iChannel0 = viewportMipTexture();
  // Shadertoy's fragCoord starts bottom-left: flip the glTF uv so y points up
  const fragCoord = vec2(uv().x, float(1).sub(uv().y)).mul(uniforms.iResolution);

  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.name = 'M_WindowGlass_Heartfelt';
  material.colorNode = heartfelt({
    fragCoord,
    iTime: uniforms.iTime,
    iMouse: uniforms.iMouse,
    iResolution: uniforms.iResolution,
    iChannel0,
    iChannel0Sampler: iChannel0,
    screenUV,
    screenU: uniforms.screenU,
    screenV: uniforms.screenV,
    weatherRain: uniforms.weatherRain,
    fog: uniforms.fog,
    storm: uniforms.storm,
  }) as unknown as Node<'vec4'>; // wgslFn returns an untyped Node in @types/three
  glass.material = material;

  const w = new THREE.Vector3();
  const toScreen = (local: THREE.Vector3, camera: THREE.Camera) => {
    w.copy(local);
    glass.localToWorld(w).project(camera);
    return new THREE.Vector2((w.x + 1) / 2, (1 - w.y) / 2);
  };

  // ---- interaction: dragging on the glass is Shadertoy's iMouse
  // (x, y = last position in glass "pixels" from the bottom-left, z > 0 while pressed)
  const mouse = { x: 0, y: 0, down: false };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitGlass = (ev: PointerEvent): boolean => {
    const r = opts.dom.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, opts.camera);
    const hit = ray.intersectObject(glass, false)[0]?.uv;
    if (!hit) return false;
    mouse.x = hit.x;
    mouse.y = 1 - hit.y;
    return true;
  };
  // capture phase so this runs before OrbitControls and can stop the orbit
  opts.dom.addEventListener('pointerdown', (ev) => {
    if (!hitGlass(ev)) return;
    mouse.down = true;
    opts.controls.enabled = false;
    try {
      opts.dom.setPointerCapture(ev.pointerId); // keep the drag even if the pointer leaves the glass
    } catch {
      /* synthetic or already-released pointer: dragging still works without capture */
    }
  }, { capture: true });
  opts.dom.addEventListener('pointermove', (ev) => {
    if (mouse.down) hitGlass(ev);
  });
  const end = (ev: PointerEvent) => {
    if (!mouse.down) return;
    mouse.down = false;
    opts.controls.enabled = true;
    if (opts.dom.hasPointerCapture(ev.pointerId)) opts.dom.releasePointerCapture(ev.pointerId);
  };
  opts.dom.addEventListener('pointerup', end);
  opts.dom.addEventListener('pointercancel', end);

  const eased = { rain: 0, fog: 0, storm: 0, speed: 1 };
  let flash = 0;

  return {
    material,
    get dragging() { return mouse.down; },
    /** current lightning flash (0 … ~1), for the room lights */
    get flash() { return flash; },

    update(dt: number, camera: THREE.Camera, target: { rain: number; fog: number; storm: boolean }) {
      const k = 1 - Math.exp(-dt * 0.8);
      eased.rain += (target.rain - eased.rain) * k;
      const fogTarget = mouse.down ? Math.max(target.fog, 0.6 + 0.4 * mouse.y) : target.fog;
      eased.fog += (fogTarget - eased.fog) * (1 - Math.exp(-dt * (mouse.down ? 4 : 0.5)));
      eased.storm += ((target.storm ? 1 : 0) - eased.storm) * (1 - Math.exp(-dt));
      eased.speed += ((target.storm ? 1.4 : 1) - eased.speed) * k;

      const res = uniforms.iResolution.value;
      uniforms.iTime.value += dt * eased.speed;
      uniforms.iMouse.value.set(mouse.x * res.x, mouse.y * res.y, mouse.down ? 1 : 0, 0);
      uniforms.weatherRain.value = eased.rain;
      uniforms.fog.value = eased.fog * 0.85; // 0.85: mip-level scale for this window size
      uniforms.storm.value = eased.storm;

      const T = uniforms.iTime.value + mouse.x * 2; // T = iTime + M.x * 2, as in the shader
      flash = Math.max(0, lightningAt(T)) * eased.storm;

      const s0 = toScreen(c00, camera);
      uniforms.screenU.value.copy(toScreen(c10, camera)).sub(s0);
      uniforms.screenV.value.copy(toScreen(c01, camera)).sub(s0);
    },
  };
}
