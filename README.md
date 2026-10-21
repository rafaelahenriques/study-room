# Study Room

An interactive isometric study room for the web, built with Three.js and WebGPU. Rain runs down the window, and holding and dragging on the glass changes the rain shader itself. The room follows the time and weather of a city, and reacts to an optional ESP32 motion and sound sensor. A control panel does everything without hardware.

- **Live site:** https://studywebgl.netlify.app/ (needs WebGPU: recent Chrome or Edge, Safari 26+, or Firefox 141+ on Windows)
- **Source:** https://github.com/rafaelahenriques/study-room

![Room, awake](blender/previews/room_awake.png)

## Assignment checklist

| Requirement | Where |
|---|---|
| A Shadertoy fragment shader ported to WebGPU | Heartfelt, GLSL → WGSL: [`web/src/shaders/heartfelt/fragment.wgsl`](web/src/shaders/heartfelt/fragment.wgsl) |
| Integrated in Three.js with `WebGPURenderer` | [`web/src/main.ts`](web/src/main.ts) (renderer, `setAnimationLoop`), [`web/src/scene/rain.ts`](web/src/scene/rain.ts) (`wgslFn`, `uniform()`, node material) |
| User interaction changes the shader | Hold and drag on the window: the pointer becomes Shadertoy's `iMouse` (rain amount and drop time) |
| Original shader URL in this README | See [Original shaders](#original-shaders) |
| Online | https://studywebgl.netlify.app/ (Netlify builds every push to `main`) |
| **Extra:** interaction beyond looking around | Window drag, calendar, globe, easel doodles, lamp, drawers, chair, music, physics, control panel |
| **Extra:** physics | Rapier: paper balls into the bin, books knocked off the shelves |
| **Extra:** multiple shaders | A second port, snow (Shadertoy Mdt3Df), plus TSL node materials for the outside view and the twinkling lights |
| **Extra:** additional libraries | Rapier (WebAssembly physics), MQTT.js (sensor) |
| **Extra:** own Blender model, with baking | The whole room is modelled in Blender. Ambient occlusion is baked with Cycles into `web/public/textures/room_ao.jpg` |
| **Extra:** Blender animations controlled from code | 10 clips via `AnimationMixer`: lamp wake, drawers, chair, curtains, plants, sound bump, calendar flip, globe spin |

## Original shaders

Two Shadertoy shaders are ported from GLSL to **WGSL**, the way it's done in class: each port is a plain WGSL function in a `.wgsl` file, imported with `?raw`, turned into a node with `wgslFn()` and used as a `MeshBasicNodeMaterial`'s `colorNode`. The Shadertoy inputs (`fragCoord`, `iTime`, `iMouse`, `iResolution`, `iChannel0` + `iChannel0Sampler`) are passed in as TSL `uniform()` nodes.

### Rain on the window

- **Heartfelt** by Martijn Steinrucken (BigWings), 2017 — **https://www.shadertoy.com/view/ltffzl**
- License: [Creative Commons Attribution-NonCommercial-ShareAlike 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The WGSL port in [`web/src/shaders/heartfelt/fragment.wgsl`](web/src/shaders/heartfelt/fragment.wgsl) is shared under the same license. It's hooked up in [`web/src/scene/rain.ts`](web/src/scene/rain.ts).

**What the port keeps:** the hash functions, the drop layers, the static drops, the trails cut through the fog, the three-tap normals, the focus-based blur, the colour shift and the lightning flicker.

**What changed:**
- **Where it runs:** on the window glass instead of full screen.
- **What it refracts:** `iChannel0` is the real scene behind the glass (`viewportMipTexture`), sampled with `textureSampleLevel` for the blur, instead of a fixed texture.
- **Rain amount:** follows the live weather.
- **Lightning:** also flashes the room lights.
- **Interaction:** `iMouse`, exactly like on Shadertoy. Hold and drag on the window: `iMouse.z > 0` while pressed, up and down (`M.y`) sets the amount of rain, and left and right (`M.x`) scrubs the drops through time.
- **Not ported:** the original's heart "story" mode, which isn't used.

### Snow outside the window

- **Snow** — **https://www.shadertoy.com/view/Mdt3Df**
- License: Shadertoy's default, [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The WGSL port in [`web/src/shaders/snow/fragment.wgsl`](web/src/shaders/snow/fragment.wgsl) is shared under the same license. It's hooked up in [`web/src/scene/outside.ts`](web/src/scene/outside.ts).

**What the port keeps:** the 6 × 12 nested loops, the per-layer cell sizes, the fall speed and sideways sway, the hashed flake positions and wobble, the 8 % cell occupancy, and the flake falloff.

**What changed:**
- **Where it runs:** drawn on the view outside the window, over the procedural sky. The rain glass then refracts it.
- **Dropped:** the original's own blue gradient and grain.
- **Loop start:** the inner loop starts at `i = 1`, because the original's `i = 0` divides by zero and never draws a flake.
- **Intensity:** `amount` (0–1) scales the share of cells that hold a flake, from 2 % to the original's 8 %, so light snow has fewer flakes, not just fainter ones.
- **Weather:** it only runs when the weather is snowy. Then the hills and roofs turn white, and the glass gets a light fog.

## Interaction

| Click / control | What happens |
|---|---|
| **Window** (hold and drag) | Heartfelt's `iMouse`: up and down = amount of rain while you hold, left and right = drop time (stays where you leave it). On release the rain goes back to the weather, as on Shadertoy. |
| **Not sure what's clickable?** | Hover for a label and a glow, or press *What can I click?* (bottom left) to show every hotspot. They also appear for a few seconds after loading. |
| **Lamp** | Turns the room's lamp off when it's on (and on when it's off). It stays on while music plays or the sensor sees motion. |
| **Calendar** (on the dresser) | Shows today's date in the room's city, like the room clock (so Honolulu can still be on yesterday). Next day: the page flips over the top and the room dims towards night and back. A date preview only; it never changes the weather or the time. Panel → Room → *Reset date* returns to today. |
| **Globe** (shelf 3) | One full spin (2 s). Clicks during a spin are ignored. |
| **Easel** | Doodle mode: the camera flies to face the canvas, and you draw with the room's colours (3 brush sizes, eraser, undo, clear). *Done* or Esc steps back. The drawing stays on the easel in your browser (localStorage) and *Save image* downloads a PNG. Other visitors don't see it. |
| **Chair** | Spins once on its swivel. |
| **Notepad** on the monitor riser | Crumples a paper ball and throws it at the bin across the room (physics). Each basket shows "Score!". |
| **Shelf or book** | Knocks that shelf's books off (physics). Panel → Room → *Tidy books* puts them back. A very loud sound (or *Loud bang*) knocks them over too. |
| **Monitor, headphones, drawers** | Switch the screen app, play lo-fi music (Audius; the headphones sway with it), open or close a drawer. |
| Panel → **Weather** | Search a city (with suggestions) or use your location. By default the weather and the room clock follow the city named in your browser's time-zone setting. |

## Inputs

Every input writes into `state` ([`roomState.ts`](web/src/state/roomState.ts)); the scene only reads it. Each property has its own sources:

| Property | Live source | Manual | Back to live |
|---|---|---|---|
| Time of day | the location's clock (Open-Meteo UTC offset), else this device's clock | *Pick a time* + hour slider | *Live* or *Back to live* |
| Weather | Open-Meteo, every 15 min (rain amount from precipitation, snow amount from snowfall). If it fails, the room shows clear skies and the panel says so | a condition chip; one slider sets the rain amount (rain, storm) or the snow amount (snow) | same |
| Sound level | ESP32 microphone over MQTT. 0 when no sensor is connected. Above 60 % the headphones wiggle (at most every 1.5 s); above 85 % the books fall (at most every 8 s) | no manual level: *Small noise* and *Loud bang* send one short spike each, like the sensor would | — |
| Room awake | any of: motion in the last 60 s (sensor, *simulate motion*, clicking the monitor, starting music), sensor reporting motion, music playing, *Keep the room awake* / lamp | — | *back to live* clears *Keep the room awake* |

**Stale sensor data:** without any MQTT message for 30 s, the sensor counts as offline: motion and sound fall back to inactive and 0. Without `VITE_MQTT_URL` the sensor code doesn't load at all.

The panel's header shows what the room is using right now (city · time · weather), so it can stay collapsed. *Back to live* only appears while something is overridden.

**Physics** uses [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`), loaded in the background after the room appears:
- **Static scene:** triangle meshes of the room and furniture, built from the GLB.
- **Books:** each book is a convex-hull body. It stays fixed until it's knocked over, then becomes dynamic.
- **Paper balls:** spheres with continuous collision detection, so fast balls don't pass through the bin wall.
- **Stepping:** a fixed 1/60 s step, only while a book is moving or a paper ball is in the room (at most 10 balls).

## Project structure

```
webgl/
├── blender/
│   ├── isometricroom.blend          the original scene, untouched
│   ├── isometricroom_enriched.blend the finished room: props, materials, UVs, animations
│   ├── previews/                    look-dev renders used in this README
│   └── SCENE_NOTES.md               every node, clip and material the website uses, and how to re-export
├── web/                             the website (Vite + TypeScript + Three.js WebGPURenderer)
│   ├── public/models/study_room.glb the exported room
│   ├── public/textures/room_ao.jpg  the baked ambient occlusion
│   └── src/
│       ├── main.ts                  renderer, camera, the one render loop, click handling
│       ├── config.ts                location, sensor and music settings, thresholds
│       ├── state/roomState.ts       the shared state every input writes and the scene reads
│       ├── shaders/                 the two WGSL ports (heartfelt/, snow/)
│       ├── scene/                   room (GLB + clips), lighting, rain, outside view, screen, calendar,
│       │                            easel, physics, ambient details, baked AO, picking
│       ├── inputs/                  weather + city (Open-Meteo), music (Audius), sensors (MQTT)
│       └── ui/                      control panel, clickable hints, loading screen, toasts
└── firmware/                        optional ESP32 sensor (see firmware/README.md)
```

## Run it locally

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. The shaders are WGSL, so the site needs WebGPU: browsers without it, or where three.js would fall back to WebGL2, get a message instead of a broken room.

- **Build:** `npm run build` typechecks and writes `web/dist/`.
- **Settings (optional):** copy `web/.env.example` to `web/.env.local`. Without it the site uses a default city and the control panel.
- **Debugging:** in dev mode, `window.__room` exposes the state, scene modules and renderer in the browser console.

## Deploy

[`netlify.toml`](netlify.toml) builds `web/` with `npm run build` and publishes `web/dist`. The Netlify site is linked to this repository, so every push to `main` redeploys https://studywebgl.netlify.app/.

## Submitting the source

`node_modules` and `dist` are git-ignored. To make a zip of exactly what's in the repository:

```bash
git archive --format=zip -o study-room-source.zip HEAD
```

## The 3D model and the bake

The room is modelled in centimetres in `blender/isometricroom_enriched.blend` and exported as one GLB in metres. Moving parts are separate objects with stable names, and clickable objects carry an `interactive` custom property that the website reads. [`blender/SCENE_NOTES.md`](blender/SCENE_NOTES.md) lists every node and clip, and the export and bake settings in case the room changes.

**Why only ambient occlusion is baked:** the course bakes all the lighting into one texture on an unlit material. That would fix the room at one time of day, so here only the occlusion (the soft contact shadows) is baked. The sun, sky and lamps stay real-time, because they follow the time, the weather and the motion sensor. The atlas is a 2048² image on a second UV map of the 10 static surfaces; Three.js uses it as an `aoMap` on UV channel 1.

## Sensor (optional)

An ESP32 with a PIR motion sensor and an optional microphone publishes over MQTT. Wiring, broker and setup: [`firmware/README.md`](firmware/README.md). It's written but not yet tested with real hardware.

## Privacy

- **Location:** by default only the city name from the browser's time zone goes to Open-Meteo, with no permission prompt. *Use my location* asks first, then sends the coordinates only to Open-Meteo.
- **Sound:** the sensor sends a loudness level, never audio.
- **Doodles:** stay in the visitor's own browser (localStorage).
- **No secrets in the repository:** Open-Meteo and Audius need no API key. The optional broker settings come from environment variables and must use a subscribe-only user, because the browser can read them.

## Credits

- **Rain:** Heartfelt by Martijn Steinrucken (BigWings), https://www.shadertoy.com/view/ltffzl, CC BY-NC-SA 3.0.
- **Snow:** Shadertoy Mdt3Df, https://www.shadertoy.com/view/Mdt3Df, CC BY-NC-SA 3.0 (Shadertoy's default licence).
- Both WGSL ports are shared under the same licence.
- Weather: [Open-Meteo](https://open-meteo.com/). Music: [Audius](https://audius.co). Physics: [Rapier](https://rapier.rs). Rendering: [three.js](https://threejs.org).

Rafaela Henriques · Creative Development, Howest · 2026
