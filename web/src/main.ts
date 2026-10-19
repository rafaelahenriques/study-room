import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { config } from './config';
import { Room } from './scene/room';
import { Lighting } from './scene/lighting';
import { createRainGlass } from './scene/rain';
import { createOutsideView } from './scene/outside';
import { createScreen } from './scene/screen';
import { createMusic } from './inputs/music';
import { Interactions } from './scene/interact';
import { startWeather } from './inputs/weather';
import { startSensors } from './inputs/sensors';
import { createPanel } from './ui/panel';
import { toast } from './ui/toast';
import { currentHour, currentWeather, isAwake, registerMotion, soundLevel, state } from './state/roomState';

const VIEW_HEIGHT = 2.1; // metres visible vertically at zoom 1

async function main() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init(); // uses WebGPU, falls back to WebGL2 automatically
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9dfd3');

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(-VIEW_HEIGHT * aspect, VIEW_HEIGHT * aspect, VIEW_HEIGHT, -VIEW_HEIGHT, 0.01, 50);
  camera.position.set(-4, 3.8, -4);

  const progress = document.getElementById('loading-progress');
  const room = await Room.load(config.modelUrl, (f) => progress && (progress.style.width = `${Math.round(f * 100)}%`));
  scene.add(room.root);

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

  const lighting = new Lighting(scene, room);
  const outside = createOutsideView(room);
  const glass = createRainGlass(room.node<THREE.Mesh>('Window_Glass'));
  const monitor = createScreen(room);
  const music = createMusic();
  const headphones = room.node('Headphones');
  let swingT = 0;

  room.loop('Plant_Sway');
  room.loop('Chair_Swivel', 0.6);
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

  const panel = createPanel({
    simulateMotion: () => registerMotion(),
    soundBump,
    toggleMusic: () => void music.toggle(),
    nextTrack: () => music.next(),
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
        void music.toggle().then((on) => toast(on ? `♪ ${state.music.title} — ${state.music.artist}` : 'Music off'));
        break;
      case 'monitor':
        registerMotion();
        monitor.next();
        break;
      case 'window': {
        const w = currentWeather();
        toast(`Outside: ${w.condition}${state.weather.live ? `, ${Math.round(state.weather.live.temperature)}°C` : ''}`);
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

  startWeather();
  void startSensors();

  document.getElementById('loading')?.classList.add('hidden');

  const timer = new THREE.Timer();
  if (import.meta.env.DEV) Object.assign(window, { __room: { state, room, lighting, camera, controls, glass, outside, monitor, music } });
  let prevAwake = false;
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

    const w = currentWeather();
    curtains.timeScale = w.condition === 'storm' ? 1.6 : 0.8;

    const h = currentHour();
    minuteHand.rotation.z = ((h % 1) * Math.PI * 2);
    hourHand.rotation.z = (((h % 12) / 12) * Math.PI * 2);

    lighting.update(dt, now);
    const L = lighting.levels;
    outside.update({ hour: h, day: L.day, overcast: Math.max(L.cloud, L.rain), rain: L.rain });
    monitor.update(dt, L.awake);
    music.update(dt);
    // headphones sway on the stand with the music (Sound_Bump overrides this while it plays)
    swingT += dt;
    const swing = state.music.playing ? Math.sin(swingT * 6.5) * 0.08 * state.music.level : 0;
    headphones.rotation.x += (swing - headphones.rotation.x) * Math.min(1, dt * 10);
    glass.update(dt, camera, {
      rain: w.rain,
      fog: Math.min(1, w.rain * 0.6 + (w.condition === 'fog' ? 0.5 : 0)),
      storm: w.condition === 'storm',
      day: L.day,
    });
    room.update(dt);
    controls.update();
    renderer.render(scene, camera);

    statusTimer += dt;
    if (statusTimer > 0.25) {
      panel.refresh(awake);
      statusTimer = 0;
    }
  });

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left = -VIEW_HEIGHT * a;
    camera.right = VIEW_HEIGHT * a;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

main().catch((err) => {
  console.error(err);
  const title = document.querySelector('.loading-title');
  if (title) title.textContent = `Could not load the room: ${err instanceof Error ? err.message : err}`;
});
