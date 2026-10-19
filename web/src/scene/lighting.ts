import * as THREE from 'three/webgpu';
import type { Room } from './room';
import { currentHour, currentWeather, isAwake } from '../state/roomState';

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent easing towards a target. */
const ease = (current: number, target: number, dt: number, speed = 2.5) =>
  current + (target - current) * (1 - Math.exp(-dt * speed));

const C = (hex: string) => new THREE.Color(hex);
const PALETTE = {
  sunLow: C('#ffb27a'), sunHigh: C('#fff3e2'),
  skyDay: C('#e8eef5'), skyNight: C('#56618f'), skyGrey: C('#c3c7cd'),
  groundDay: C('#8a6a4a'), groundNight: C('#3a2a20'),
  bgDay: C('#e9dfd3'), bgNight: C('#232838'), bgGrey: C('#cfcfcf'),
};

/**
 * Turns RoomState into lights and emissive materials. Everything eases, so changing
 * weather/time/motion fades instead of popping.
 */
export class Lighting {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8a6a4a, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly lamp = new THREE.SpotLight(0xffd49a, 0, 2.5, 0.75, 0.6, 2);
  readonly screenGlow = new THREE.PointLight(0x9fc4ff, 0, 1.2, 2);
  /** warm fill from the string lights, so the room reads at night */
  readonly nightFill = new THREE.PointLight(0xffc27a, 0, 4.5, 1.2);

  /** eased 0–1 values other modules can read */
  readonly levels = { day: 1, awake: 0, rain: 0, cloud: 0 };

  private readonly sunTarget = new THREE.Vector3();
  private readonly sunBase = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly mats;

  constructor(private readonly scene: THREE.Scene, private readonly room: Room) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -2.2;
    cam.right = cam.top = 2.2;
    cam.near = 0.1;
    cam.far = 12;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.hemi, this.sun, this.sun.target, this.lamp, this.lamp.target, this.screenGlow, this.nightFill);

    room.worldPosition('Anchor_WindowTarget', this.sunTarget);
    room.worldPosition('Anchor_WindowLight', this.sunBase).sub(this.sunTarget);
    room.worldPosition('Anchor_ScreenLight', this.screenGlow.position);
    room.worldPosition('Anchor_CameraTarget', this.nightFill.position).add(new THREE.Vector3(0.3, 1.0, 0.2));

    this.mats = {
      bulb: room.material('M_LampBulb'),
      fairy: room.material('M_StringLightBulb'),
    };
    this.mats.bulb.emissiveIntensity = 0;
  }

  update(dt: number, now = performance.now()): void {
    const L = this.levels;
    const hour = currentHour();
    const w = currentWeather();

    // sun elevation: -1 at midnight, 0 at 6h/18h, 1 at noon
    const elev = Math.sin((Math.PI * (hour - 6)) / 12);
    L.day = ease(L.day, smoothstep(-0.12, 0.3, elev), dt, 1.5);
    L.rain = ease(L.rain, w.rain, dt, 1.0);
    L.cloud = ease(L.cloud, w.cloud, dt, 1.0);
    L.awake = ease(L.awake, isAwake(now) ? 1 : 0, dt, 2.0);
    const day = L.day;
    const overcast = Math.max(L.cloud, L.rain);

    // sun: swings across the window during the day, warm when low
    const az = ((hour - 12) / 6) * 0.5;
    const dir = this.tmp.copy(this.sunBase).applyAxisAngle(THREE.Object3D.DEFAULT_UP, az);
    dir.y = Math.abs(dir.y) * THREE.MathUtils.lerp(0.35, 1, Math.max(elev, 0));
    this.sun.position.copy(this.sunTarget).add(dir);
    this.sun.target.position.copy(this.sunTarget);
    this.sun.color.lerpColors(PALETTE.sunLow, PALETTE.sunHigh, smoothstep(0.05, 0.6, elev));
    this.sun.intensity = 3.2 * day * (1 - 0.8 * overcast);

    // sky fill
    this.hemi.color.lerpColors(PALETTE.skyNight, PALETTE.skyDay, day).lerp(PALETTE.skyGrey, overcast * 0.6 * day);
    this.hemi.groundColor.lerpColors(PALETTE.groundNight, PALETTE.groundDay, day);
    this.hemi.intensity = 0.7 + 0.7 * day * (1 - 0.25 * overcast);

    // page background (the view outside the window lives in outside.ts)
    const bg = this.scene.background as THREE.Color | null;
    if (bg?.isColor) bg.lerpColors(PALETTE.bgNight, PALETTE.bgDay, day).lerp(PALETTE.bgGrey, overcast * 0.35 * day);

    // desk lamp follows the animated head
    this.room.worldPosition('Anchor_LampLight', this.lamp.position);
    this.room.worldPosition('Anchor_LampTarget', this.lamp.target.position);
    this.lamp.intensity = 6 * L.awake;
    this.mats.bulb.emissiveIntensity = 3 * L.awake;

    // monitor glow (the screen picture itself is drawn by screen.ts)
    this.screenGlow.intensity = 0.6 * L.awake;

    // string lights at night (and a little on dark rainy days)
    const night = Math.max(1 - day, overcast * 0.35);
    this.mats.fairy.emissiveIntensity = 3.5 * night;
    this.nightFill.intensity = 2.2 * night;
  }
}
