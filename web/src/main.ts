import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { config } from './config';
import { Room } from './scene/room';
import { Lighting } from './scene/lighting';
import { createRainGlass } from './scene/rain';
import { createOutsideView } from './scene/outside';
import { createScreen } from './scene/screen';
import { createCalendar } from './scene/calendar';
import { createEasel } from './scene/easel';
import { createCoffee } from './scene/coffee';
import { createAmbient } from './scene/ambient';
import { applyBakedAO } from './scene/bakedAO';
import { createMusic } from './inputs/music';
import { Interactions } from './scene/interact';
import { chooseCity, findCities, startWeather, useDeviceLocation } from './inputs/weather';
import { createPhysics, type Physics } from './scene/physics';
import { startSensors } from './inputs/sensors';
import { createPanel } from './ui/panel';
import { toast } from './ui/toast';
import { createHints, isClickable } from './ui/hints';
import { loadingDone, loadingFailed, loadingStep } from './ui/loading';
import { currentHour, currentWeather, isAwake, registerMotion, soundLevel, soundSpike, state } from './state/roomState';

const VIEW_HEIGHT = 2.1; // metres visible vertically at zoom 1
const VIEW_MIN_HALF_WIDTH = 2.0; // keeps the whole room in view on narrow (portrait) screens

/** the browser can't run this (no WebGPU): the loading screen lists browsers that work */
class NeedsWebGPU extends Error {}

const main = async () => {
  // the shaders are WGSL (wgslFn), so this needs real WebGPU — no WebGL2 fallback
  loadingStep('Starting WebGPU…', 0.02);
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    throw new NeedsWebGPU('This browser can’t run WebGPU, which the room’s shaders need.');
  }
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  // init() quietly switches to the WebGL2 backend if the GPU device can't be created,
  // and the WGSL ports would then fail to compile: say so instead of showing a broken room
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    throw new NeedsWebGPU('WebGPU couldn’t start on this device (the browser fell back to WebGL).');
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

  // progress: the model download is most of the wait (0.05 → 0.8)
  loadingStep('Loading the room…', 0.05);
  const room = await Room.load(config.modelUrl, (f) => loadingStep(`Loading the room… ${Math.round(f * 100)}%`, 0.05 + f * 0.75));
  scene.add(room.root);
  // the baked AO is a nice-to-have: without it the room still renders, just without contact shadows
  loadingStep('Adding the baked shadows…', 0.82);
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
  const calendar = createCalendar(room, (v) => (lighting.dayDip = v));
  // tap the mug to spill it: the puddle is Shadertoy wdtyDH (Buffer A + Image)
  const coffee = createCoffee(scene, room, renderer);
  const cleanUp = () => {
    if (coffee.cleanUp()) toast('All clean');
  };
  document.getElementById('cleanup-btn')?.addEventListener('click', cleanUp);
  // the globe on shelf 3: one full turn per click (exported clip ShelfBall_Spin)
  const globeSpin = room.action('ShelfBall_Spin');
  globeSpin.setLoop(THREE.LoopOnce, 1);
  globeSpin.clampWhenFinished = false;                 // ends where it started: back to rest
  const spinGlobe = () => {
    if (!globeSpin.isRunning()) globeSpin.reset().play();
  };
  const nextDay = () => {
    if (calendar.nextDay()) toast(`Calendar: ${calendar.label()}`);
  };
  const resetDate = () => {
    calendar.resetDate();
    toast(`Calendar: ${calendar.label()}`);
  };
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
    coffee.poke();                                      // a bump ripples spilled coffee
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
    simulateMotion: () => {
      const wasAwake = isAwake();
      registerMotion();
      toast(wasAwake ? 'Motion seen: the room stays awake for another minute' : 'Motion seen: the room wakes up');
    },
    smallNoise: () => soundSpike(config.testSounds.small),
    loudBang: () => soundSpike(config.testSounds.loud),
    toggleMusic,
    nextTrack: () => music.next(),
    findCities: (q) => findCities(q),
    chooseCity: (place) => {
      chooseCity(place);
      toast(`Weather for ${place.name}`);
    },
    useMyLocation: () => void useDeviceLocation().then(() => toast('Weather for your location')).catch((e) => toast(`Location unavailable: ${e.message}`)),
    tossPaper: () => withPhysics((p) => p.tossPaper()),
    knockBooks: () => withPhysics((p) => p.knockBooks()),
    tidyBooks: () => withPhysics((p) => p.tidyBooks()),
    physicsReady: () => physics !== null,
    nextDay,
    resetDate,
    cleanUp,
    calendarLabel: () => calendar.label(),
  });

  const hints = createHints(room, camera, renderer.domElement);
  const easel = createEasel(room, { camera, controls, dom: renderer.domElement, toast });
  new Interactions(camera, renderer.domElement, room, (kind, obj) => {
    if (easel.active) return;                          // while doodling, clicks are brush strokes
    switch (kind) {
      case 'easel':
        easel.enter();
        break;
      case 'mug':
        toast(coffee.spill() ? 'Oops! Coffee everywhere' : 'Press Clean up to set the mug back');
        break;
      case 'lamp':
      case 'lamp_switch':
        // the lamp shows whether the room is awake (motion, music, sensor or the panel's toggle)
        if (isAwake()) {
          state.motion.keepAwake = false;
          state.motion.lastMotion = Number.NEGATIVE_INFINITY;
          toast(state.music.playing ? 'The lamp stays on while music plays'
            : state.motion.sensorActive ? 'The lamp stays on while the sensor sees motion' : 'Lamp off');
        } else {
          state.motion.keepAwake = true;
          toast('Lamp on');
        }
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
      case 'calendar':
        nextDay();
        break;
      case 'ball':
        spinGlobe();
        break;
      case 'clock': {
        const h = currentHour();
        toast(`It's ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} in the room`);
        break;
      }
    }
  }, (o, x, y) => hints.hover(easel.active ? null : o, x, y), isClickable);

  void startWeather();
  void startSensors();

  // compile every material now, so the first frames don't stall while shaders build
  loadingStep('Preparing the shaders…', 0.9);
  await renderer.compileAsync(scene, camera);
  loadingDone();
  // show what can be clicked (the window drag is the main one) for a few seconds
  hints.flash(7);

  const timer = new THREE.Timer();
  if (import.meta.env.DEV) Object.assign(window, { __room: { state, room, lighting, camera, controls, glass, outside, monitor, music, renderer, calendar, easel, coffee, get physics() { return physics; } } });
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
    outside.update({ hour: h, day: L.day, overcast: Math.max(L.cloud, L.rain), rain: L.rain, snow: w.snow, flash: glass.flash }, dt);
    monitor.update(dt, L.awake);
    ambient.update(dt, camera, { sun: L.day * (1 - Math.max(L.cloud, L.rain)), steam: !state.mug.spilled });
    music.update(dt);
    // headphones sway on the stand with the music (Sound_Bump overrides this while it plays)
    swingT += dt;
    const swing = state.music.playing ? Math.sin(swingT * 6.5) * 0.08 * state.music.level : 0;
    headphones.rotation.x += (swing - headphones.rotation.x) * Math.min(1, dt * 10);
    glass.update(dt, camera, {
      rain: w.rain,
      fog: Math.min(1, w.rain * 1.6 + (w.condition === 'fog' ? 0.5 : 0) + 0.16 * w.snow),
      storm: w.condition === 'storm',
    });
    calendar.update(dt);
    room.update(dt);
    physics?.update(dt);
    coffee.update(dt, 0.3 + 0.7 * Math.max(L.day * (1 - 0.6 * Math.max(L.cloud, L.rain)), 0.75 * L.awake));
    easel.update(dt);
    if (!easel.active) controls.update();              // the easel flies the camera itself
    renderer.render(scene, camera);
    hints.update();

    statusTimer += dt;
    if (statusTimer > 0.25) {
      panel.refresh(awake);
      statusTimer = 0;
    }
  });

  const resize = () => {
    fitCamera();
    // the device pixel ratio can change too (window moved to another screen), same cap as at start
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  // a page opened in a hidden or zero-sized frame gets no resize event when it appears
  new ResizeObserver(resize).observe(document.documentElement);
};

main().catch((err) => {
  console.error(err);
  const needsWebGPU = err instanceof NeedsWebGPU;
  loadingFailed(needsWebGPU ? err.message : `The room couldn’t load: ${err instanceof Error ? err.message : err}. Try reloading the page.`, needsWebGPU);
});
