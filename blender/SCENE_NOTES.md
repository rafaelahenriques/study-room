# Study Room: Blender → Three.js handoff

## Files
| File | What it is |
|---|---|
| `blender/isometricroom.blend` | Your original scene, untouched |
| `blender/isometricroom_enriched.blend` | The working scene with collections, materials, props and animations. Edit this one. |
| `blender/previews/` | Look-dev renders used in the README |

### Exporting again (only if the room changes)
1. Set the `StudyRoom` empty's scale to **0.01** (the scene is modelled in centimetres; the GLB is in metres) and go to frame 1.
2. Make `StudyRoom` the active collection, then *File → Export → glTF 2.0*:
   - Format **glb**. *Include*: **Limit to → Active Collection** (with nested collections), **Custom Properties** on, cameras and lights off.
   - *Transform*: **+Y Up**. *Mesh*: **Apply Modifiers**.
   - *Animation*: mode **NLA Tracks**, **Always Sample Animations** on.
   - Save as `web/public/models/study_room.glb`.
3. Set the scale back to 1 before you save the `.blend`.

**Baking:** the AO atlas (`web/public/textures/room_ao.jpg`, 2048², Cycles *Ambient Occlusion*, distance 35 cm) is baked onto the second UV map `AO_UV` of the 10 static meshes that have it: `Room_FloorPlanks`, `Room_Walls`, `Rug`, `Desk_Top`, `Monitor_Riser`, `Dresser_Body`, `Shelf_1`–`Shelf_3`, `Window_Sill`. Their modifiers are applied (the bake needs final geometry). Re-bake only if those surfaces, or what stands on them, change: select the 10 objects, make `AO_UV` the active UV map on each, add an image node with `room_ao.jpg` to their materials and make it active, bake, then save the image over `web/public/textures/room_ao.jpg`.

## Scale and axes
- The `.blend` is authored in **centimetres**. The export scales the `StudyRoom` root node by 0.01, so the GLB is in **metres**. The room is about 2.70 × 2.22 × 2.79 m.
- The GLB is Y-up. The open sides of the room face −X and +Z (Three.js). A good default orbit target is `Anchor_CameraTarget`.
- Size is about 4.7 MB and 103k triangles (139 meshes, 46 materials, no embedded textures), with no compression.

## Interactive and independently accessible nodes
Nodes with `userData.interactive` (glTF extras):
`Lamp` (lamp), `Lamp_Switch` (lamp_switch), `Monitor_Screen` (monitor), `Window_Glass` (window), `Headphones` (headphones: plays music), `CameraProp` (camera), `Clock_Body` (clock), `Mug`, `Calendar_Root` (calendar), `ShelfBall_Root` (ball), `Notepad` (paper), `PaperBin` (bin), `DeskPlant` / `FloorPlant` (plant), `Chair`, `Drawer_1`–`Drawer_3` (drawer), `Easel` / `Easel_Painting` (easel). The website also tags `Shelf_1`–`Shelf_3` and their books as `shelf`. Tags without a website action (`camera`, `mug`, `plant`) aren't clickable.

| Feature | Nodes | Notes |
|---|---|---|
| Rain on glass | `Window_Glass` | One quad with 0–1 UVs. In Blender v points up; in Three.js (glTF) v = 0 is at the **top**. `web/src/scene/rain.ts` replaces `M_WindowGlass` with the TSL rain material. |
| Sky behind the window | `Window_Backdrop` | Quad with 0–1 UVs, 12 cm outside the wall. `web/src/scene/outside.ts` paints the outside view on it (sky, sun/moon, clouds, hills, rooftops), and the rain shader refracts it. |
| Monitor screen | `Monitor_Screen` | Separate quad with 0–1 UVs (u runs to the viewer's right; in Three.js v = 0 is at the top). `web/src/scene/screen.ts` replaces `M_Screen` with a live canvas texture. |
| Desk lamp | `Lamp` → `Lamp_Base` → `Lamp_ArmLower` → `Lamp_ArmUpper` → `Lamp_Head` → `Lamp_Bulb` | `M_LampBulb` is emissive. Put a SpotLight at `Anchor_LampLight` aimed at `Anchor_LampTarget`. Both are children of `Lamp_Head`, so they follow the animation. |
| Night ambience | `StringLights_Bulbs` | One mesh using `M_StringLightBulb` (emissive). The bulbs hang on hooks about 5 cm off the wall. Fade them in at night. |
| Clock | `Clock_HandHour`, `Clock_HandMinute` | Set `rotation.z` to the clockwise angle in radians (0 = 12 o'clock). The default is 10:10. |
| Mug steam | `Anchor_MugSteam` | Rim centre, for a particle or sprite effect. |
| Screen glow | `Anchor_ScreenLight` | In front of the screen centre, for a RectAreaLight or PointLight. |
| Physics props | `PaperBin` (floor, far side of the room), `Notepad` (monitor riser), `Shelf_1_Book_01` … `Shelf_3_Book_06` (one node per book, origin at its centre) | The website turns the books into Rapier bodies and throws paper from the notepad into the bin. |
| Drawers | `Dresser` → `Drawer_1` (top) … `Drawer_3` | Each drawer is its own node with a real drawer box inside. The drawers slide toward the room. |
| Calendar | `Calendar_Root` (tag `calendar`) → `Calendar_Base` (stand, + `Calendar_Rings`), `Calendar_DateSurface`, `Calendar_PagePivot` → `Calendar_Page` + `Calendar_PageBack` | Sits on the book stack on the dresser. `Calendar_Page` and `Calendar_DateSurface` are 0–1 UV quads (u to the viewer's right; in Three.js v = 0 at the top) using `M_CalendarDate` (single-sided). `web/src/scene/calendar.ts` draws the date on canvases at runtime. The pivot sits on the hinge just above the rings; the rings pass through the page top like a spiral binding. |
| Shelf globe | `ShelfBall_Root` (tag `ball`) → `ShelfBall_Mesh` | Split out of `Shelf_3_Decor`, origin at its centre, spins about its vertical axis. Continents are a vertex-colour attribute (`Col`, exported as `COLOR_0`) on `M_Globe`; no texture. Its oak stand stays in `Shelf_3_Decor` (the post goes into the globe on purpose). |
| Donut on a plate | `Donut`, `Donut_Icing`, `Plate` (desk) | Flat materials `M_DonutDough`, `M_DonutGlaze`, `M_Ceramic`. The original Poliigon materials are kept in the file with a fake user (their image files aren't on this Mac). `Donut_Icing` has a `Decimate_web` modifier (0.25) applied at export. |
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
| `Calendar_Flip` | 0.92 s | `Calendar_PagePivot` turns 0 → 260° (eased) over the top. The website fades the page out over the last part and puts it back at rest, so repeated flips never snap. |
| `ShelfBall_Spin` | 2.0 s | `ShelfBall_Mesh` turns one full revolution about its vertical axis at constant speed; start and end orientation are the same. |

The GLB's rest pose is the inactive room (lamp asleep, drawers closed). No two clips animate the same node, so they can all play at once.

## Materials
All materials are plain Principled/PBR with flat colours (warm cozy palette), named `M_*`. They're easy to find with `scene.traverse` and override:
`M_WindowGlass` (alpha blend), `M_WindowSky`, `M_Screen`, `M_LampBulb`, `M_StringLightBulb` are the ones the website drives.
Every mesh has a UV map: 0–1 on the glass, screen and backdrop, and box-projected elsewhere for future textures or bakes.

## Changes to your original objects
- Renamed everything (for example `computer` → `Monitor_Body`, key rows → `Keyboard_Keys_NN`), sorted into collections, and parented under `StudyRoom`.
- **Headphones:** rebuilt at realistic proportions on your stand: sage cups, cream cushions, metal yokes and a padded band. Your original WIP cups were too small to carry a believable headband, so they were replaced (the archived copies were removed on 2026-10-21).
- **Window:** cut into the −Y wall with a boolean (applied).
- **Floor:** split out of `room` into `Room_Floor` (now a dark base), with `Room_FloorPlanks` on top: 21 rows of individually modelled, bevelled oak planks in three tones. The plank tops sit 0.4 cm above the old floor level.
- **The +X wall isn't square:** it's rotated about 2.1° (x ≈ 124.3 + 0.036·y cm). Everything mounted on it (pinboard, string lights, shelf books, dresser) follows that line.
- **Desk plant:** the pot was sunk about 2.3 cm into the desk, so the whole plant now sits on the desk top.
- **Subdivision:** viewport levels lowered on `Mug` (3 → 1) and `DeskPlant_Pot` (4 → 2) to keep the GLB light. Render levels are unchanged.
- **Removed:** the 20 empty actions (they had no keyframes).
- **Camera:** your `camera` dome was replaced on the riser by `CameraProp` (the archived dome was removed on 2026-10-21).
- **Still in the file:** `Keyboard_Key_Stray` (was `Plane.022`) lies on the desk, hidden under the mouse pad. It looks like a leftover, so you may want to delete it.
- **Added later:** a chest of drawers beside the desk (vase of dried pampas and books on top), an easel with a painting by the window, an art stool with a palette and brushes, a striped blanket over the pouf, and slippers on the rug. The pouf is now bigger and rounder (radius 27 cm, height 24 cm, 9 cm rounded edge), and the blanket is sized to drape over it.
- **2026-10-21:** donut and plate moved under `StudyRoom` and seated on the desk; calendar rig and globe added (see above); slippers, art stool and floor plant lifted onto the plank floor; mouse pad, headphone-stand base and monitor riser seated on the desk; `Monitor_Riser` and `HeadphoneStand_Base` normals recalculated. The `_Archive` and `_Preview` collections were removed.
