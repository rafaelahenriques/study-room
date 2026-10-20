import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { config } from './config';
import { Room } from './scene/room';
import { Lighting } from './scene/lighting';
import { createRainGlass } from './scene/rain';
import { createOutsideView } from './scene/outside';
import { createScreen } from './scene/screen';
import { createAmbient } from './scene/ambient';
import { applyBakedAO } from './scene/bakedAO';
import { createMusic } from './inputs/music';
import { Interactions } from './scene/interact';
import { searchCity, startWeather, useDeviceLocation } from './inputs/weather';
import { createPhysics, type Physics } from './scene/physics';
import { startSensors } from './inputs/sensors';
import { createPanel } from './ui/panel';
import { toast } from './ui/toast';
import { currentHour, currentWeather, isAwake, registerMotion, soundLevel, state } from './state/roomState';

const VIEW_HEIGHT = 2.1; // metres visible vertically at zoom 1
const VIEW_MIN_HALF_WIDTH = 2.0; // keeps the whole room in view on narrow (portrait) screens

async function main() {
  // the shaders are WGSL (wgslFn), so this needs real WebGPU — no WebGL2 fallback
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    throw new Error('this experiment needs WebGPU. Try a recent Chrome or Edge, Safari 26+, or Firefox 141+ on Windows.');
  }
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  // init() quietly switches to the WebGL2 backend if the GPU device can't be created,
  // and the WGSL ports would then fail to compile: say so instead of showing a broken room
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    throw new Error('WebGPU could not start on this device (the browser fell back to WebGL). Try a recent Chrome or Edge.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9dfd3');

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  camera.position.set(-4, 3.8, -4);
  // orthographic frustum from the canvas aspect: fixed height, but never narrower than the room
  const fitCamera = () => {
    const aspect = window.innerWidth / window.innerHeight;
    const halfHeight = Math.max(VIEW_HEIGHT, VIEW_MIN_HALF_WIDTH / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };
  fitCamera();

  const progress = document.getElementById('loading-progress');
  const room = await Room.load(config.modelUrl, (f) => progress && (progress.style.width = `${Math.round(f * 100)}%`));
  scene.add(room.root);
  // the baked AO is a nice-to-have: without it the room still renders, just without contact shadows
  await applyBakedAO(room, `${import.meta.env.BASE_URL}textures/room_ao.jpg`)
    .catch((err) => console.warn('Baked AO not loaded, continuing without it:', err));

  // camera: orbit only around the open corner of the room
  const controls = new OrbitControls(camera, renderer.domElement);
  room.worldPosition('Anchor_CameraTarget', controls.target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minZoom = 0.8;
  controls.maxZoom = 3;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.3;
  controls.minAzimuthAngle = -Math.PI * 0.94;
  controls.maxAzimuthAngle = -Math.PI * 0.56;
  controls.update();

  const ambient = createAmbient(scene, room); // before Lighting: swaps in the twinkling string-light material
  const lighting = new Lighting(scene, room);
  const outside = createOutsideView(room);
  const glass = createRainGlass(room.node<THREE.Mesh>('Window_Glass'), { dom: renderer.domElement, camera, controls });
  const monitor = createScreen(room);
  const music = createMusic();
  const headphones = room.node('Headphones');
  let swingT = 0;

  room.loop('Plant_Sway');
  const chairIdle = room.loop('Chair_Swivel', 0.6);
  const chairSwivel = room.node('Chair_Swivel');
  let chairSpin: { t: number; idleTime: number; from: THREE.Quaternion } | null = null;
  const spinQ = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const curtains = room.loop('Curtain_Sway', 0.8);

  const hourHand = room.node('Clock_HandHour');
  const minuteHand = room.node('Clock_HandMinute');

  let lastBump = -Infinity;
  const soundBump = () => {
    const now = performance.now();
    if (now - lastBump < config.soundBumpCooldownSeconds * 1000) return;
    lastBump = now;
    room.trigger('Sound_Bump');
  };

  // physics (Rapier) loads in the background; until then the physics actions just say so
  let physics: Physics | null = null;
  createPhysics(scene, room, (n) => toast(n === 1 ? 'Score! Into the bin' : `Score! ${n} in the bin`))
    .then((p) => (physics = p))
    .catch((err) => console.warn('Physics unavailable:', err));
  const withPhysics = (fn: (p: Physics) => void) => (physics ? fn(physics) : toast('Physics is still loading…'));
  for (const n of ['Shelf_1', 'Shelf_2', 'Shelf_3']) room.node(n).userData.interactive = 'shelf';
  room.root.traverse((o) => { if (/^Shelf_\d_Book_\d+$/.test(o.name)) o.userData.interactive = 'shelf'; });

  const toggleMusic = () => void music.toggle().then((r) => toast(
    r === 'playing' ? `♪ ${state.music.title} — ${state.music.artist}`
      : r === 'paused' ? 'Music off' : 'Music unavailable right now (Audius could not be reached)'));

  const panel = createPanel({
    simulateMotion: () => registerMotion(),
    soundBump,
    toggleMusic,
    nextTrack: () => music.next(),
    searchCity: (name) => void searchCity(name).then((n) => toast(`Weather for ${n}`)).catch((e) => toast(`City not found: ${e.message}`)),
    useMyLocation: () => void useDeviceLocation().then(() => toast('Weather for your location')).catch((e) => toast(`Location unavailable: ${e.message}`)),
    tossPaper: () => withPhysics((p) => p.tossPaper()),
    knockBooks: () => withPhysics((p) => p.knockBooks()),
    tidyBooks: () => withPhysics((p) => p.tidyBooks()),
  });

  new Interactions(camera, renderer.domElement, room, (kind, obj) => {
    switch (kind) {
      case 'lamp':
      case 'lamp_switch':
        state.motion.keepAwake = !state.motion.keepAwake;
        if (!state.motion.keepAwake) state.motion.lastMotion = Number.NEGATIVE_INFINITY;
        toast(state.motion.keepAwake ? 'Lamp on' : 'Lamp off');
        break;
      case 'drawer':
        toast(room.toggleDrawer(obj.name) ? 'Opening the drawer…' : 'Closing the drawer');
        break;
      case 'headphones':
        soundBump();
        toggleMusic();
        break;
      case 'monitor':
        registerMotion();
        monitor.next();
        break;
      case 'window':
        toast('Hold and drag on the window: up/down = rain, left/right = time');
        break;
      case 'chair':
        if (!chairSpin) {
          chairSpin = { t: 0, idleTime: chairIdle.time, from: chairSwivel.quaternion.clone() };
          chairIdle.stop();
        }
        break;
      case 'paper':
        withPhysics((p) => p.tossPaper());
        break;
      case 'bin':
        toast('Click the notepad on the monitor stand to throw a paper ball');
        break;
      case 'shelf': {
        const shelf = Number(/Shelf_(\d)/.exec(obj.name)?.[1]);
        withPhysics((p) => p.knockBooks(shelf || undefined));
        break;
      }
      case 'clock': {
        const h = currentHour();
        toast(`It's ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} in the room`);
        break;
      }
      default:
        toast(`${obj.name.replace(/_/g, ' ')}`);
    }
  });

  void startWeather();
  void startSensors();

  document.getElementById('loading')?.classList.add('hidden');
  // the shader interaction is the heart of the piece, but the window is small: point it out once
  toast('Tip: hold and drag on the window to change the rain', 7000);

  const timer = new THREE.Timer();
  if (import.meta.env.DEV) Object.assign(window, { __room: { state, room, lighting, camera, controls, glass, outside, monitor, music, renderer, get physics() { return physics; } } });
  let prevAwake = false;
  let lastBooksFall = -Infinity;
  let statusTimer = 0;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const now = performance.now();

    const awake = isAwake(now);
    if (awake !== prevAwake) {
      room.playOnce('Lamp_Wake', awake);
      prevAwake = awake;
    }
    if (soundLevel() > config.soundBumpThreshold) soundBump();
    // a really loud sound knocks the books off their shelves
    if (soundLevel() > config.booksFallThreshold && now - lastBooksFall > 8000) {
      lastBooksFall = now;
      physics?.knockBooks();
    }

    // chair: one smooth turn on its swivel, then back to the idle sway where it left off
    if (chairSpin) {
      chairSpin.t += dt;
      const k = Math.min(1, chairSpin.t / 1.6);
      const eased = 1 - Math.pow(1 - k, 3);
      chairSwivel.quaternion.copy(chairSpin.from).multiply(spinQ.setFromAxisAngle(UP, eased * Math.PI * 2));
      if (k >= 1) {
        chairIdle.play();
        chairIdle.time = chairSpin.idleTime;
        chairSpin = null;
      }
    }

    const w = currentWeather();
    curtains.timeScale = w.condition === 'storm' ? 1.6 : 0.8;

    const h = currentHour();
    minuteHand.rotation.z = ((h % 1) * Math.PI * 2);
    hourHand.rotation.z = (((h % 12) / 12) * Math.PI * 2);

    lighting.flash = glass.flash;
    lighting.update(dt, now);
    const L = lighting.levels;
    outside.update({ hour: h, day: L.day, overcast: Math.max(L.cloud, L.rain), rain: L.rain, snow: w.condition === 'snow' ? 1 : 0, flash: glass.flash }, dt);
    monitor.update(dt, L.awake);
    ambient.update(dt, camera, { sun: L.day * (1 - Math.max(L.cloud, L.rain)) });
    music.update(dt);
    // headphones sway on the stand with the music (Sound_Bump overrides this while it plays)
    swingT += dt;
    const swing = state.music.playing ? Math.sin(swingT * 6.5) * 0.08 * state.music.level : 0;
    headphones.rotation.x += (swing - headphones.rotation.x) * Math.min(1, dt * 10);
    glass.update(dt, camera, {
      rain: w.rain,
      fog: Math.min(1, w.rain * 1.6 + (w.condition === 'fog' ? 0.5 : 0) + (w.condition === 'snow' ? 0.12 : 0)),
      storm: w.condition === 'storm',
    });
    room.update(dt);
    physics?.update(dt);
    controls.update();
    renderer.render(scene, camera);

    statusTimer += dt;
    if (statusTimer > 0.25) {
      panel.refresh(awake);
      statusTimer = 0;
    }
  });

  window.addEventListener('resize', () => {
    fitCamera();
    // the device pixel ratio can change too (window moved to another screen), same cap as at start
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

main().catch((err) => {
  console.error(err);
  const title = document.querySelector('.loading-title');
  if (title) title.textContent = `Could not load the room: ${err instanceof Error ? err.message : err}`;
});
