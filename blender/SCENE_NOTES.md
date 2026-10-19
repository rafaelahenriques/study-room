# Study Room: Blender → Three.js handoff

## Files
| File | What it is |
|---|---|
| `blender/isometricroom.blend` | Your original scene (never modified by the scripts) |
| `blender/isometricroom_enriched.blend` | Generated scene with collections, materials, new props and animations |
| `blender/build_enriched_room.py` | Rebuilds the enriched file from the original |
| `blender/export_glb.py` | Writes `web/public/models/study_room.glb` |
| `blender/render_preview.py` | EEVEE look-dev renders into `blender/previews/` |

Run from the `blender/` folder:
```
Blender -b isometricroom.blend --factory-startup -P build_enriched_room.py
Blender -b isometricroom_enriched.blend -P export_glb.py
```

## Scale and axes
- The `.blend` is authored in **centimetres**. The export scales the `StudyRoom` root node by 0.01, so the GLB is in **metres**. The room is about 2.70 × 2.22 × 2.79 m.
- The GLB is Y-up. The open sides of the room face −X and +Z (Three.js). A good default orbit target is `Anchor_CameraTarget`.
- Size is about 4 MB and 77k triangles, with no compression. Running `gltf-transform meshopt` or Draco on it is an easy win if you need it.

## Interactive and independently accessible nodes
Nodes with `userData.interactive` (glTF extras):
`Lamp` (lamp), `Lamp_Switch` (lamp_switch), `Monitor_Screen` (monitor), `Window_Glass` (window), `Headphones`, `CameraProp` (camera), `Clock_Body` (clock), `Mug`, `Calendar_Stand` (calendar), `DeskPlant` / `FloorPlant` (plant), `Chair`, `Drawer_1`–`Drawer_3` (drawer), `Easel` / `Easel_Painting` (easel).

| Feature | Nodes | Notes |
|---|---|---|
| Rain on glass | `Window_Glass` | One quad with 0–1 UVs, v pointing up. Replace `M_WindowGlass` with the TSL rain material. |
| Sky behind the window | `Window_Backdrop` | Emissive quad with 0–1 UVs, 12 cm outside the wall. Drive its colour/texture by time of day, or hide it if the glass shader samples its own background. |
| Monitor wake | `Monitor_Screen` | Separate quad with 0–1 UVs (u to the right as seen by the viewer). `M_Screen` is emissive; animate `emissiveIntensity` or swap in a canvas/video texture. |
| Desk lamp | `Lamp` → `Lamp_Base` → `Lamp_ArmLower` → `Lamp_ArmUpper` → `Lamp_Head` → `Lamp_Bulb` | `M_LampBulb` is emissive. Put a SpotLight at `Anchor_LampLight` aimed at `Anchor_LampTarget`. Both are children of `Lamp_Head`, so they follow the animation. |
| Night ambience | `StringLights_Bulbs` | One mesh using `M_StringLightBulb` (emissive). The bulbs hang on hooks about 5 cm off the wall. Fade them in at night. |
| Clock | `Clock_HandHour`, `Clock_HandMinute` | Set `rotation.z` to the clockwise angle in radians (0 = 12 o'clock). The default is 10:10. |
| Mug steam | `Anchor_MugSteam` | Rim centre, for a particle or sprite effect. |
| Screen glow | `Anchor_ScreenLight` | In front of the screen centre, for a RectAreaLight or PointLight. |
| Drawers | `Dresser` → `Drawer_1` (top) … `Drawer_3` | Each drawer is its own node with a real drawer box inside. The drawers slide toward the room. |
| Easel painting | `Easel_Painting` | Its first face is a 0–1 UV quad using `M_CanvasArt`, so you can put a texture on it (artwork, a painting in progress). The colour blocks in front of it are part of the same mesh. |
| Window daylight | `Anchor_WindowLight` → `Anchor_WindowTarget` | Default sun/sky direction through the window. `Anchor_RainGlass` sits on the glass. |

Anchors are empties. Read their world positions and use target anchors for direction, so no axis convention is involved.

## Animation clips (`gltf.animations`)
| Clip | Length | Use |
|---|---|---|
| `Lamp_Wake` | 1.25 s | Play once on motion. Frame 1 is asleep (head bowed) and the end is awake. Play it with `timeScale = -1` to dim the room after inactivity. |
| `Sound_Bump` | 1.0 s | One-shot for loud sounds: the headphones swing on the stand and the pencils rattle. Scale `weight`/`timeScale` by sound intensity. |
| `Plant_Sway` | 4 s loop | Idle life for the desk flowers and the floor plant. |
| `Curtain_Sway` | 6 s loop | A gentle breeze. Best kept for clear or windy weather. |
| `Chair_Swivel` | 8 s loop | A subtle idle swivel. Optional. |
| `Drawer_1_Open`, `Drawer_2_Open`, `Drawer_3_Open` | 0.55 s | Play once to open on click. Play with `timeScale = -1` to close. |

The GLB's rest pose is the inactive room (lamp asleep, drawers closed). No two clips animate the same node, so they can all play at once.

## Materials
All materials are plain Principled/PBR with flat colours (warm cozy palette), named `M_*`. They're easy to find with `scene.traverse` and override:
`M_WindowGlass` (alpha blend), `M_WindowSky`, `M_Screen`, `M_LampBulb`, `M_StringLightBulb` are the ones the website drives.
Every mesh has a UV map: 0–1 on the glass, screen and backdrop, and box-projected elsewhere for future textures or bakes.

## Changes to your original objects
- Renamed everything (for example `computer` → `Monitor_Body`, key rows → `Keyboard_Keys_NN`), sorted into collections, and parented under `StudyRoom`.
- **Headphones:** rebuilt at realistic proportions on your stand: sage cups, cream cushions, metal yokes and a padded band. Your original WIP cups were too small to carry a believable headband; they're kept as `Archive_Headphones_*` in `_Archive`.
- **Window:** cut into the −Y wall with a boolean (applied).
- **Floor:** split out of `room` into `Room_Floor` (now a dark base), with `Room_FloorPlanks` on top: 21 rows of individually modelled, bevelled oak planks in three tones. The plank tops sit 0.4 cm above the old floor level.
- **The +X wall isn't square:** it's rotated about 2.1° (x ≈ 124.3 + 0.036·y cm). Everything mounted on it (pinboard, string lights, shelf books, dresser) follows that line.
- **Desk plant:** the pot was sunk about 2.3 cm into the desk, so the whole plant now sits on the desk top.
- **Subdivision:** viewport levels lowered on `Mug` (3 → 1) and `DeskPlant_Pot` (4 → 2) to keep the GLB light. Render levels are unchanged.
- **Removed:** the 20 empty actions (they had no keyframes).
- **Moved, not deleted:** your `camera` dome is now `Archive_CameraDome` in the excluded `_Archive` collection, replaced on the riser by `CameraProp`.
- **Still in the file:** `Keyboard_Key_Stray` (was `Plane.022`) sits hidden inside the desk under the keyboard. It looks like a leftover, so you may want to delete it.
- **Added later:** a chest of drawers beside the desk (vase of dried pampas and books on top), an easel with a painting by the window, an art stool with a palette and brushes, a striped blanket over the pouf, and slippers on the rug. The pouf is now bigger and rounder (radius 27 cm, height 24 cm, 9 cm rounded edge), and the blanket is sized to drape over it.
- **Preview only:** `_Preview` holds look-dev lights and the iso camera. It is not exported.
