import * as THREE from 'three/webgpu';
import { float, materialEmissive, positionLocal, sin, time } from 'three/tsl';
import type { Room } from './room';

/**
 * Small ambient animations that make the room feel alive:
 *  - steam curling up from the mug
 *  - dust motes drifting in the sunbeam (sunny daytime only)
 *  - the string lights twinkle bulb by bulb (TSL emissive node)
 *
 * Particles are instanced, camera-facing quads with additive blending, so fading a
 * particle is just darkening its instance colour.
 */

function softDotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function particles(count: number, map: THREE.Texture) {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    count,
  );
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

export interface AmbientInputs {
  /** 0 … 1 strength of direct sunlight through the window */
  sun: number;
}

export function createAmbient(scene: THREE.Scene, room: Room) {
  const dot = softDotTexture();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // ---- steam from the mug
  const STEAM = 12;
  const STEAM_LIFE = 3.4;
  const steam = particles(STEAM, dot);
  const mug = room.worldPosition('Anchor_MugSteam');
  const steamSeeds = Array.from({ length: STEAM }, (_, i) => ({ offset: (i / STEAM) * STEAM_LIFE, phase: Math.random() * 6.28 }));
  scene.add(steam);

  // ---- dust in the sunbeam (from the window towards the floor patch)
  const DUST = 90;
  const dust = particles(DUST, dot);
  const beamA = room.worldPosition('Anchor_RainGlass');
  const beamB = room.worldPosition('Anchor_WindowTarget');
  const beam = new THREE.Vector3().subVectors(beamB, beamA);
  const dustSeeds = Array.from({ length: DUST }, () => {
    const along = Math.random();
    const p = beamA.clone().addScaledVector(beam, along);
    p.x += (Math.random() - 0.5) * 0.5;
    p.y += (Math.random() - 0.5) * 0.35;
    p.z += (Math.random() - 0.5) * 0.3;
    return { base: p, s: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28], size: 0.004 + Math.random() * 0.006 };
  });
  scene.add(dust);

  // ---- twinkling string lights: per-bulb phase from the bulb's local position (cm)
  const bulbsOld = room.material('M_StringLightBulb');
  const bulbs = new THREE.MeshStandardNodeMaterial({
    color: bulbsOld.color,
    roughness: bulbsOld.roughness,
    emissive: bulbsOld.emissive,
    emissiveIntensity: bulbsOld.emissiveIntensity,
  });
  bulbs.name = bulbsOld.name;
  const phase = positionLocal.z.mul(0.35).add(positionLocal.x.mul(0.2));
  const twinkle = sin(time.mul(1.6).add(phase)).mul(0.5).add(0.5)
    .mul(sin(time.mul(0.7).add(phase.mul(1.7))).mul(0.5).add(0.5));
  bulbs.emissiveNode = materialEmissive.mul(float(0.55).add(twinkle.mul(0.65)));
  room.setMaterial('StringLights_Bulbs', bulbs);

  let t = 0;
  let sunEased = 0;
  const p = new THREE.Vector3();

  return {
    update(dt: number, camera: THREE.Camera, i: AmbientInputs) {
      t += dt;
      sunEased += (i.sun - sunEased) * Math.min(1, dt * 0.8);

      for (let k = 0; k < STEAM; k++) {
        const seed = steamSeeds[k];
        const a = ((t + seed.offset) % STEAM_LIFE) / STEAM_LIFE; // 0 → 1 over its life
        p.set(
          mug.x + Math.sin(a * 5 + seed.phase) * 0.01 * a,
          mug.y + a * 0.14,
          mug.z + Math.cos(a * 4 + seed.phase) * 0.01 * a,
        );
        dummy.position.copy(p);
        dummy.quaternion.copy(camera.quaternion);
        dummy.scale.setScalar(0.015 + 0.035 * a);
        dummy.updateMatrix();
        steam.setMatrixAt(k, dummy.matrix);
        steam.setColorAt(k, color.setScalar(Math.pow(Math.sin(Math.PI * a), 1.5) * 0.06)); // faint: additive
      }
      steam.instanceMatrix.needsUpdate = true;
      steam.instanceColor!.needsUpdate = true;

      dust.visible = sunEased > 0.01;
      if (dust.visible) {
        for (let k = 0; k < DUST; k++) {
          const d = dustSeeds[k];
          p.copy(d.base);
          p.x += Math.sin(t * 0.13 + d.s[0]) * 0.05;
          p.y += Math.sin(t * 0.07 + d.s[1]) * 0.06;
          p.z += Math.cos(t * 0.11 + d.s[2]) * 0.05;
          dummy.position.copy(p);
          dummy.quaternion.copy(camera.quaternion);
          dummy.scale.setScalar(d.size);
          dummy.updateMatrix();
          dust.setMatrixAt(k, dummy.matrix);
          const glint = 0.5 + 0.5 * Math.sin(t * 0.9 + d.s[3]);
          dust.setColorAt(k, color.setRGB(1, 0.92, 0.75).multiplyScalar(sunEased * glint * 0.9));
        }
        dust.instanceMatrix.needsUpdate = true;
        dust.instanceColor!.needsUpdate = true;
      }
    },
  };
}
