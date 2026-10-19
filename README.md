# Study Room

An interactive isometric study room for the web. It reacts to live weather, a motion sensor and (optionally) sound, and has a manual control panel that works without any hardware.

![Room, awake](blender/previews/room_awake.png)

## Original shader

The rain on the window is a WebGPU (Three.js TSL) port of a Shadertoy shader:

- **Heartfelt** by Martijn Steinrucken (BigWings), 2017 — **https://www.shadertoy.com/view/ltffzl**
- License: [Creative Commons Attribution-NonCommercial-ShareAlike 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The port in [`web/src/scene/rain.ts`](web/src/scene/rain.ts) is shared under the same license.

**What the port keeps:** the hash functions, the drop layers, the static drops, the trails cut through the fog, the three-tap normals, the focus-based blur, the colour shift and the lightning flicker.

**What changed:**
- **Where it runs:** on the window glass instead of full screen.
- **What it refracts:** the real scene behind the glass (`viewportMipTexture`), instead of a fixed texture.
- **Rain amount:** follows the live weather.
- **Lightning:** also flashes the room lights.
- **Interaction:** like the original's mouse control. Hold and drag on the window: up and down sets the amount of rain, and left and right scrubs the drops through time.
- **Not ported:** the original's heart "story" mode, which isn't used.

## Layout

```
webgl/
├── blender/                      3D source + pipeline
│   ├── isometricroom.blend          original scene (source of truth, never modified by scripts)
│   ├── isometricroom_enriched.blend generated: props, materials, animations, anchors
│   ├── build_enriched_room.py       original → enriched
│   ├── export_glb.py                enriched → web/public/models/study_room.glb
│   ├── render_preview.py            EEVEE look-dev renders → blender/previews/
│   └── SCENE_NOTES.md               every node, anchor, clip and material the website uses
├── web/                          the website (Vite + TypeScript + Three.js WebGPURenderer)
│   ├── public/models/study_room.glb
│   └── src/
│       ├── main.ts                  renderer, camera, loop, click handling
│       ├── config.ts                location, MQTT, timings
│       ├── state/roomState.ts       single RoomState (manual > sensor > live weather)
│       ├── scene/room.ts            GLB loading, node/material lookup, animation clips
│       ├── scene/lighting.ts        sun, sky, lamp, screen, string lights from state
│       ├── scene/rain.ts            TSL rain-on-glass shader (drops, trails, condensation, refraction)
│       ├── scene/outside.ts         procedural view outside the window
│       ├── scene/screen.ts          monitor desktop: code editor, weather, now-playing bar, screensaver
│       ├── scene/interact.ts        hover + click via Blender's `interactive` tags
│       ├── inputs/weather.ts        Open-Meteo polling
│       ├── inputs/sensors.ts        MQTT (ESP32) – only active when configured
│       ├── inputs/music.ts          lo-fi music from the Audius API (headphones)
│       └── ui/panel.ts, ui/toast.ts manual controls + click captions
├── firmware/studyroom_sensor/    ESP32 sketch: PIR motion (+ optional mic) → MQTT
└── NEXT_STEPS.md                 the build guide: what's left and how to do it
```

## Run the website

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. The site picks WebGPU and falls back to WebGL2 automatically.

- **Configuration (optional):** copy `web/.env.example` to `web/.env.local` and set the weather location and the MQTT broker. Without it, the site uses Lisbon's weather and the manual panel.
- **Production build:** `npm run build` writes `web/dist/`. Upload that folder to any static host (Vercel, Netlify, GitHub Pages).
- **Debugging:** in dev mode, `window.__room` exposes `state`, `room`, `lighting`, `camera` and `controls` in the browser console.

## Update the 3D model

```bash
cd blender
/Applications/Blender.app/Contents/MacOS/Blender -b isometricroom.blend --factory-startup -P build_enriched_room.py
/Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P export_glb.py
```

The export writes straight into `web/public/models/`. If the dev server is running, just reload the page. Node names stay stable, so the website code keeps working.

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
| Rain on glass | done (TSL port of Heartfelt, refracts the outside view, drag to control) |
| Monitor screen | done (live canvas desktop: code + weather) |
| Headphones music | done (Audius trending Lo-Fi, now-playing pill with credit) |
| ESP32 motion + sound | firmware + web client written, not yet tested with hardware |
