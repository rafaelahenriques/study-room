# Next steps: building the interactive study room website

The Blender side is done. `web/public/models/study_room.glb` has the geometry, materials, UVs, animations, interactive tags and light anchors. `blender/SCENE_NOTES.md` is the reference for every node name you'll use below.

> **Already set up in `web/`:** steps 1–6 exist as a working starter, and step 8's web client and firmware (`firmware/studyroom_sensor/`) are written. Run it with `cd web && npm install && npm run dev`. The code snippets below explain how each part works. **What's left:** the real rain shader (step 7), connecting your broker and hardware (steps 8–9), and polish (step 10).

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
  scene/rain.ts      TSL rain-on-glass material
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

## 7. The rain-on-glass shader in TSL (3–5 days, the main technical piece)

**Source:** "Heartfelt" by Martijn Steinrucken (BigWings) on Shadertoy is the classic one. **Check the licence on its page.** Shadertoy shaders default to *CC BY-NC-SA 3.0*: credit the author on the site, no commercial use, and share-alike for your port. If the site might ever be commercial, ask the author or write your own drop function.

**Porting approach:**
1. Get the GLSL running unchanged first, on a plane with `ShaderMaterial` (WebGL), so you have a visual reference.
2. Port it function by function to TSL with `Fn(() => { ... })`. The mappings: `fract`, `smoothstep`, `mix`, `sin` → same names in TSL; `iTime` → `time`; `fragCoord/iResolution` → `uv()`; `texture(iChannel0, uv, lod)` → `texture(tex, uv).level(lod)`; `vec2(...)` → `vec2(...)`.
3. Use the glass's own 0–1 UVs. They're already set up on `Window_Glass`, with v pointing up so the drops fall the right way.

```ts
import * as THREE from 'three/webgpu';
import { Fn, uv, time, uniform, texture, vec2, vec3, mix } from 'three/tsl';

export const rainAmount = uniform(0);          // fed from state.rain (eased)
export function makeGlassMaterial(sky: THREE.Texture) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true });
  m.colorNode = Fn(() => {
    const st = uv();
    const drops = rainLayers(st, time, rainAmount);   // your port: returns vec3(offset.xy, focus)
    const blur = mix(6.0, 0.0, drops.z);               // blurry glass, sharp inside drops
    return texture(sky, st.add(drops.xy)).level(blur).rgb;
  })();
  m.opacityNode = mix(0.15, 0.85, rainAmount);
  return m;
}
const glass = room.getObjectByName('Window_Glass') as THREE.Mesh;
glass.material = makeGlassMaterial(skyTexture);
```

**The view behind the drops:** the shader needs something to distort. Pick one:
- **Option A (easiest):** use a photo or painted texture of the view outside, swap it by day and night, and hide `Window_Backdrop`.
- **Option B:** each frame, render `Window_Backdrop` plus a sky gradient to a small `RenderTarget`, and sample that.

**Keep it light:** limit the drop layers to 2–3 on mobile, and set `rainAmount = 0` to skip the expensive work when it's dry.

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
| 3 | Step 7: rain on glass |
| 4 | Steps 8–9: ESP32 motion (+ sound), sensor status in the UI |
| 5 | Step 10: optimise, test on phones, deploy |

When you change the room in Blender, re-run the two scripts (see `blender/SCENE_NOTES.md`). The export writes straight into `web/public/models/`. Node names stay the same, so the website code keeps working.
