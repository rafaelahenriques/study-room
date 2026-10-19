"""
Bakes ambient occlusion for the static parts of the room into one texture atlas.

  cd blender
  /Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P bake_ao.py

Pipeline: (build_enriched_room.py) → bake_ao.py → export_glb.py

What it does:
  1. applies the modifiers of the static objects (the bake needs the final geometry),
  2. gives them a second UV map "AO_UV", laid out by hand in ONE atlas (each surface is
     projected flat into its own region, see the layout below),
  3. bakes Cycles AO into web/public/textures/room_ao.jpg (2048², lightly denoised),
  4. saves the .blend. glTF exports AO_UV as TEXCOORD_1 → three.js `uv1`, used by `aoMap`.

Only objects that never move are baked: baked contact shadows would be wrong on the lamp,
drawers, chair, curtains or headphones once they animate. Lighting stays real-time (time of
day, weather, the desk lamp), the AO adds the soft contact shadows on top.
"""
import bpy, bmesh, os
import numpy as np
from mathutils import Vector

C, D = bpy.context, bpy.data
S = C.scene
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "web", "public", "textures", "room_ao.jpg"))
SIZE = 2048
UV_NAME = "AO_UV"

# every baked surface gets its own projected region of the atlas
FLOOR, WALLS, RUG = "Room_FloorPlanks", "Room_Walls", "Rug"
# furniture: only the top surfaces (where things stand and cast contact shadows), each
# projected from above into its own slot: (u0, v0, width, height) in atlas space
TOPS = {
    "Desk_Top": (0.50, 0.19, 0.12, 0.31),
    "Monitor_Riser": (0.00, 0.86, 0.06, 0.12),
    "Dresser_Body": (0.07, 0.86, 0.07, 0.12),
    "Shelf_1": (0.15, 0.86, 0.05, 0.12),
    "Shelf_2": (0.21, 0.86, 0.05, 0.12),
    "Shelf_3": (0.27, 0.86, 0.05, 0.12),
    "Window_Sill": (0.33, 0.86, 0.20, 0.05),
}
STATIC = [FLOOR, WALLS, RUG] + list(TOPS)
objs = [D.objects[n] for n in STATIC if n in D.objects]
missing = [n for n in STATIC if n not in D.objects]
if missing:
    print("BAKE skipping missing:", missing)

# atlas layout (u, v in 0…1, v up):   floor  [0, .5]×[0, .5]    rug [.5, .62]×[0, .19]
#   -Y wall [0, .5]×[.5, .85]   +X wall [.5, 1]×[.5, .85]   desk top [.5, .62]×[.19, .5]
#   riser, dresser, shelves and sill tops: the band v ∈ [.86, .98]
#   faces never seen from inside (outer walls, plank sides, window jambs) → white corner
WHITE = [(0.991, 0.991), (0.999, 0.991), (0.999, 0.999), (0.991, 0.999)]

# objects that were baked by an earlier version of this script lose their AO UVs
for ob in D.objects:
    if ob.type == "MESH" and ob.name not in STATIC and UV_NAME in ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[UV_NAME])

# ---- 1. apply modifiers (bevels etc.) so every exported face gets its own bake UVs
dg = C.evaluated_depsgraph_get()
for ob in objs:
    if not ob.modifiers:
        continue
    me = D.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    name = old.name
    if old.users == 0:
        D.meshes.remove(old)
    me.name = name
print("BAKE modifiers applied")

# ---- 2. second UV map
for ob in objs:
    uvl = ob.data.uv_layers
    if UV_NAME in uvl:
        uvl.remove(uvl[UV_NAME])
    if not uvl:
        uvl.new(name="UVMap")
    layer = uvl.new(name=UV_NAME)
    uvl.active = layer                  # the bake writes through the active UV map
    uvl[0].active_render = True         # the first map stays the "real" UV for materials


def world_faces(ob):
    """yield (bmesh face, world-space vertex positions, world normal)"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    return bm, [(f, [mw @ l.vert.co for l in f.loops], (nm @ f.normal).normalized()) for f in bm.faces]


def project(ob, mapper):
    """mapper(world positions, world normal) -> list of uv per loop, or None (→ white corner)"""
    bm, faces = world_faces(ob)
    uv = bm.loops.layers.uv[UV_NAME]
    for f, pts, n in faces:
        uvs = mapper(pts, n)
        for k, l in enumerate(f.loops):
            l[uv].uv = uvs[k] if uvs else WHITE[k % 4]
    bm.to_mesh(ob.data)
    bm.free()


def bounds(ob, keep):
    _, faces = world_faces(ob)
    pts = [p for f, ps, n in faces if keep(ps, n) for p in ps]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def remap(a, lo, hi, o, s):
    return o + (a - lo) / (hi - lo) * s


# floor: top faces seen from above
fl = D.objects.get(FLOOR)
if fl:
    up = lambda ps, n: n.z > 0.7
    lo, hi = bounds(fl, up)
    project(fl, lambda ps, n: [(remap(p.x, lo.x, hi.x, 0, 0.5), remap(p.y, lo.y, hi.y, 0, 0.5)) for p in ps] if up(ps, n) else None)

# rug: top face
rug = D.objects.get(RUG)
if rug:
    up = lambda ps, n: n.z > 0.7
    lo, hi = bounds(rug, up)
    project(rug, lambda ps, n: [(remap(p.x, lo.x, hi.x, 0.5, 0.12), remap(p.y, lo.y, hi.y, 0, 0.19)) for p in ps] if up(ps, n) else None)

# walls: only the two inner faces (facing into the room)
wl = D.objects.get(WALLS)
if wl:
    _, faces = world_faces(wl)
    inner_y = min(min(p.y for p in ps) for f, ps, n in faces if n.y > 0.7)     # inner face of the -Y wall
    wall_y = lambda ps, n: n.y > 0.7 and min(p.y for p in ps) > inner_y - 1.0
    wall_x = lambda ps, n: n.x < -0.7 and min(p.y for p in ps) > inner_y - 1.0
    loy, hiy = bounds(wl, wall_y)
    lox, hix = bounds(wl, wall_x)

    def walls(ps, n):
        if wall_y(ps, n):
            return [(remap(p.x, loy.x, hiy.x, 0, 0.5), remap(p.z, loy.z, hiy.z, 0.5, 0.35)) for p in ps]
        if wall_x(ps, n):
            return [(remap(p.y, lox.y, hix.y, 0.5, 0.5), remap(p.z, lox.z, hix.z, 0.5, 0.35)) for p in ps]
        return None
    project(wl, walls)

# furniture tops
for name, (u0, v0, w, h) in TOPS.items():
    ob = D.objects.get(name)
    if not ob:
        continue
    # only the highest upward surface: inner faces (e.g. inside the dresser) would overlap it
    _, faces = world_faces(ob)
    top_z = max(max(p.z for p in ps) for f, ps, n in faces if n.z > 0.7)
    up = lambda ps, n, top_z=top_z: n.z > 0.7 and min(p.z for p in ps) > top_z - 1.5
    lo, hi = bounds(ob, up)
    project(ob, lambda ps, n, lo=lo, hi=hi, u0=u0, v0=v0, w=w, h=h, up=up:
            [(remap(p.x, lo.x, hi.x, u0, w), remap(p.y, lo.y, hi.y, v0, h)) for p in ps] if up(ps, n) else None)
print("BAKE uv atlas laid out for", len(objs), "objects")

# all baked objects must be selected for the bake
bpy.ops.object.select_all(action="DESELECT")
for ob in objs:
    ob.select_set(True)
C.view_layer.objects.active = objs[0]

# ---- 3. bake AO with Cycles
img = D.images.get("RoomAO") or D.images.new("RoomAO", SIZE, SIZE, alpha=False)
img.generated_color = (1, 1, 1, 1)
added = []
for ob in objs:
    for slot in ob.material_slots:
        m = slot.material
        if not m or m in [a[0] for a in added]:
            continue
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.name = "AO_BAKE_TARGET"
        node.image = img
        nt.nodes.active = node
        added.append((m, node))

S.render.engine = "CYCLES"
try:  # use the GPU (Metal on macOS) when available
    prefs = C.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    S.cycles.device = "GPU"
except Exception as e:  # noqa: BLE001
    print("BAKE GPU not available, using CPU:", e)
S.cycles.samples = 160
S.world.light_settings.distance = 35.0   # cm: how far a surface "looks" for occluders
S.render.bake.margin = 8
S.render.bake.margin_type = "EXTEND"
bpy.ops.object.bake(type="AO", use_clear=True)
print("BAKE done")

# the collapsed "never seen" faces sample the corner: make it white (no occlusion)
corner = int(SIZE * 0.985)
# light denoise: 3×3 box blur (the margin pixels keep the islands' edges clean)
px = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)
ao = px[..., 0]
pad = np.pad(ao, 1, mode="edge")
blur = sum(pad[1 + dy:1 + dy + SIZE, 1 + dx:1 + dx + SIZE] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9.0
px[..., 0] = px[..., 1] = px[..., 2] = blur
px[..., 3] = 1.0
px[corner:, corner:, :3] = 1.0
img.pixels[:] = px.ravel()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.filepath_raw = OUT
img.file_format = "JPEG"
img.save()
print("BAKE saved", OUT)

# ---- 4. clean up: remove the temporary bake nodes, keep the UV maps
for m, node in added:
    m.node_tree.nodes.remove(node)
for ob in objs:
    ob.data.uv_layers.active = ob.data.uv_layers[0]
D.images.remove(img)

C.preferences.filepaths.save_version = 0
bpy.ops.wm.save_mainfile()
print("BAKE saved blend")
