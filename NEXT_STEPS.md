# Next steps: building the interactive study room website

The Blender side is done. `web/public/models/study_room.glb` has the geometry, materials, UVs, animations, interactive tags and light anchors. `blender/SCENE_NOTES.md` is the reference for every node name you'll use below.

> **Already set up in `web/`:** steps 1–6 exist as a working starter, and step 8's web client and firmware (`firmware/studyroom_sensor/`) are written. Run it with `cd web && npm install && npm run dev`. The code snippets below explain how each part works. **What's left:** connecting your broker and hardware (steps 8–9), and polish (step 10). The rain shader (step 7) is done.

This guide covers the website itself: Three.js + TypeScript + WebGPURenderer, weather, the ESP32 sensors, the manual control panel and deployment. The order is chosen so you always have something working. **The manual controls come before the sensors**, so the site never depends on hardware being online.

---

## 0. Architecture in one picture

```
 Open-Meteo API ─┐
 ESP32 (PIR/mic) ─┼─▶  RoomState (one object)  ─▶  scene controllers  ─▶  WebGPU render
 Control panel  ─┘     merge + priorities          lights, materials,
                                                    clips, rain shader
```

- **Every input writes to one `RoomState`**, and nothing touches the scene directly.
- **Priority:** manual override > live sensor > weather/time default.
- **Every frame, the scene controllers read the state and ease (lerp) towards it.** Switching from sunny to rain is then a smooth fade, not a jump.

---

## 1. Scaffold the project (½ day)

*(Done: this is what `web/` was created from.)*

```bash
npm create vite@latest study-room -- --template vanilla-ts
cd study-room
npm install three lil-gui mqtt
npm install -D @types/three
```

Make every `import ... from 'three'` (including the ones inside the addons) resolve to the WebGPU build. Without this you get two copies of Three.js and `instanceof` checks break:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
});
```

Suggested layout:

```
src/
  main.ts            renderer, camera, loop
  scene/room.ts      load GLB, find nodes by name, mixer + clip helpers
  scene/lighting.ts  sun / lamp / screen / string lights from RoomState
  shaders/*.wgsl     the Shadertoy ports (WGSL, used with wgslFn)
  scene/rain.ts      rain-on-glass material
  scene/interact.ts  raycast hover + click
  state/roomState.ts the single state object + subscribe()
  inputs/weather.ts  Open-Meteo polling
  inputs/sensors.ts  MQTT subscription (ESP32)
  ui/panel.ts        manual controls
```

## 2. Load the room and the isometric camera (1 day)

```ts
// main.ts (core of it)
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();                       // falls back to WebGL2 when WebGPU is unavailable
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const aspect = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera(-2 * aspect, 2 * aspect, 2, -2, 0.01, 50);
camera.position.set(-4, 3.8, -4);            // looks into the open corner of the room

const gltf = await new GLTFLoader().loadAsync('/models/study_room.glb');
const room = gltf.scene;
scene.add(room);
room.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });

const controls = new OrbitControls(camera, renderer.domElement);
room.getObjectByName('Anchor_CameraTarget')!.getWorldPosition(controls.target);
controls.enablePan = false;
controls.minZoom = 0.8; controls.maxZoom = 2.5;
controls.minPolarAngle = 0.6; controls.maxPolarAngle = 1.25;   // never look under the floor
controls.minAzimuthAngle = -Math.PI * 0.95; controls.maxAzimuthAngle = -Math.PI * 0.55; // stay on the open side

const mixer = new THREE.AnimationMixer(room);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mixer.update(dt);
  // updateLighting(state, dt); updateRain(state, dt); ...
  controls.update();
  renderer.render(scene, camera);
});
```

Tune the azimuth limits by eye: the walls must always stay between the camera and the outside, or you'll see the backs of the walls and the window backdrop.

Clip helper (works for `Lamp_Wake`, `Drawer_N_Open`, `Sound_Bump`):

```ts
export function playOnce(name: string, forward = true) {
  const clip = THREE.AnimationClip.findByName(gltf.animations, name);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.timeScale = forward ? 1 : -1;  // -1 = play backwards (close drawer, lamp back to sleep)
  action.paused = false;
  action.play();
}
// idle loops
['Plant_Sway', 'Chair_Swivel'].forEach((n) =>
  mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, n)).play());
```

## 3. RoomState and the manual control panel (1 day)

```ts
// state/roomState.ts
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
export const state = {
  timeOfDay: 14,          // hours 0–24
  weather: 'clear' as Weather,
  rain: 0,                // 0–1 intensity
  cloud: 0,               // 0–1
  motion: false,
  lastMotion: 0,          // ms timestamp
  sound: 0,               // 0–1 level
  sensorsOnline: false,
  override: { weather: false, time: false, motion: false, sound: false },
};
```

- **Panel:** build it with plain HTML or [lil-gui](https://lil-gui.georgealways.com/). Add a toggle for each override, a time-of-day slider, a weather dropdown, a rain-amount slider, a "simulate motion" button and a sound slider. When a toggle is on, the inputs in steps 6–8 must not overwrite that field.
- **Inactivity rule:** when `motion` is false and `now - lastMotion` is over 60 s, the room is "asleep". Fade the lamp out, play `Lamp_Wake` backwards and dim the screen.

## 4. Lighting driven by state (1–2 days)

| Element | Three.js | Node(s) | Driven by |
|---|---|---|---|
| Sky light | `HemisphereLight` | none | `timeOfDay`, `cloud` (colour and intensity) |
| Sun through window | `DirectionalLight` + shadows | from `Anchor_WindowLight` to `Anchor_WindowTarget` | `timeOfDay` (warm low sun → white noon → off at night), `cloud` (dims it) |
| Desk lamp | `SpotLight` | at `Anchor_LampLight`, aimed at `Anchor_LampTarget` (update every frame, since it moves with `Lamp_Wake`) | `motion` |
| Lamp bulb glow | `M_LampBulb.emissiveIntensity` | `Lamp_Bulb` | `motion` |
| Monitor | `M_Screen.emissiveIntensity`, or a `CanvasTexture` | `Monitor_Screen` | `motion`, and the `sound` visualiser |
| Screen glow | `PointLight` (small, bluish) | `Anchor_ScreenLight` | `motion` |
| String lights | `M_StringLightBulb.emissiveIntensity` | `StringLights_Bulbs` | night (`timeOfDay`) |
| Sky outside | `M_WindowSky.color` / `emissive` | `Window_Backdrop` | `timeOfDay`, `weather` |

Find materials by name once after loading:

```ts
const mats = new Map<string, THREE.MeshStandardMaterial>();
room.traverse((o: any) => o.material && mats.set(o.material.name, o.material));
mats.get('M_LampBulb')!.emissiveIntensity = 0;   // start dark
```

Always ease values (`current += (target - current) * (1 - Math.exp(-dt * 3))`). This makes everything feel calm and "alive" instead of switching abruptly.

## 5. Interactions (1 day)

```ts
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  let o: THREE.Object3D | null = ray.intersectObject(room, true)[0]?.object ?? null;
  while (o && !o.userData.interactive) o = o.parent;   // walk up to the tagged node
  if (!o) return;
  switch (o.userData.interactive) {
    case 'lamp': case 'lamp_switch': state.override.motion = true; state.motion = !state.motion; break;
    case 'drawer': toggleDrawer(o.name); break;          // playOnce(`${o.name}_Open`, open/close)
    case 'headphones': playOnce('Sound_Bump'); break;
    case 'monitor': /* show a project/about panel */ break;
    case 'easel': /* swap the painting texture on M_CanvasArt */ break;
    case 'window': /* open the weather panel */ break;
  }
});
```

For hover, set the pointer cursor and gently brighten the hovered object's emissive. Or, for an outline effect, use the TSL post-processing `outline()` pass.

## 6. Live weather (½ day)

[Open-Meteo](https://open-meteo.com/) is free, needs no API key and allows browser (CORS) requests:

```ts
const url = 'https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.14'
  + '&current=weather_code,cloud_cover,precipitation,is_day&timezone=auto';
const { current } = await (await fetch(url)).json();
```

Map the WMO `weather_code`:

| Codes | State | Visuals |
|---|---|---|
| 0–1 | `clear` | warm, bright sun; no rain |
| 2–3 | `cloudy` | `cloud = cloud_cover/100`, softer, cooler, muted |
| 45, 48 | `fog` | low contrast, grey sky |
| 51–67, 80–82 | `rain` | `rain = min(1, precipitation/4)`, rain shader on, dim sun |
| 71–77, 85–86 | `snow` | cold white sky (optional) |
| 95–99 | `storm` | heavy rain + occasional lightning flash on the hemisphere light |

- **Polling:** check every 10–15 minutes.
- **Night:** use `is_day` together with the local hour to decide when night begins. At night the lamp, screen and string lights carry the scene.

## 7. The rain-on-glass shader ✅ done

`web/src/shaders/heartfelt/fragment.wgsl` is a GLSL → **WGSL** port of **"Heartfelt" by BigWings** (https://www.shadertoy.com/view/ltffzl, CC BY-NC-SA 3.0), following the class method:
- **Rules:** the WGSL cheat sheet.
- **Structure:** the main function first, with the helpers (`S`, `N13`, `N`, `Saw`, `DropLayer2`, `StaticDrops`, `Drops`) below it, because `wgslFn` reads the signature of the first function.
- **Wiring:** `web/src/scene/rain.ts` imports it with `?raw`, wraps it with `wgslFn`, and passes the Shadertoy inputs as `uniform()` nodes.

| Heartfelt (GLSL) | Port (WGSL + Three.js) |
|---|---|
| `void mainImage(out vec4 fragColor, in vec2 fragCoord)` | `fn heartfelt(fragCoord: vec2f, iTime: f32, iMouse: vec4f, iResolution: vec2f, iChannel0: texture_2d<f32>, iChannel0Sampler: sampler, …) -> vec4f` |
| `fragCoord` (pixels, bottom-left origin) | `uv()` of the glass, flipped so y points up, × `iResolution` (glTF puts v = 0 at the top) |
| `textureLod(iChannel0, UV + n, focus)` | `textureSampleLevel(iChannel0, iChannel0Sampler, screenUV + n mapped to the screen, focus)`. `iChannel0` is `viewportMipTexture()`, the scene behind the glass, passed twice as texture and sampler, like the course passes its render target. |
| `iMouse.z > 0 ? M.y : sin(T*.05)*.3+.7` | `select(weatherRain, M.y, iMouse.z > 0.0)`. Dragging on the glass fills `iMouse` exactly like Shadertoy does (`pointerdown` in the capture phase pauses OrbitControls). |
| `#define S(a, b, t) smoothstep(a, b, t)` | `fn S()`, written out, because it's called with reversed edges. WGSL has no preprocessor. |
| `float`, `vec2/3`, `out` | `let`/`var`, `vec2f/3f`, return values (the cheat-sheet rules) |
| lightning (`USE_POST_PROCESSING`) | kept in the WGSL, gated by `storm`. The same formula runs in JS to flash the room lights. |
| `HAS_HEART`, zoom animation, vignette | not used, because they only make sense for a full-screen demo |

**Tuning knobs** (in `createRainGlass` and the WGSL):
- **Fog:** `fog`. In `main.ts` it's `rain × 1.6`, plus `0.5` when foggy and `0.12` when snowing, then × 0.85 as the mip-level scale.
- **Storms:** `iTime` runs 1.4× faster during a storm.
- **Drop size:** `zoom` in the WGSL; 1.0 means the biggest drops.

**Performance:** it ran at 120 fps (the display's limit) on WebGPU at 2× pixel density in a full storm, even with the original's three-tap "expensive normals". On slow devices, switch to the original's `CHEAP_NORMALS` approach, using screen-space derivatives instead of two extra `Drops()` calls.

### Snow and ambient animation ✅ done

- **Snow:** `web/src/shaders/snow/fragment.wgsl` ports Shadertoy **Mdt3Df** from GLSL to WGSL (used with `wgslFn` in `outside.ts`) (https://www.shadertoy.com/view/Mdt3Df). It's composited into the outside view in `outside.ts` whenever `currentWeather().condition === 'snow'`, set by live weather (WMO codes 71–77 and 85–86) or the panel. It turns the hills and roofs white and adds a light fog to the glass. The whole loop is skipped while it isn't snowing.
- **Rain outside:** `outside.ts` also draws thin rain streaks falling outside while it rains.
- **Ambient animation:** `web/src/scene/ambient.ts` adds:
  - steam rising from the mug, which starts at the `Anchor_MugSteam` empty
  - dust motes glinting in the sunbeam, only on sunny days, positioned along `Anchor_RainGlass` → `Anchor_WindowTarget`
  - string lights that twinkle bulb by bulb, using a TSL `emissiveNode` with a per-bulb phase from `positionLocal`

  The particles are instanced quads that face the camera, with additive blending.

### The monitor screen ✅ done

`web/src/scene/screen.ts` draws a small "desktop" on a canvas and uses it as the screen texture, redrawn 15 times a second:
- **Code:** a code editor that types out the rain shader.
- **Weather:** the live conditions.

When the room is awake, the two apps alternate every 22 seconds. Clicking the monitor switches app, and the panel can pin one under **Computer screen**. While music plays, the top bar shows the current track. When the room is asleep, the screen shows a dim screensaver clock.

### Music on the headphones ✅ done

`web/src/inputs/music.ts` streams lo-fi music from the **Audius** public API (https://docs.audius.org). It needs no API key; `app_name` identifies the site.

- **Clicking the headphones** plays or pauses. A pill in the bottom-right shows the artwork, title and artist, links to the track on Audius, and has next/stop buttons. That credit is how artists get attribution, so keep it visible.
- **Tracks** come from the trending **Lo-Fi** chart for the month, shuffled. Unplayable tracks are skipped. To change it, edit `config.music.genre` (for example `'Ambient'`).
- **Loudness:** Audius streams allow cross-origin access, so the audio goes through a WebAudio `AnalyserNode`, and `state.music.level` (0–1) follows the music's loudness. The headphones sway on the stand with it. You can use the same value to make other things pulse, such as the plant or the string lights.
- **Sound sensor:** music doesn't trigger the `Sound_Bump` reaction. Only the sound sensor or the manual sound slider does.
- **Awake:** the room stays awake while music plays.
- **Browser rule:** audio can only start from a click, which is why playback begins on the headphones.

## 8. ESP32 motion sensor (2–3 days, including hardware)

**Hardware:** an ESP32 dev board plus an AM312 or HC-SR501 PIR sensor. Wire VCC to 3.3 V (AM312) or 5 V (HC-SR501), GND to GND, and OUT to GPIO 27.

**Connecting it to a public website:** a visitor's browser can't reach a device on your home Wi-Fi, so use an MQTT broker as the relay. A free HiveMQ Cloud or EMQX Serverless tier works:
- The ESP32 publishes over TLS (port 8883).
- The browser subscribes over secure WebSocket (`wss://…:8884/mqtt`).
- Create **two** broker users: a publish-only one for the ESP32, and a **subscribe-only** one for the website. The website's password is visible to anyone who opens the page's code, so it must not be able to publish.

```cpp
// ESP32 (Arduino): libraries WiFi, WiFiClientSecure, PubSubClient
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
const int PIR = 27;
WiFiClientSecure net; PubSubClient mqtt(net);
bool last = false; unsigned long lastBeat = 0;

void setup() {
  pinMode(PIR, INPUT);
  WiFi.begin("SSID", "PASSWORD");
  while (WiFi.status() != WL_CONNECTED) delay(250);
  net.setInsecure();                       // for testing only; load the broker CA cert for real use
  mqtt.setServer("YOUR-BROKER-HOST", 8883);
}
void loop() {
  if (!mqtt.connected()) mqtt.connect("studyroom-esp32", "esp32-user", "esp32-pass");
  mqtt.loop();
  bool now = digitalRead(PIR);
  if (now != last) { mqtt.publish("studyroom/motion", now ? "1" : "0", true); last = now; }
  if (millis() - lastBeat > 10000) { mqtt.publish("studyroom/heartbeat", "1"); lastBeat = millis(); }
}
```

```ts
// inputs/sensors.ts
import mqtt from 'mqtt';
const client = mqtt.connect('wss://YOUR-BROKER-HOST:8884/mqtt', { username: 'web-readonly', password: '…' });
client.on('connect', () => client.subscribe(['studyroom/motion', 'studyroom/heartbeat', 'studyroom/sound']));
let lastBeat = 0;
client.on('message', (topic, msg) => {
  if (topic.endsWith('heartbeat')) lastBeat = Date.now();
  if (topic.endsWith('motion') && !state.override.motion) {
    state.motion = msg.toString() === '1';
    if (state.motion) state.lastMotion = Date.now();
  }
  if (topic.endsWith('sound') && !state.override.sound) state.sound = Number(msg) || 0;
});
setInterval(() => (state.sensorsOnline = Date.now() - lastBeat < 30000), 5000);
```

Show `sensorsOnline` in the panel, for example "Sensor: live" versus "Sensor: offline, using manual controls". This tells visitors why the room is or isn't reacting.

## 9. Optional: sound sensor (1–2 days)

- **Hardware:** an INMP441 (I2S, best quality) or a MAX9814 (analog, simpler).
- **On the ESP32:** compute RMS loudness over about 50 ms windows, normalise it to 0–1, smooth it, and publish `studyroom/sound` about 5 times a second. **Send only the level, never the audio.** This is a privacy point worth stating on the site.
- **In the scene:**
  - Above a threshold, call `playOnce('Sound_Bump')`, with a cooldown of about 1.5 s.
  - Drive a small equaliser on `Monitor_Screen` with a `CanvasTexture` bar chart.
  - Scale `Plant_Sway`'s `timeScale` slightly with loudness.

## 10. Polish, performance and launch (2–3 days)

- **Compress the model.** The original is about 4 MB; this brings it to roughly 1 MB:
  ```bash
  npx @gltf-transform/cli optimize public/models/study_room.glb public/models/study_room.min.glb --compress meshopt
  ```
  Then add `loader.setMeshoptDecoder(MeshoptDecoder)`, from `three/addons/libs/meshopt_decoder.module.js`.
- **Shadows:** use one shadow-casting light (the sun) with a 1024–2048 shadow map. Leave the lamp's shadows off on mobile.
- **Loading:** show a simple loading screen with progress from `loader.loadAsync(url, onProgress)`.
- **Accessibility:**
  - Make the control panel usable by keyboard.
  - Respect `prefers-reduced-motion` by pausing the idle loops and dropping the rain to a static texture.
  - Add an "About this room" text that explains the sensors.
- **Hosting:** any static host works (Vercel, Netlify, GitHub Pages). It's just `npm run build` and upload `dist/`. The weather API and the MQTT broker are called from the browser, so you don't need your own server.
- **Credits:** put the shader author and licence, and the weather data source ("Weather data by Open-Meteo.com"), in the footer.

---

## Suggested timeline

| Week | Goal |
|---|---|
| 1 | Steps 1–3: room loads, camera feels good, manual panel switches day/night and lamp on/off |
| 2 | Steps 4–6: lighting moods for each weather, clickable objects, live weather |
| 3 | Step 7: rain on glass ✅ |
| 4 | Steps 8–9: ESP32 motion (+ sound), sensor status in the UI |
| 5 | Step 10: optimise, test on phones, deploy |

When you change the room in Blender, re-run the two scripts (see `blender/SCENE_NOTES.md`). The export writes straight into `web/public/models/`. Node names stay the same, so the website code keeps working.
