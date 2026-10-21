# Study Room

An interactive isometric study room for the web. It reacts to live weather, a motion sensor and (optionally) sound, and has a manual control panel that works without any hardware.

**Live site:** https://studywebgl.netlify.app/ (needs a WebGPU browser: recent Chrome or Edge, Safari 26+, Firefox 141+ on Windows)

![Room, awake](blender/previews/room_awake.png)

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

## Layout

```
webgl/
├── blender/                      3D source + pipeline
│   ├── isometricroom.blend          your original scene, untouched
│   ├── isometricroom_enriched.blend the working scene: props, materials, animations, anchors (edit this one)
│   ├── bake_ao.py                   bakes ambient occlusion → web/public/textures/room_ao.jpg
│   ├── export_glb.py                enriched → web/public/models/study_room.glb
│   ├── previews/                    look-dev renders used in this README
│   └── SCENE_NOTES.md               every node, anchor, clip and material the website uses
├── web/                          the website (Vite + TypeScript + Three.js WebGPURenderer)
│   ├── public/models/study_room.glb
│   └── src/
│       ├── main.ts                  renderer, camera, loop, click handling
│       ├── config.ts                location, MQTT, timings
│       ├── state/roomState.ts       single RoomState: each input is live or manual (see Inputs)
│       ├── scene/room.ts            GLB loading, node/material lookup, animation clips
│       ├── scene/lighting.ts        sun, sky, lamp, screen, string lights from state
│       ├── shaders/heartfelt/fragment.wgsl  WGSL port of Heartfelt (rain on the glass)
│       ├── shaders/snow/fragment.wgsl       WGSL port of Mdt3Df (snow outside)
│       ├── scene/rain.ts            hooks Heartfelt to the window glass (wgslFn, uniforms, drag = iMouse)
│       ├── scene/outside.ts         procedural view outside the window (+ rain streaks)
│       ├── scene/ambient.ts         mug steam, sunbeam dust, twinkling string lights
│       ├── scene/bakedAO.ts         applies the AO baked in Blender (aoMap on uv1)
│       ├── scene/physics.ts         Rapier physics: paper toss into the bin, falling books
│       ├── scene/screen.ts          monitor desktop: code editor, weather, now-playing bar, screensaver
│       ├── scene/interact.ts        hover + click via Blender's `interactive` tags
│       ├── inputs/weather.ts        Open-Meteo weather + the visitor's city (time zone / search / device)
│       ├── inputs/sensors.ts        MQTT (ESP32) – only active when configured
│       ├── inputs/music.ts          lo-fi music from the Audius API (headphones)
│       └── ui/                      panel.ts (room controls), hints.ts (what's clickable), loading.ts, toast.ts
├── firmware/studyroom_sensor/    ESP32 sketch: PIR motion (+ optional mic) → MQTT
└── NEXT_STEPS.md                 the build guide: what's left and how to do it
```

## Run the website

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. The site needs **WebGPU**: recent Chrome or Edge, Safari 26+, or Firefox 141+ on Windows. The shaders are WGSL, so there's no WebGL fallback: browsers without WebGPU, or where three.js would fall back to WebGL2, get a message instead.

- **Configuration (optional):** copy `web/.env.example` to `web/.env.local` and set the weather location and the MQTT broker. Without it, the site uses Lisbon's weather and the manual panel.
- **Production build:** `npm run build` writes `web/dist/`. Upload that folder to any static host (Vercel, Netlify, GitHub Pages).
- **Debugging:** in dev mode, `window.__room` exposes `state`, `room`, `lighting`, `camera` and `controls` in the browser console.

## Update the 3D model

Edit `blender/isometricroom_enriched.blend` in Blender and save it. Then, after changing the room, re-bake the ambient occlusion and export:

```bash
cd blender
/Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P bake_ao.py
/Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P export_glb.py
```

New objects must be inside a collection under `StudyRoom` to be exported.

The bake takes about a minute on the GPU. The export writes straight into `web/public/models/`. If the dev server is running, just reload the page. Node names stay stable, so the website code keeps working.

## Interaction

| Click / control | What happens |
|---|---|
| **Notepad** on the monitor riser | Crumples a paper ball and throws it at the bin across the room (physics). Each basket shows "Score!". |
| **Shelf or book** | Knocks that shelf's books off (physics). Panel → Physics → *tidy the books* puts them back. A very loud sound from the sound sensor knocks them over too. |
| **Chair** | Spins once on its swivel. |
| **Calendar** (on the dresser) | Next day: the page flips over the top and the room dims towards night and back. A date preview only; it never changes the weather or the time. Panel → Room → *Reset date* returns to today. |
| **Globe** (shelf 3) | One full spin (2 s). Clicks during a spin are ignored. |
| **Not sure what's clickable?** | Hover for a label and a glow, or press *What can I click?* (bottom left) to show every hotspot. They also appear for a few seconds after loading. |
| **Window** (hold and drag) | Heartfelt's `iMouse`: up and down = amount of rain while you hold, left and right = drop time (stays where you leave it). On release the rain goes back to the weather, as on Shadertoy. |
| **Lamp, monitor, headphones, drawers** | Lamp on or off, switch screen app, lo-fi music (Audius), open or close the drawers. |
| Panel → **Location** | Search a city, or *use my location*. By default the weather and room clock follow the city of your browser's time zone. |

## Inputs

Every input writes into `state` ([`roomState.ts`](web/src/state/roomState.ts)); the scene only reads it. Each property has its own sources:

| Property | Live source | Manual | Back to live |
|---|---|---|---|
| Time of day | the location's clock (Open-Meteo UTC offset), else this device's clock | *Pick a time* + hour slider | *Live* or *Back to live* |
| Weather | Open-Meteo, every 15 min (rain amount from precipitation, snow amount from snowfall). If it fails, the room shows clear skies and the panel says so | a condition chip; one slider sets the rain amount (rain, storm) or the snow amount (snow) | same |
| Sound level | ESP32 microphone over MQTT. 0 when no sensor is connected | *Set by hand* + level slider | same |
| Room awake | any of: motion in the last 60 s (sensor, *simulate motion*, clicking the monitor, starting music), sensor reporting motion, music playing, *keep room awake* / lamp | — | *back to live* clears *keep room awake* |

**Stale sensor data:** without any MQTT message for 30 s, the sensor counts as offline: motion and sound fall back to inactive and 0. Without `VITE_MQTT_URL` the sensor code doesn't load at all.

The panel's header shows what the room is using right now (city · time · weather), so it can stay collapsed. *Back to live* only appears while something is overridden.

**Physics** uses [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`), loaded in the background after the room appears:
- **Static scene:** triangle meshes of the room and furniture, built from the GLB.
- **Books:** each book is a convex-hull body. It stays fixed until it's knocked over, then becomes dynamic.
- **Paper balls:** spheres with continuous collision detection (CCD), so the fast balls don't pass through the bin wall.
- **Stepping:** a fixed 1/60 s step, and only while a book is moving or a paper ball is in the room (at most 10 balls).

**Location privacy:**
- **By default,** only the time-zone city name goes to the Open-Meteo geocoding API, with no permission prompt.
- **"Use my location"** asks the browser for permission first, then sends the coordinates only to Open-Meteo, to get the weather.

## Baking

Ambient occlusion (the soft contact shadows under furniture, in the corners and behind the shelves) is baked in Blender with Cycles, by [`blender/bake_ao.py`](blender/bake_ao.py), into one 2048² atlas: `web/public/textures/room_ao.jpg`.

- **UV map:** each baked object (13 static meshes: floor, walls, rug, desk top, dresser, riser, shelves, sill) gets a second UV map, `AO_UV`, laid out by hand. The floor, walls, rug and furniture tops are each projected flat into their own region of the atlas. It's exported as glTF `TEXCOORD_1`, which Three.js reads as `uv1`.
- **In Three.js** ([`web/src/scene/bakedAO.ts`](web/src/scene/bakedAO.ts)): the atlas becomes the `aoMap` on UV channel 1, with `flipY = false`, the same as the course's `baked.jpg`.
- **Why only AO:** the course bakes *all* the lighting into one texture shown with an unlit `MeshBasicMaterial`. Here only the occlusion is baked, because the lighting has to stay real-time: it changes with the time of day, the weather, the motion sensor and the desk lamp.
- **What's baked:** only objects that never move. Baked shadows would be wrong on the lamp, drawers, chair, curtains or headphones once they animate.

## Deploy (Netlify)

[`netlify.toml`](netlify.toml) is already set up: it builds from `web/` with `npm run build` and publishes `web/dist`.

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → GitHub, and pick `study-room`.
2. Netlify reads the settings from `netlify.toml`, so just click **Deploy**.
3. Optional: under *Site configuration → Environment variables*, add the `VITE_*` values from `web/.env.example`, then redeploy.

From then on, every push to `main` redeploys the site automatically.

## Sensors

Flash `firmware/studyroom_sensor/studyroom_sensor.ino` to an ESP32. Before you do, copy `secrets.example.h` to `secrets.h` and fill it in. Steps 8–9 of `NEXT_STEPS.md` cover the wiring and setting up the MQTT broker.

## Status

| Piece | State |
|---|---|
| 3D room, materials, animations, anchors | done |
| Scene, camera, lighting by time/weather, motion wake/sleep, clickable objects, manual panel | working starter |
| Live weather (Open-Meteo) | working |
| Rain on glass | done (WGSL port of Heartfelt via wgslFn, refracts what is rendered behind the glass, drag = iMouse) |
| Snow outside | done (WGSL port of Mdt3Df via wgslFn, shown when it snows) |
| Baked ambient occlusion | done (Cycles bake, aoMap on uv1) |
| Physics | done (Rapier: paper toss into the bin, books knocked off the shelves) |
| Visitor's city | done (weather + room clock follow the visitor's city) |
| Ambient animation | done (mug steam, sunbeam dust, twinkling lights, rain streaks outside) |
| Monitor screen | done (live canvas desktop: code + weather) |
| Headphones music | done (Audius trending Lo-Fi, now-playing pill with credit) |
| ESP32 motion + sound | firmware + web client written, not yet tested with hardware |
