// Coffee: tap the mug and it tips over; the coffee spills into a puddle on the desk.
// The puddle is the WGSL port of "Simple Water Ripple Effect" by Polygon
// https://www.shadertoy.com/view/wdtyDH — see src/shaders/ripple/buffer.wgsl and fragment.wgsl.
// The splash (and any loud noise afterwards) is its iMouse: a drop that ripples across the puddle.
//
// Same setup as the course's plasma project (Buffer A rendered into a render target, read by
// the Image shader as iChannel0), with one difference: this Buffer A also reads its own
// previous frame, so there are two render targets that swap after every step.
import * as THREE from 'three/webgpu';
import { atan, colorSpaceToWorking, float, length, screenCoordinate, sin, smoothstep, texture, uniform, uv, vec2, vec4, wgslFn } from 'three/tsl';
import type { Node } from 'three/webgpu';
import bufferShader from '../shaders/ripple/buffer.wgsl?raw';
import rippleShader from '../shaders/ripple/fragment.wgsl?raw';
import { state } from '../state/roomState';
import { mugRim } from './mugRim';
import type { Room } from './room';

const SIM = 128;            // ripple simulation size (pixels)
const STEP = 1 / 60;        // the original runs one step per frame at 60 fps
const CALM_AFTER = 30;      // seconds without a splash before the simulation pauses
const PUDDLE_RADIUS = 0.11; // metres
const TIP_SECONDS = 0.45;
const SPREAD_SECONDS = 1.6;
const TIP_ANGLE = THREE.MathUtils.degToRad(82);

const COFFEE = '#3a2112';

/** iChannel1: the coffee, one solid colour (the ripples show through the shader's glints) */
const coffeeCanvas = (): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = COFFEE;
  ctx.fillRect(0, 0, 4, 4);
  return c;
};

const ease = (k: number) => k * k * (3 - 2 * k);

export const createCoffee = (scene: THREE.Scene, room: Room, renderer: THREE.WebGPURenderer) => {
  const mug = room.node<THREE.Mesh>('Mug');
  const rim = mugRim(mug);
  const canvas = coffeeCanvas();

  // ---- coffee in the cup: a plain lit disc just below the rim
  const cup = new THREE.Mesh(new THREE.CircleGeometry(rim.radius * 0.92, 48), new THREE.MeshStandardMaterial({ color: COFFEE, roughness: 0.25 }));
  cup.name = 'Coffee_Cup';
  cup.rotation.x = -Math.PI / 2;
  cup.position.copy(rim.centre).add(new THREE.Vector3(0, -0.012, 0));
  scene.add(cup);

  // ---- where it spills: towards the viewer if the desk is free there, else the freest side
  mug.updateWorldMatrix(true, false);
  const pos = mug.geometry.getAttribute('position');
  let bottom = Infinity;
  for (let i = 0; i < pos.count; i++) bottom = Math.min(bottom, new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mug.matrixWorld).y);
  const base = new THREE.Vector3(rim.centre.x, bottom, rim.centre.z);
  const height = rim.centre.y - bottom;
  const ray = new THREE.Raycaster();
  const deskAt = (p: THREE.Vector3) => {
    ray.set(new THREE.Vector3(p.x, p.y + 0.5, p.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(room.root, true).find((h) => h.object !== mug);
    return hit && hit.object.name.startsWith('Desk_Top') && Math.abs(hit.point.y - bottom) < 0.01 ? hit.point.y : null;
  };
  const toViewer = new THREE.Vector3(-1, 0, -1).normalize();      // the room camera looks from −x, −z
  let dir = toViewer.clone();
  let best = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const centre = base.clone().addScaledVector(d, rim.radius + height * 0.9);
    const free = deskAt(centre) !== null && [0, 1, 2, 3, 4, 5].every((j) => {
      const b = (j / 6) * Math.PI * 2;
      return deskAt(centre.clone().add(new THREE.Vector3(Math.cos(b), 0, Math.sin(b)).multiplyScalar(PUDDLE_RADIUS * 0.8))) !== null;
    });
    const score = (free ? 10 : 0) + d.dot(toViewer);
    if (score > best) { best = score; dir = d; }
  }
  const puddleCentre = base.clone().addScaledVector(dir, rim.radius + height * 0.9);
  puddleCentre.y = bottom + 0.0015;

  // the mug tips over its bottom edge, around a horizontal axis (up × direction)
  const pivot = new THREE.Object3D();
  pivot.position.copy(base).addScaledVector(dir, rim.radius * 0.95);
  room.root.add(pivot);
  const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
  const restParent = mug.parent!;
  const pivotRest = pivot.position.clone();
  // how far to lower (or raise) the tipped mug so it lies on the desk: measured once, in the tipped pose
  let settle: number | null = null;
  const measureSettle = () => {
    pivot.quaternion.setFromAxisAngle(axis, TIP_ANGLE);
    pivot.updateMatrixWorld(true);
    let low = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(mug.matrixWorld).y);
    pivot.quaternion.identity();
    pivot.updateMatrixWorld(true);
    return bottom - low;
  };

  // ---- Buffer A: two render targets, swapped after every step
  const target = () => new THREE.RenderTarget(SIM, SIM, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  let read = target();
  let write = target();
  const u = {
    iResolution: uniform(new THREE.Vector2(SIM, SIM)),
    iMouse: uniform(new THREE.Vector4(0, 0, 0, 0)),
    iFrame: uniform(0),
    light: uniform(1),
    strength: uniform(1.5),     // ripples big enough to see on the desk (see fragment.wgsl)
    spread: uniform(0),         // 0 … 1: how far the puddle has run out
  };
  const previous = texture(read.texture);
  const bufferMat = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
  bufferMat.colorNode = wgslFn(bufferShader)({
    fragCoord: screenCoordinate,                       // pixel position, top-left origin like the texture rows
    iResolution: u.iResolution,
    iMouse: u.iMouse,
    iFrame: u.iFrame,
    iChannel0: previous,
  }) as unknown as Node<'vec4'>;
  const simScene = new THREE.Scene();
  simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bufferMat));
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- Image: the puddle
  const heights = texture(write.texture);
  const puddleTex = new THREE.CanvasTexture(canvas);
  puddleTex.colorSpace = THREE.NoColorSpace;          // raw sRGB values: converted below with colorSpaceToWorking, as in the course
  const coffee = texture(puddleTex);
  const fragCoord = vec2(uv().x, float(1).sub(uv().y)).mul(u.iResolution);   // disc uv → the buffer's top-left pixels
  // the shader works in display (sRGB) colours, like on Shadertoy: convert, as in the course's bake project
  const shaded = colorSpaceToWorking(wgslFn(rippleShader)({
    fragCoord,
    iResolution: u.iResolution,
    iChannel0: heights,
    iChannel0Sampler: heights,
    iChannel1: coffee,
    iChannel1Sampler: coffee,
    strength: u.strength,
  }) as unknown as Node<'vec4'>, THREE.SRGBColorSpace) as unknown as Node<'vec4'>;
  // a wobbly outline that runs out from the centre as `spread` goes 0 → 1
  const p = uv().sub(0.5);
  const angle = atan(p.y, p.x);
  const edge = u.spread.mul(float(0.4).add(sin(angle.mul(3).add(1)).mul(0.05)).add(sin(angle.mul(7)).mul(0.03)));
  const inside = float(1).sub(smoothstep(edge.sub(0.015), edge, length(p)));
  const puddleMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  puddleMat.name = 'M_Coffee_Puddle';
  puddleMat.colorNode = vec4(shaded.xyz.mul(u.light), 1);   // unlit shader: follow the room's light (opacity comes from the outline)
  puddleMat.opacityNode = inside;
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(PUDDLE_RADIUS, 64), puddleMat);
  puddle.name = 'Coffee_Puddle';
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.copy(puddleCentre);
  puddle.renderOrder = 1;
  puddle.visible = false;
  scene.add(puddle);

  // ---- drops: iMouse in the buffer's pixels (z > 1 while "pressed")
  const drop = { x: SIM / 2, y: SIM / 2, pulse: 0 };
  let lastDrop = -Infinity;
  const splash = (x: number, y: number, steps: number) => {
    drop.x = x;
    drop.y = y;
    drop.pulse = steps;
    lastDrop = performance.now();
  };

  let accumulator = 0;
  let frame = 0;
  const step = () => {
    const pressed = drop.pulse > 0;
    if (drop.pulse > 0) drop.pulse--;
    u.iMouse.value.set(drop.x, drop.y, pressed ? 2 : 0, 0);
    u.iFrame.value = frame++;
    previous.value = read.texture;
    renderer.setRenderTarget(write);
    renderer.render(simScene, simCamera);
    renderer.setRenderTarget(null);
    heights.value = write.texture;
    [read, write] = [write, read];
  };

  // ---- spill and clean up
  let phase: 'upright' | 'tipping' | 'spilled' | 'cleaning' = 'upright';
  let t = 0;
  let splashed = false;
  const button = document.getElementById('cleanup-btn');
  const setSpilled = (on: boolean) => {
    state.mug.spilled = on;
    if (button) button.hidden = !on;
  };

  return {
    /** tap the mug: it tips over and the coffee spills (ignored unless it's standing) */
    spill(): boolean {
      if (phase !== 'upright') return false;
      pivot.quaternion.identity();
      pivot.updateMatrixWorld(true);
      pivot.attach(mug);                                // keeps its world transform; now it turns with the pivot
      settle ??= measureSettle();
      cup.visible = false;
      frame = 0;                                        // a fresh, flat simulation
      phase = 'tipping';
      t = 0;
      splashed = false;
      setSpilled(true);
      return true;
    },
    /** the Clean up button: the mug stands up again and the puddle is wiped away */
    cleanUp(): boolean {
      if (phase !== 'spilled') return false;
      phase = 'cleaning';
      t = 0;
      return true;
    },
    /** a loud noise ripples the spilled coffee */
    poke() {
      if (phase !== 'spilled') return;
      const a = Math.random() * Math.PI * 2;
      splash(SIM * (0.5 + Math.cos(a) * 0.15), SIM * (0.5 + Math.sin(a) * 0.15), 2);
    },
    /** call every frame, before the main render; `light` is the room's brightness (0 … 1) */
    update(dt: number, light: number) {
      u.light.value = light;
      t += dt;
      if (phase === 'tipping') {
        const k = Math.min(1, t / TIP_SECONDS);
        pivot.quaternion.setFromAxisAngle(axis, TIP_ANGLE * k * k);   // falls faster and faster
        pivot.position.y = pivotRest.y + (settle ?? 0) * k * k;      // and ends lying on the desk
        puddle.visible = true;
        u.spread.value = ease(Math.min(1, Math.max(0, (t - TIP_SECONDS * 0.8) / SPREAD_SECONDS)));
        if (k >= 1 && !splashed) {
          splashed = true;
          splash(SIM / 2, SIM / 2, 6);                    // the splash where the coffee lands
        }
        if (t >= TIP_SECONDS + SPREAD_SECONDS) phase = 'spilled';
      } else if (phase === 'cleaning') {
        const k = Math.min(1, t / 0.7);
        pivot.quaternion.setFromAxisAngle(axis, TIP_ANGLE * (1 - ease(k)));
        pivot.position.y = pivotRest.y + (settle ?? 0) * (1 - ease(k));
        u.spread.value = 1 - ease(k);
        if (k >= 1) {
          pivot.position.copy(pivotRest);
          pivot.quaternion.identity();
          pivot.updateMatrixWorld(true);
          restParent.attach(mug);
          puddle.visible = false;
          cup.visible = true;
          phase = 'upright';
          setSpilled(false);
        }
      }
      if (!puddle.visible) return;
      if (frame > 0 && performance.now() - lastDrop > CALM_AFTER * 1000) return;   // still coffee: skip the passes
      accumulator = Math.min(accumulator + dt, STEP * 3);
      while (accumulator >= STEP) {
        step();
        accumulator -= STEP;
      }
    },
  };
};
