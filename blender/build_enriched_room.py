"""
Builds isometricroom_enriched.blend from isometricroom.blend.

Run from the blender/ folder (never modifies the original file):
  /Applications/Blender.app/Contents/MacOS/Blender -b isometricroom.blend --factory-startup \
      -P build_enriched_room.py

Scene units are authored in centimetres (1 Blender unit = 1 cm). The export script
scales the StudyRoom root by 0.01 so the GLB is in metres.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

D, C = bpy.data, bpy.context
S = C.scene
random.seed(11)
rad = math.radians
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "isometricroom_enriched.blend")


# ---------------------------------------------------------------- helpers
def srgb(h):
    h = h.lstrip("#")
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


MATS = {}


def mat(name, hexc, rough=0.7, metal=0.0, emit=None, strength=1.0, alpha=1.0, cull=False):
    if name in MATS:
        return MATS[name]
    m = D.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = srgb(hexc)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = srgb(emit)
        p.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        p.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = cull
    m.diffuse_color = srgb(hexc)
    MATS[name] = m
    return m


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def faces_of(verts):
    s = set()
    for v in verts:
        s.update(v.link_faces)
    return s


def tag(verts, mi):
    fs = faces_of(verts)
    for f in fs:
        f.material_index = mi
    return fs


def add_box(bm, dims, loc=(0, 0, 0), rot=(0, 0, 0), mi=0):
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=M(loc, rot, dims))
    tag(r["verts"], mi)
    return r["verts"]


def add_cyl(bm, r1, depth, loc=(0, 0, 0), rot=(0, 0, 0), mi=0, segs=16, r2=None, caps=True):
    r = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1,
                              radius2=r1 if r2 is None else r2, depth=depth, matrix=M(loc, rot))
    tag(r["verts"], mi)
    return r["verts"]


def add_sphere(bm, radius, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), mi=0, u=12, v=8):
    r = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius, matrix=M(loc, rot, scale))
    tag(r["verts"], mi)
    return r["verts"]


def add_beam(bm, p0, p1, w, d, mi=0):
    p0, p1 = Vector(p0), Vector(p1)
    q = (p1 - p0).to_track_quat("Z", "Y")
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale((p0 + p1) / 2, q, Vector((w, d, (p1 - p0).length))))
    tag(r["verts"], mi)
    return r["verts"]


def box_uv(bm, scale=0.05):
    uv = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            l[uv].uv = (u * scale, v * scale)


def smooth(bm, angle=35):
    for f in bm.faces:
        f.smooth = True
    lim = rad(angle)
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) > lim:
            e.smooth = False


def mk(name, bm, mats, coll, uv="box", uvscale=0.05, smooth_angle=None, parent=None, loc=None, rot=None):
    if uv == "box":
        box_uv(bm, uvscale)
    if smooth_angle:
        smooth(bm, smooth_angle)
    me = D.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = D.objects.new(name, me)
    coll.objects.link(ob)
    if parent:
        ob.parent = parent
    if loc is not None:
        ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    return ob


def empty(name, coll, loc=(0, 0, 0), parent=None, size=5, kind="PLAIN_AXES"):
    ob = D.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    coll.objects.link(ob)
    if parent:
        ob.parent = parent
    ob.location = loc
    return ob


def set_parent(ob, par):
    C.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = par
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_world = mw


def bevel(ob, width, segs=2, angle=40):
    md = ob.modifiers.new("Bevel", "BEVEL")
    md.width = width
    md.segments = segs
    md.limit_method = "ANGLE"
    md.angle_limit = rad(angle)
    md.harden_normals = False
    return md


def wbbox(ob):
    C.view_layer.update()
    ev = ob.evaluated_get(C.evaluated_depsgraph_get())
    pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def eval_world_verts(ob):
    C.view_layer.update()
    ev = ob.evaluated_get(C.evaluated_depsgraph_get())
    me = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return pts


def ray(o, d):
    C.view_layer.update()
    hit, loc, *_ = S.ray_cast(C.evaluated_depsgraph_get(), Vector(o), Vector(d))
    return loc if hit else None


def assign(ob, *mats):
    if ob.type != "MESH":
        return
    if ob.data.users > 1:
        ob.data = ob.data.copy()
    ob.data.materials.clear()
    for m in mats:
        ob.data.materials.append(m)


def quad(bm, center, right, up, w, h, mi=0):
    """Single quad with 0..1 UVs; normal = right x up (faces the viewer)."""
    c, r, u = Vector(center), Vector(right).normalized(), Vector(up).normalized()
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    vs = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(vs)
    f.material_index = mi
    uvl = bm.loops.layers.uv.verify()
    for l in f.loops:
        l[uvl].uv = uvs[vs.index(l.vert)]
    return f


def sweep(bm, pts, profile, binormal, mi=0, closed_profile=True):
    """Sweep a 2D profile (offsets along normal/binormal) along a polyline."""
    B = Vector(binormal).normalized()
    rings = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        T = (Vector(b) - Vector(a)).normalized()
        N = T.cross(B).normalized()
        Bi = N.cross(T).normalized()
        rings.append([bm.verts.new(Vector(p) + N * pn + Bi * pb) for pn, pb in profile])
    n = len(profile)
    for i in range(len(rings) - 1):
        for k in range(n if closed_profile else n - 1):
            k2 = (k + 1) % n
            f = bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            f.material_index = mi
    return rings


def circle_profile(r, segs=6):
    return [(r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs)) for k in range(segs)]


def key_loop(ob, path, idx, base, amp, length, phase=0):
    """Seamless loop: base-amp -> base+amp -> base-amp."""
    frames = [1, 1 + length // 2, 1 + length]
    vals = [base - amp, base + amp, base - amp]
    if phase:
        frames = [1, 1 + length // 4, 1 + 3 * length // 4, 1 + length]
        vals = [base, base + amp, base - amp, base]
    for f, v in zip(frames, vals):
        getattr(ob, path)[idx] = v
        ob.keyframe_insert(path, index=idx, frame=f)
    getattr(ob, path)[idx] = vals[0]


def push_nla(ob, track):
    ad = ob.animation_data
    act = ad.action
    act.name = f"{track}__{ob.name}"
    tr = ad.nla_tracks.new()
    tr.name = track
    st = tr.strips.new(track, int(act.frame_range[0]), act)
    if hasattr(st, "action_slot") and getattr(act, "slots", None) and st.action_slot is None:
        st.action_slot = act.slots[0]
    ad.action = None


# ---------------------------------------------------------------- palette
P = dict(
    wall="#EDE3D1", floor="#B5875A", rug="#C9785A", oak="#C99A6B", oak_dark="#A8794F",
    charcoal="#3B3633", charcoal2="#2F2C2B", cream="#F3EBDD", cream2="#D8CCB8", sage="#8FA68A",
    sage_dark="#6F8A6E", terracotta="#C66F4E", mustard="#D9A441", blush="#E39A86", blue="#6C8EA8",
    brown="#7A5C4A", leaf="#5E7D52", leaf2="#7C9A63", soil="#4A3527", metal="#BDB6AC",
)
M_WALL = mat("M_Wall", P["wall"], 0.9)
M_FLOOR = mat("M_FloorWood", P["floor"], 0.6)
M_RUG = mat("M_Rug", P["rug"], 1.0)
M_OAK = mat("M_Oak", P["oak"], 0.55)
M_OAKD = mat("M_OakDark", P["oak_dark"], 0.55)
M_CHAR = mat("M_Charcoal", P["charcoal"], 0.5)
M_CHAR2 = mat("M_TechDark", P["charcoal2"], 0.35)
M_CREAM = mat("M_Cream", P["cream"], 0.6)
M_CREAM2 = mat("M_CreamDark", P["cream2"], 0.6)
M_SAGE = mat("M_Sage", P["sage"], 0.7)
M_SAGED = mat("M_SageDark", P["sage_dark"], 0.85)
M_TERRA = mat("M_Terracotta", P["terracotta"], 0.6)
M_MUST = mat("M_Mustard", P["mustard"], 0.5)
M_BLUSH = mat("M_Blush", P["blush"], 0.7)
M_BLUE = mat("M_DustyBlue", P["blue"], 0.6)
M_BROWN = mat("M_Brown", P["brown"], 0.6)
M_LEAF = mat("M_Leaf", P["leaf"], 0.6)
M_LEAF2 = mat("M_LeafLight", P["leaf2"], 0.6)
M_SOIL = mat("M_Soil", P["soil"], 1.0)
M_METAL = mat("M_Metal", P["metal"], 0.3, 0.9)
M_PAGES = mat("M_Pages", "#F4EEE2", 0.9)
M_SCREEN = mat("M_Screen", "#0B0E14", 0.25, emit="#1C2A3A", strength=1.0)
M_BULB = mat("M_LampBulb", "#FFF1D6", 0.3, emit="#FFD49A", strength=2.0)
M_SHADE_OUT = mat("M_LampShade", P["mustard"], 0.45, cull=True)
M_SHADE_IN = mat("M_LampShadeInner", "#F6EBD3", 0.6, cull=True)
M_GLASS = mat("M_WindowGlass", "#DCEBF0", 0.05, alpha=0.18)
M_SKY = mat("M_WindowSky", "#CFE0EA", 1.0, emit="#CFE0EA", strength=1.0)
M_FRAME = mat("M_WindowFrame", "#F6F1E7", 0.5)
M_CURTAIN = mat("M_Curtain", P["sage"], 0.95)
M_FAIRY = mat("M_StringLightBulb", "#FFF3DC", 0.4, emit="#FFC977", strength=3.0)
M_LENS = mat("M_LensGlass", "#1B2430", 0.05, 0.2)
M_CORK = mat("M_Cork", "#C49A6C", 1.0)
M_WHITE = mat("M_PaperWhite", "#FAF7F0", 0.8)


# ---------------------------------------------------------------- collections
def coll(name, parent):
    c = D.collections.new(name)
    parent.children.link(c)
    return c


ROOTC = coll("StudyRoom", S.collection)
C_ROOM = coll("Room", ROOTC)
C_WIN = coll("Window", ROOTC)
C_DESK = coll("Desk", ROOTC)
C_COMP = coll("Computer", ROOTC)
C_LAMP = coll("Lamp", ROOTC)
C_PDESK = coll("Props_Desk", ROOTC)
C_PSHELF = coll("Props_Shelves", ROOTC)
C_PWALL = coll("Props_Wall", ROOTC)
C_PFLOOR = coll("Props_Floor", ROOTC)
C_ANCH = coll("Anchors", ROOTC)
C_PREV = coll("_Preview", S.collection)
C_ARCH = coll("_Archive", S.collection)


def move(ob, c):
    for old in list(ob.users_collection):
        old.objects.unlink(ob)
    c.objects.link(ob)


# ---------------------------------------------------------------- measure the room
FLOOR = ray((60, 60, 100), (0, 0, -1)).z
WALLX = ray((0, 90, 185), (1, 0, 0)).x
WALLY = ray((20, 0, 185), (0, -1, 0)).y
DESK_TOP = wbbox(D.objects["Desk"])[1].z
RUG_TOP = wbbox(D.objects["rug"])[1].z
print(f"MEASURE floor={FLOOR:.2f} wallX={WALLX:.2f} wallY={WALLY:.2f} desk={DESK_TOP:.2f} rug={RUG_TOP:.2f}")
# the +X wall is not square to the room (~2 deg): fit its inner face as x = WX_A + WX_B * y
_wy0, _wy1 = -100.0, 100.0
_wx0 = ray((0, _wy0, 190), (1, 0, 0)).x
_wx1 = ray((0, _wy1, 190), (1, 0, 0)).x
WX_B = (_wx1 - _wx0) / (_wy1 - _wy0)
WX_A = _wx0 - WX_B * _wy0
WALL_ANG = math.atan(WX_B)


def wall_x(y):
    return WX_A + WX_B * y


print(f"WALLX fit x = {WX_A:.2f} + {WX_B:.4f}*y  ({math.degrees(WALL_ANG):.2f} deg)")

# ---------------------------------------------------------------- clean up empty actions
for ob in D.objects:
    if ob.animation_data:
        ob.animation_data_clear()
for a in list(D.actions):
    D.actions.remove(a)

# ---------------------------------------------------------------- rename + organise existing objects
RENAME = {
    "room": "Room_Walls", "rug": "Rug", "Desk": "Desk_Top", "desklegs": "Desk_Legs",
    "computer": "Monitor_Body", "computertable": "Monitor_Riser", "ComputerMat": "MousePad",
    "pencilholder": "PencilHolder", "pencil1": "Pencil_1", "pencil2": "Pencil_2", "pencil3": "Pencil_3",
    "pencil4": "Pencil_4", "calendar": "Calendar_Stand", "Cylinder.001": "Calendar_Rings",
    "FlowerPot": "DeskPlant_Pot", "Plane.035": "DeskPlant_Soil", "Flower1": "DeskPlant_Flower_1",
    "flower2": "DeskPlant_Flower_2", "flowe3": "DeskPlant_Flower_3", "BézierCurve.001": "DeskPlant_Stem_1",
    "BézierCurve.002": "DeskPlant_Stem_2", "BézierCurve": "DeskPlant_Stem_3",
    "shelf1": "Shelf_1", "shelf2": "Shelf_2", "shelf3": "Shelf_3",
    "Cube": "Headphones_CupL", "Cube.001": "Headphones_CushionL", "Cube.002": "Headphones_HingeL",
    "Cube.004": "Headphones_CupR", "Cube.005": "Headphones_CushionR", "Cube.006": "Headphones_HingeR",
    "Cube.007": "Headphones_SliderR", "Cylinder.002": "HeadphoneStand_Posts",
    "Cylinder.003": "HeadphoneStand_Bar", "Plane.038": "HeadphoneStand_Base",
    "camera": "Archive_CameraDome", "Camera": "Cam_IsoPreview", "keys": "Keyboard_Keys_Arrows",
    "Plane.022": "Keyboard_Key_Stray",
}
for old, new in RENAME.items():
    D.objects[old].name = new
key_rows = sorted([o for o in D.objects if o.name.startswith("Plane.")], key=lambda o: (round(o.location.x), o.location.y))
for i, o in enumerate(key_rows, 1):
    o.name = f"Keyboard_Keys_{i:02d}"

O = D.objects
for n in ["Room_Walls", "Rug"]:
    move(O[n], C_ROOM)
for n in ["Desk_Top", "Desk_Legs", "Monitor_Riser"]:
    move(O[n], C_DESK)
for o in list(D.objects):
    if o.name.startswith("Keyboard") or o.name in ("Monitor_Body", "Mouse", "MousePad"):
        move(o, C_COMP)
for o in list(D.objects):
    if o.name.startswith(("Pencil", "Calendar", "DeskPlant", "Headphone")) or o.name == "Mug":
        move(o, C_PDESK)
for n in ["Shelf_1", "Shelf_2", "Shelf_3"]:
    move(O[n], C_PSHELF)
move(O["Archive_CameraDome"], C_ARCH)
move(O["Cam_IsoPreview"], C_PREV)
for c in list(D.collections):
    if c.name in ("Collection", "LCA"):
        D.collections.remove(c)
C_ARCH.hide_render = True
C.view_layer.layer_collection.children["_Archive"].exclude = True

# keyboard hierarchy
for n in ["Keyboard_Keys_Arrows", "Keyboard_Key_Stray"]:
    set_parent(O[n], O["Keyboard"])

# desk plant stems: curves -> meshes so they export reliably
for n in ["DeskPlant_Stem_1", "DeskPlant_Stem_2", "DeskPlant_Stem_3"]:
    cu = O[n]
    C.view_layer.update()
    me = D.meshes.new_from_object(cu.evaluated_get(C.evaluated_depsgraph_get()))
    ob = D.objects.new(n + "_m", me)
    C_PDESK.objects.link(ob)
    ob.parent = cu.parent
    ob.matrix_parent_inverse = cu.matrix_parent_inverse.copy()
    ob.matrix_basis = cu.matrix_basis.copy()
    D.objects.remove(cu, do_unlink=True)
    ob.name = n
    bm = bmesh.new()
    bm.from_mesh(me)
    box_uv(bm, 0.5)
    bm.to_mesh(me)
    bm.free()

# ---------------------------------------------------------------- window opening + floor split
room = O["Room_Walls"]
WX0, WX1, WZ0, WZ1 = -20.0, 60.0, 90.0, 170.0
cut_bm = bmesh.new()
add_box(cut_bm, (WX1 - WX0, 60, WZ1 - WZ0), ((WX0 + WX1) / 2, WALLY - 10, (WZ0 + WZ1) / 2))
cutter = mk("WindowCutter", cut_bm, [], C_ARCH, uv=None)
md = room.modifiers.new("WindowCut", "BOOLEAN")
md.object = cutter
md.solver = "EXACT"
md.use_hole_tolerant = True
C.view_layer.update()
new_me = D.meshes.new_from_object(room.evaluated_get(C.evaluated_depsgraph_get()))
room.modifiers.remove(md)
room.data = new_me
D.objects.remove(cutter, do_unlink=True)
print("WINDOW RAY (should be None):", ray(((WX0 + WX1) / 2, 0, 130), (0, -1, 0)))

floor_me = room.data.copy()
mw = room.matrix_world.copy()


def keep_faces(mesh, pred):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    kill = [f for f in bm.faces if not pred(f)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(mesh)
    bm.free()


def is_floor(f):
    return max((mw @ v.co).z for v in f.verts) <= FLOOR + 0.5


keep_faces(floor_me, is_floor)
keep_faces(room.data, lambda f: not is_floor(f))
floor_ob = D.objects.new("Room_Floor", floor_me)
C_ROOM.objects.link(floor_ob)
floor_ob.matrix_world = mw
assign(room, M_WALL)
assign(floor_ob, mat("M_FloorBase", "#6E4E35", 0.8))

# modelled oak planks over the slab (top sits 0.4 above the original floor level)
flo, fhi = wbbox(floor_ob)
PX0, PX1, PY0, PY1 = flo.x + 0.6, wall_x(fhi.y) + 1.0, WALLY, fhi.y - 0.6
PW, GAP, PT = 12.0, 0.35, 1.2
plank_mats = [M_FLOOR, mat("M_FloorWood2", "#A97B4F", 0.6), mat("M_FloorWood3", "#C29462", 0.6)]
bm = bmesh.new()
y, row, last = PY0, 0, -1
while y < PY1 - 0.5:
    w = min(PW, PY1 - y)
    x = PX0
    L = random.uniform(25, 110)
    while x < PX1 - 0.5:
        L = min(L, PX1 - x)
        mi = random.choice([i for i in range(3) if i != last])
        last = mi
        add_box(bm, (L - GAP, w - GAP, PT), (x + L / 2, y + w / 2, FLOOR + 0.4 - PT / 2), mi=mi)
        x += L
        L = random.uniform(70, 130)
    y += w
    row += 1
planks = mk("Room_FloorPlanks", bm, plank_mats, C_ROOM, uvscale=0.02)
bevel(planks, 0.3, 1, 40)
print(f"PLANKS rows={row} faces={len(planks.data.polygons)}")
assign(O["Rug"], M_RUG)

# ---------------------------------------------------------------- window
WT_OUT = WALLY - 20.57          # outer face of the -Y wall
GY = WALLY - 10.3               # glass plane, middle of wall thickness
wcx, wcz = (WX0 + WX1) / 2, (WZ0 + WZ1) / 2
win = empty("Window", C_WIN, (wcx, GY, wcz), size=10)
bm = bmesh.new()
fw, fd = 4.0, 7.0
add_box(bm, (WX1 - WX0, fd, fw), (wcx, GY, WZ0 + fw / 2))
add_box(bm, (WX1 - WX0, fd, fw), (wcx, GY, WZ1 - fw / 2))
add_box(bm, (fw, fd, WZ1 - WZ0 - 2 * fw), (WX0 + fw / 2, GY, wcz))
add_box(bm, (fw, fd, WZ1 - WZ0 - 2 * fw), (WX1 - fw / 2, GY, wcz))
add_box(bm, (2.5, 4.0, WZ1 - WZ0 - 2 * fw), (wcx, GY, wcz))
add_box(bm, (WX1 - WX0 - 2 * fw, 4.0, 2.5), (wcx, GY, wcz))
# interior architrave on the wall face
ay = WALLY + 0.6
add_box(bm, (WX1 - WX0 + 8, 1.2, 4), (wcx, ay, WZ1 + 2))
add_box(bm, (4, 1.2, WZ1 - WZ0 + 4), (WX0 - 2, ay, wcz + 2))
add_box(bm, (4, 1.2, WZ1 - WZ0 + 4), (WX1 + 2, ay, wcz + 2))
frame = mk("Window_Frame", bm, [M_FRAME], C_WIN, parent=None)
bevel(frame, 0.35, 2)

bm = bmesh.new()
add_box(bm, (WX1 - WX0 + 4, WALLY + 8 - GY, 3), (wcx, (WALLY + 8 + GY) / 2, WZ0 - 1.5))
sill = mk("Window_Sill", bm, [M_FRAME], C_WIN)
bevel(sill, 0.5, 2)

bm = bmesh.new()
quad(bm, (wcx, GY, wcz), (-1, 0, 0), (0, 0, 1), WX1 - WX0 - 2 * fw, WZ1 - WZ0 - 2 * fw)
glass = mk("Window_Glass", bm, [M_GLASS], C_WIN, uv=None)
glass["interactive"] = "window"

bm = bmesh.new()
quad(bm, (20, WT_OUT - 12, 120), (-1, 0, 0), (0, 0, 1), 160, 130)
backdrop = mk("Window_Backdrop", bm, [M_SKY], C_WIN, uv=None)

# curtains + rod
ROD_Z, CY = 182.0, WALLY + 4.0
bm = bmesh.new()
add_cyl(bm, 0.9, 136, (wcx, CY, ROD_Z), (0, rad(90), 0), segs=10)
add_sphere(bm, 1.8, (wcx - 68, CY, ROD_Z), mi=0)
add_sphere(bm, 1.8, (wcx + 68, CY, ROD_Z), mi=0)
add_box(bm, (1.5, 4.5, 3), (wcx - 60, WALLY + 2.2, ROD_Z), mi=0)
add_box(bm, (1.5, 4.5, 3), (wcx + 60, WALLY + 2.2, ROD_Z), mi=0)
mk("Curtain_Rod", bm, [M_OAKD], C_WIN, smooth_angle=50)


def curtain(name, xc, w, phase):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    nx, nz, h = 18, 8, 102.0
    grid, uvd = [], {}
    for j in range(nz + 1):
        t = j / nz
        row = []
        for i in range(nx + 1):
            s = i / nx
            x = (s - 0.5) * w * (0.85 + 0.3 * t)
            y = (1.0 + 1.4 * t) * math.sin(s * math.pi * 6 + phase)
            v = bm.verts.new((x, y, -t * h))
            uvd[v] = (s, 1 - t)
            row.append(v)
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.normal_update()
    if sum(f.normal.y for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = uvd[l.vert]
    ob = mk(name, bm, [M_CURTAIN], C_WIN, uv=None, smooth_angle=80, loc=(xc, CY, ROD_Z - 2))
    return ob


cur_l = curtain("Curtain_L", WX0 - 15, 22, 0.0)
cur_r = curtain("Curtain_R", WX1 + 15, 22, 1.3)

# small succulent on the sill
bm = bmesh.new()


def add_succulent(bm, base, s=1.0, mi_pot=0, mi_leaf=1, mi_soil=2):
    x, y, z = base
    add_cyl(bm, 3.0 * s, 4.0 * s, (x, y, z + 2.0 * s), mi=mi_pot, segs=12, r2=3.4 * s)
    add_cyl(bm, 3.0 * s, 0.3, (x, y, z + 3.7 * s), mi=mi_soil, segs=12)
    for k in range(7):
        a = 2 * math.pi * k / 7
        tilt = rad(35 if k % 2 else 55)
        add_sphere(bm, 1.0 * s, (x + math.cos(a) * 1.2 * s, y + math.sin(a) * 1.2 * s, z + 5.2 * s),
                   scale=(0.7, 0.7, 2.0), rot=(0, tilt, a), mi=mi_leaf, u=8, v=6)
    add_sphere(bm, 0.9 * s, (x, y, z + 6.0 * s), scale=(0.8, 0.8, 1.6), mi=mi_leaf, u=8, v=6)


add_succulent(bm, (WX0 + 10, WALLY + 4.5, WZ0), 1.0)
mk("Sill_Succulent", bm, [M_TERRA, M_SAGE, M_SOIL], C_WIN, smooth_angle=60)

# ---------------------------------------------------------------- monitor screen
mon = O["Monitor_Body"]
best = None
for p in mon.data.polygons:
    n = (mon.matrix_world.to_3x3() @ p.normal).normalized()
    if n.x < -0.9 and (best is None or p.area > best.area):
        best = p
spts = [mon.matrix_world @ mon.data.vertices[i].co for i in best.vertices]
sy0, sy1 = min(p.y for p in spts), max(p.y for p in spts)
sz0, sz1 = min(p.z for p in spts), max(p.z for p in spts)
sx = min(p.x for p in spts) - 0.12
bm = bmesh.new()
quad(bm, (sx, (sy0 + sy1) / 2, (sz0 + sz1) / 2), (0, -1, 0), (0, 0, 1), sy1 - sy0, sz1 - sz0)
screen = mk("Monitor_Screen", bm, [M_SCREEN], C_COMP, uv=None)
set_parent(screen, mon)
screen["interactive"] = "monitor"
print(f"SCREEN {sy1 - sy0:.1f} x {sz1 - sz0:.1f} at x={sx:.2f}")
assign(mon, M_CHAR2)
assign(O["Monitor_Riser"], M_OAKD)

# ---------------------------------------------------------------- desk lamp
LB = Vector((111.0, -100.0, DESK_TOP))
yaw = rad(175)
lamp = empty("Lamp", C_LAMP, LB, size=6)
lamp.rotation_euler = (0, 0, yaw)
lamp["interactive"] = "lamp"

bm = bmesh.new()
add_cyl(bm, 5.5, 1.6, (0, 0, 0.8), segs=24)
add_cyl(bm, 1.3, 2.4, (0, 0, 2.8), segs=12)
l_base = mk("Lamp_Base", bm, [M_MUST], C_LAMP, smooth_angle=40, parent=lamp)
bevel(l_base, 0.3, 2)

bm = bmesh.new()
add_cyl(bm, 0.9, 0.7, (0, 0, 0), segs=12)
l_switch = mk("Lamp_Switch", bm, [M_CHAR], C_LAMP, smooth_angle=40, parent=l_base, loc=(-3.2, -2.2, 1.95))
l_switch["interactive"] = "lamp_switch"

bm = bmesh.new()
add_cyl(bm, 0.55, 20, (0, 0, 10), segs=10)
add_sphere(bm, 1.15, (0, 0, 0), mi=1)
add_sphere(bm, 1.15, (0, 0, 20), mi=1)
l_arm1 = mk("Lamp_ArmLower", bm, [M_MUST, M_METAL], C_LAMP, smooth_angle=50, parent=l_base,
            loc=(0, 0, 4.0), rot=(0, rad(35), 0))

bm = bmesh.new()
add_cyl(bm, 0.5, 18, (0, 0, 9), segs=10)
l_arm2 = mk("Lamp_ArmUpper", bm, [M_MUST], C_LAMP, smooth_angle=50, parent=l_arm1,
            loc=(0, 0, 20), rot=(0, rad(40), 0))

bm = bmesh.new()
add_cyl(bm, 1.0, 2.8, (0, 0, 0), (rad(90), 0, 0), mi=2, segs=12)
add_cyl(bm, 0.8, 1.6, (0, 0, -0.8), mi=0, segs=12)
add_cyl(bm, 5.2, 6.5, (0, 0, -4.75), mi=0, segs=24, r2=1.6, caps=False)
inner = add_cyl(bm, 5.05, 6.4, (0, 0, -4.75), mi=1, segs=24, r2=1.5, caps=False)
bmesh.ops.reverse_faces(bm, faces=list(faces_of(inner)))
l_head = mk("Lamp_Head", bm, [M_SHADE_OUT, M_SHADE_IN, M_METAL], C_LAMP, smooth_angle=50, parent=l_arm2,
            loc=(0, 0, 18), rot=(0, rad(-100), 0))

bm = bmesh.new()
add_sphere(bm, 1.7, (0, 0, 0), u=12, v=8)
l_bulb = mk("Lamp_Bulb", bm, [M_BULB], C_LAMP, smooth_angle=80, parent=l_head, loc=(0, 0, -4.2))

a_lamp = empty("Anchor_LampLight", C_ANCH, (0, 0, -4.2), parent=l_head, size=2)
a_lamp_t = empty("Anchor_LampTarget", C_ANCH, (0, 0, -40), parent=l_head, size=2)

# Lamp_Wake: asleep (bowed) at frame 1 -> overshoot -> awake at frame 30
for ob, vals in [(l_arm1, (10, 38, 35)), (l_arm2, (115, 36, 40)), (l_head, (-115, -104, -100))]:
    for f, v in zip((1, 20, 30), vals):
        ob.rotation_euler[1] = rad(v)
        ob.keyframe_insert("rotation_euler", index=1, frame=f)
    push_nla(ob, "Lamp_Wake")
    ob.rotation_euler[1] = rad(vals[0])

# ---------------------------------------------------------------- headphones (rebuilt on the user's stand)
# the original WIP cups were too small for a readable band; they are kept in _Archive
for n in ["Headphones_CupL", "Headphones_CushionL", "Headphones_HingeL", "Headphones_CupR",
          "Headphones_CushionR", "Headphones_HingeR", "Headphones_SliderR"]:
    O[n].name = "Archive_" + n
    move(O["Archive_" + n], C_ARCH)
bar_lo, bar_hi = wbbox(O["HeadphoneStand_Bar"])
hp = empty("Headphones", C_PDESK, ((bar_lo.x + bar_hi.x) / 2, (bar_lo.y + bar_hi.y) / 2, bar_hi.z), size=4)
hp["interactive"] = "headphones"
CUP_Y, CUP_Z, CUP_R = 7.6, -10.2, 3.7
for side, tag_ in [(-1, "L"), (1, "R")]:
    bm = bmesh.new()
    add_cyl(bm, CUP_R, 2.6, (0, side * CUP_Y, CUP_Z), (rad(90), 0, 0), mi=0, segs=24)
    add_cyl(bm, 2.5, 0.5, (0, side * (CUP_Y + 1.45), CUP_Z), (rad(90), 0, 0), mi=1, segs=20)
    cup = mk(f"Headphones_Cup{tag_}", bm, [M_SAGE, M_CREAM], C_PDESK, smooth_angle=40, parent=hp)
    bevel(cup, 0.6, 3, 40).use_clamp_overlap = False
    bm = bmesh.new()
    add_cyl(bm, 3.4, 1.7, (0, side * (CUP_Y - 2.1), CUP_Z), (rad(90), 0, 0), mi=0, segs=24)
    cush = mk(f"Headphones_Cushion{tag_}", bm, [M_CREAM2], C_PDESK, smooth_angle=40, parent=hp)
    bevel(cush, 0.7, 3, 40).use_clamp_overlap = False
    bm = bmesh.new()
    fork = [(4.15 * math.sin(t), side * CUP_Y, CUP_Z + 4.15 * math.cos(t)) for t in [rad(-75 + 150 * k / 10) for k in range(11)]]
    sweep(bm, fork, circle_profile(0.3, 6), (0, 1, 0), mi=0)
    add_box(bm, (0.9, 0.9, 1.8), (0, side * CUP_Y, CUP_Z + 4.15 + 0.8), mi=0)
    mk(f"Headphones_Yoke{tag_}", bm, [M_METAL], C_PDESK, smooth_angle=60, parent=hp)


def band_pt(t, rise, half_w, z_end):
    return Vector((0, half_w * math.sin(t), z_end + rise * (math.cos(t) ** 0.6)))


Z_END = CUP_Z + 4.15 + 1.7
band_pts = [band_pt(t, 1.35 - Z_END, CUP_Y + 0.15, Z_END) for t in [-math.pi / 2 + math.pi * k / 30 for k in range(31)]]
bm = bmesh.new()
sweep(bm, band_pts, [(-0.45, -1.3), (0.45, -1.3), (0.45, 1.3), (-0.45, 1.3)], (1, 0, 0), mi=0)
pad_pts = [band_pt(t, 0.45 - (Z_END + 1.2), CUP_Y - 0.9, Z_END + 1.2) for t in [-1.05 + 2.1 * k / 16 for k in range(17)]]
sweep(bm, pad_pts, [(-0.45, -1.0), (0.45, -1.0), (0.45, 1.0), (-0.45, 1.0)], (1, 0, 0), mi=1)
band = mk("Headphones_Band", bm, [M_SAGE, M_CREAM2], C_PDESK, smooth_angle=60, parent=hp)
bevel(band, 0.2, 2, 50)
C.view_layer.update()
cup_bottom = min(min(p.z for p in eval_world_verts(O[n])) for n in ["Headphones_CupL", "Headphones_CupR"])
base_top = wbbox(O["HeadphoneStand_Base"])[1].z
print(f"HEADPHONES cup bottom {cup_bottom:.2f} vs stand base top {base_top:.2f}")
assign(O["HeadphoneStand_Base"], M_OAKD)
assign(O["HeadphoneStand_Posts"], M_CHAR)
assign(O["HeadphoneStand_Bar"], M_CHAR)

# ---------------------------------------------------------------- camera prop (replaces the WIP dome)
dome_lo, dome_hi = wbbox(O["Archive_CameraDome"])
cam_base = Vector(((dome_lo.x + dome_hi.x) / 2, (dome_lo.y + dome_hi.y) / 2, dome_lo.z))
bm = bmesh.new()
add_box(bm, (4.2, 11, 5.6), (0, 0, 2.8), mi=0)                     # leatherette body
add_box(bm, (4.4, 11.2, 1.6), (0, 0, 6.4), mi=1)                   # silver top plate
add_box(bm, (3.4, 3.6, 1.8), (0, 0.2, 8.0), mi=1)                  # viewfinder hump
add_box(bm, (1.2, 2.4, 5.4), (-2.4, 4.4, 2.9), mi=0)               # grip
add_cyl(bm, 2.7, 3.6, (-3.9, 0.2, 3.2), (0, rad(90), 0), mi=2, segs=20)
add_cyl(bm, 2.95, 0.7, (-2.5, 0.2, 3.2), (0, rad(90), 0), mi=1, segs=20)
add_cyl(bm, 2.95, 0.5, (-5.4, 0.2, 3.2), (0, rad(90), 0), mi=1, segs=20)
add_cyl(bm, 2.1, 0.1, (-5.72, 0.2, 3.2), (0, rad(90), 0), mi=3, segs=20)
add_cyl(bm, 0.6, 0.6, (0.2, 3.8, 7.5), mi=1, segs=10)              # shutter
add_cyl(bm, 1.1, 0.8, (0.2, -3.6, 7.6), mi=2, segs=14)             # dial
add_box(bm, (0.8, 0.6, 1.0), (0, 5.75, 6.0), mi=1)                 # strap lugs
add_box(bm, (0.8, 0.6, 1.0), (0, -5.75, 6.0), mi=1)
camprop = mk("CameraProp", bm, [M_CHAR2, M_METAL, M_CHAR, M_LENS], C_PDESK, smooth_angle=40,
             loc=cam_base, rot=(0, 0, rad(-25)))
bevel(camprop, 0.25, 2)
camprop["interactive"] = "camera"

# ---------------------------------------------------------------- existing desk props: materials + fixes
assign(O["Desk_Top"], M_OAK)
assign(O["Desk_Legs"], M_CHAR)
assign(O["Keyboard"], M_CREAM2)
assign(O["Mouse"], M_CREAM)
assign(O["MousePad"], M_SAGED)
assign(O["Mug"], M_TERRA)
assign(O["PencilHolder"], M_SAGE)
for i, m in enumerate([M_MUST, M_TERRA, M_BLUE, M_SAGE], 1):
    assign(O[f"Pencil_{i}"], m)
assign(O["Calendar_Stand"], M_CREAM)
assign(O["Calendar_Rings"], M_CHAR)
assign(O["DeskPlant_Pot"], M_TERRA)
assign(O["DeskPlant_Soil"], M_SOIL)
for i, m in enumerate([M_MUST, M_BLUSH, M_CREAM], 1):
    assign(O[f"DeskPlant_Flower_{i}"], m)
    assign(O[f"DeskPlant_Stem_{i}"], M_LEAF2)
for o in D.objects:
    if o.name.startswith("Keyboard_Key"):
        lo, hi = wbbox(o)
        if o.name == "Keyboard_Keys_Arrows" or lo.x < 65:
            assign(o, M_SAGE)
        elif (hi.y - lo.y) < 3:
            assign(o, M_TERRA)
        else:
            assign(o, M_CREAM)
for n in ["Shelf_1", "Shelf_2", "Shelf_3"]:
    assign(O[n], M_OAK)
for o in [O["Mug"], O["Calendar_Stand"]]:
    o["interactive"] = o.name.lower().split("_")[0]

# the pot was authored partly below the desk surface: lift the whole plant onto the desk
pot_lo, _ = wbbox(O["DeskPlant_Pot"])
lift = max(0.0, DESK_TOP - pot_lo.z)
soil = O["DeskPlant_Soil"]
dp = empty("DeskPlant", C_PDESK, soil.matrix_world.translation.copy(), size=4)
dp["interactive"] = "plant"
for n in ["DeskPlant_Pot", "DeskPlant_Soil"]:
    set_parent(O[n], dp)
dp_sway = empty("DeskPlant_Sway", C_PDESK, soil.matrix_world.translation.copy(), size=3)
set_parent(dp_sway, dp)
for i in (1, 2, 3):
    set_parent(O[f"DeskPlant_Flower_{i}"], dp_sway)
dp.location.z += lift
print(f"DESKPLANT lifted by {lift:.2f}")

# mug steam anchor at the rim centre
mug_pts = eval_world_verts(O["Mug"])
mz = max(p.z for p in mug_pts)
rim = [p for p in mug_pts if p.z > mz - 0.25]
rc = sum(rim, Vector()) / len(rim)
a_steam = empty("Anchor_MugSteam", C_ANCH, (rc.x, rc.y, mz + 1.0), size=2)

# ---------------------------------------------------------------- shelves: books, plants, frames
BOOK_MATS = [M_TERRA, M_SAGE, M_MUST, M_BLUE, M_CREAM2, M_BROWN, M_SAGED, M_BLUSH, M_CHAR]


def add_book(bm, dims, center, rot=(0, 0, 0), cover_mi=0, pages_mi=9):
    """dims = (depth X, thickness Y, height Z). Spine faces -X; fore-edge + top/bottom show pages."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r["verts"]
    bm.normal_update()
    for f in faces_of(vs):
        n = f.normal
        f.material_index = pages_mi if (n.x > 0.5 or abs(n.z) > 0.5) else cover_mi
    bmesh.ops.transform(bm, matrix=M(center, rot, dims), verts=vs)


def shelf_info(n):
    lo, hi = wbbox(O[n])
    return lo, hi


def upright_row(bm, y0, top, count, hmax, back, direction=1):
    y = y0
    for _ in range(count):
        t = random.uniform(1.8, 3.4)
        h = random.uniform(hmax - 6, hmax)
        d = random.uniform(11, 14.5)
        y += direction * t / 2
        add_book(bm, (d, t, h), (back - d / 2, y, top + h / 2), cover_mi=random.randrange(len(BOOK_MATS)))
        y += direction * (t / 2 + 0.15)
    return y


def lying_stack(bm, y, top, count, back):
    z = top
    for k in range(count):
        t = random.uniform(2.0, 3.0)
        d = random.uniform(12, 15)
        w = random.uniform(15, 19)
        add_book(bm, (d, t, w), (back - d / 2 - random.uniform(0, 1), y, z + t / 2),
                 rot=(rad(90), 0, rad(random.uniform(-6, 6))), cover_mi=random.randrange(len(BOOK_MATS)))
        z += t
    return z


def lean_book(bm, y, top, back, lean=14, h=19, t=2.6, d=13):
    a = rad(lean)
    cy = y + h / 2 * math.sin(a) + t / 2
    cz = top + h / 2 * math.cos(a) + t / 2 * math.sin(a)
    add_book(bm, (d, t, h), (back - d / 2, cy, cz), rot=(a, 0, 0), cover_mi=random.randrange(len(BOOK_MATS)))


def standing_frame(bm, center, mi_frame, mi_photo, w=8, h=10):
    x, y, z = center
    add_box(bm, (1.0, w, h), (x, y, z + h / 2), rot=(0, rad(-10), 0), mi=mi_frame)
    add_box(bm, (0.2, w - 1.8, h - 1.8), (x - 0.55, y, z + h / 2), rot=(0, rad(-10), 0), mi=mi_photo)


books_mats = BOOK_MATS + [M_PAGES]

lo, hi = shelf_info("Shelf_1")
BACK = min(hi.x, wall_x(lo.y)) - 0.5
bm = bmesh.new()
y = upright_row(bm, lo.y + 2, hi.z, 7, 22, BACK)
lean_book(bm, y + 0.2, hi.z, BACK)
lying_stack(bm, hi.y - 9, hi.z, 2, BACK)
mk("Shelf_1_Books", bm, books_mats, C_PSHELF)
bevel(O["Shelf_1_Books"], 0.15, 1)
bm = bmesh.new()
add_succulent(bm, (BACK - 7, lo.y + 36, hi.z), 1.1)
standing_frame(bm, (BACK - 5, hi.y - 9, hi.z + 5.2), 3, 4)
mk("Shelf_1_Decor", bm, [M_TERRA, M_SAGE, M_SOIL, M_OAKD, M_BLUE], C_PSHELF, smooth_angle=50)

lo, hi = shelf_info("Shelf_2")
BACK = min(hi.x, wall_x(lo.y)) - 0.5
bm = bmesh.new()
lying_stack(bm, lo.y + 10, hi.z, 3, BACK)
y = upright_row(bm, lo.y + 20, hi.z, 8, 21, BACK)
lean_book(bm, y + 0.2, hi.z, BACK, lean=12, h=18)
mk("Shelf_2_Books", bm, books_mats, C_PSHELF)
bevel(O["Shelf_2_Books"], 0.15, 1)

# trailing pothos on shelf 2 with two vines over the front edge
bm = bmesh.new()
px, py, pz = BACK - 8, hi.y - 7, hi.z
add_cyl(bm, 4.0, 6.0, (px, py, pz + 3.0), mi=0, segs=14, r2=4.6)
add_cyl(bm, 4.1, 0.3, (px, py, pz + 5.6), mi=2, segs=14)
for k in range(8):
    a = 2 * math.pi * k / 8
    add_sphere(bm, 1.6, (px + math.cos(a) * 2.6, py + math.sin(a) * 2.6, pz + 7.0 + (k % 3) * 0.6),
               scale=(1.2, 0.8, 0.35), rot=(rad(20), 0, a), mi=1, u=8, v=6)
front_x = lo.x - 0.5
for vy, length in [(py - 2.5, 7), (py + 2.0, 5)]:
    pts = [(px - 3, vy, pz + 6), (front_x + 1, vy, pz + 4), (front_x - 0.5, vy, pz)]
    for k in range(1, length + 1):
        pts.append((front_x - 0.8 - 0.3 * math.sin(k), vy + 0.6 * math.sin(k * 1.3), pz - 3.2 * k))
    sweep(bm, pts, circle_profile(0.18, 4), (0, 1, 0), mi=1)
    for k, p in enumerate(pts[2:]):
        add_sphere(bm, 1.2, (p[0] - 0.6, p[1] + (0.8 if k % 2 else -0.8), p[2]), scale=(0.35, 1.1, 0.9),
                   mi=1 if k % 2 else 3, u=6, v=5)
pothos = mk("Shelf_2_Pothos", bm, [M_CREAM, M_LEAF, M_SOIL, M_LEAF2], C_PSHELF, smooth_angle=60)

lo, hi = shelf_info("Shelf_3")
BACK = min(hi.x, wall_x(lo.y)) - 0.5
bm = bmesh.new()
upright_row(bm, hi.y - 2, hi.z, 6, 18, BACK, direction=-1)
mk("Shelf_3_Books", bm, books_mats, C_PSHELF)
bevel(O["Shelf_3_Books"], 0.15, 1)
bm = bmesh.new()
gx, gy = BACK - 8, lo.y + 12
add_cyl(bm, 3.0, 0.8, (gx, gy, hi.z + 0.4), mi=0, segs=16)
add_cyl(bm, 0.3, 3.2, (gx, gy, hi.z + 2.4), mi=0, segs=6)
add_sphere(bm, 5.2, (gx, gy, hi.z + 8.6), rot=(0, rad(23), 0), mi=1, u=20, v=12)
standing_frame(bm, (BACK - 5, lo.y + 28, hi.z), 2, 3, w=9, h=12)
mk("Shelf_3_Decor", bm, [M_OAKD, M_BLUE, M_CHAR, M_BLUSH], C_PSHELF, smooth_angle=50)

# ---------------------------------------------------------------- wall: clock, pinboard, art, string lights
CLX, CLZ = 100.0, 160.0
bm = bmesh.new()
add_cyl(bm, 10, 2.4, (0, 1.2, 0), (rad(90), 0, 0), mi=0, segs=32)
add_cyl(bm, 9.0, 0.2, (0, 2.5, 0), (rad(90), 0, 0), mi=1, segs=32)
for k in range(12):
    a = 2 * math.pi * k / 12
    L = 1.6 if k % 3 == 0 else 0.9
    add_box(bm, (0.5 if k % 3 else 0.7, 0.15, L), (7.6 * math.sin(a), 2.65, 7.6 * math.cos(a)), rot=(0, a, 0), mi=2)
clock = mk("Clock_Body", bm, [M_OAK, M_CREAM, M_CHAR], C_PWALL, smooth_angle=40, loc=(CLX, WALLY, CLZ))
clock["interactive"] = "clock"
bm = bmesh.new()
add_box(bm, (0.9, 0.25, 5.5), (0, 0, 2.25), mi=0)
add_cyl(bm, 0.7, 0.4, (0, 0, 0), (rad(90), 0, 0), mi=0, segs=10)
hand_h = mk("Clock_HandHour", bm, [M_CHAR], C_PWALL, parent=clock, loc=(0, 2.85, 0))
bm = bmesh.new()
add_box(bm, (0.6, 0.25, 8.2), (0, 0, 3.4), mi=0)
hand_m = mk("Clock_HandMinute", bm, [M_TERRA], C_PWALL, parent=clock, loc=(0, 3.15, 0))
hand_h.rotation_euler = (0, rad(-305), 0)   # 10:10
hand_m.rotation_euler = (0, rad(-60), 0)

# pinboard between the shelves, above the monitor
PBY, PBZ, PBW, PBH = -19.0, 143.0, 42.0, 30.0
bm = bmesh.new()
add_box(bm, (1.2, PBW - 2, PBH - 2), (-0.6, 0, 0), mi=1)
for dy, dz, sy, sz in [(0, PBH / 2 - 0.8, PBW, 1.6), (0, -PBH / 2 + 0.8, PBW, 1.6),
                       (PBW / 2 - 0.8, 0, 1.6, PBH), (-PBW / 2 + 0.8, 0, 1.6, PBH)]:
    add_box(bm, (1.8, sy, sz), (-0.9, dy, dz), mi=0)
items = [(-12, 4, 6, 7, 3, 8), (-3, 6, 6, 7, -4, 4), (8, 3, 6, 7, 5, 3), (14, -6, 4.2, 4.2, -8, 5),
         (-13, -7, 4.2, 4.2, 6, 6), (1, -7, 6, 7, 2, 7)]
for dy, dz, w, h, ang, mi in items:
    rot = (rad(ang), 0, 0)
    if w > 5:  # polaroid: white card + photo
        add_box(bm, (0.12, w, h), (-1.3, dy, dz), rot=rot, mi=2)
        add_box(bm, (0.08, w - 1.0, w - 1.0), (-1.4, dy, dz + 0.5), rot=rot, mi=mi)
    else:      # sticky note
        add_box(bm, (0.1, w, h), (-1.3, dy, dz), rot=rot, mi=mi)
    add_sphere(bm, 0.4, (-1.6, dy, dz + h / 2 - 0.8), mi=4, u=6, v=4)
mk("Pinboard", bm, [M_OAKD, M_CORK, M_WHITE, M_SAGE, M_TERRA, M_MUST, M_BLUSH, M_BLUE, M_SAGED],
   C_PWALL, smooth_angle=40, loc=(wall_x(PBY), PBY, PBZ), rot=(0, 0, WALL_ANG))

# framed print on the -Y wall (sun over hills)
AX, AZ = -82.0, 138.0
bm = bmesh.new()
add_box(bm, (28, 1.6, 36), (AX, WALLY + 0.8, AZ), mi=0)
add_box(bm, (24, 0.2, 32), (AX, WALLY + 1.65, AZ), mi=1)
add_box(bm, (19, 0.2, 25), (AX, WALLY + 1.75, AZ + 0.5), mi=2)
add_cyl(bm, 4.5, 0.2, (AX, WALLY + 1.85, AZ + 5), (rad(90), 0, 0), mi=3, segs=24)
add_box(bm, (19, 0.25, 8), (AX, WALLY + 1.9, AZ - 4.5), mi=4)
add_box(bm, (19, 0.3, 4), (AX, WALLY + 1.95, AZ - 10.0), mi=5)
mk("WallArt_Print", bm, [M_CHAR, M_WHITE, M_BLUSH, M_MUST, M_SAGE, M_SAGED], C_PWALL)

# string lights hung on hooks, standing off the +X wall
SLX, SLZ, SAG, SPAN = WALLX - 4.5, 190.0, 6.0, 61.33
ys = [-112 + 184 * k / 72 for k in range(73)]
wire = [(wall_x(y) - 4.5, y, SLZ - SAG * math.sin(math.pi * ((y + 112) % SPAN) / SPAN)) for y in ys]
bm = bmesh.new()
sweep(bm, wire, circle_profile(0.25, 5), (1, 0, 0), mi=0)
for k in range(4):
    hy_ = -112 + SPAN * k
    add_beam(bm, (wall_x(hy_), hy_, SLZ + 0.8), (wall_x(hy_) - 4.8, hy_, SLZ + 0.8), 0.6, 0.6, mi=0)
    add_cyl(bm, 0.7, 1.0, (wall_x(hy_) - 0.5, hy_, SLZ + 0.8), (0, rad(90), 0), mi=0, segs=8)
for k in range(3, 72, 3):
    x, y, z = wire[k]
    add_beam(bm, (x, y, z), (x, y, z - 2.2), 0.3, 0.3, mi=0)
    add_cyl(bm, 0.55, 1.0, (x, y, z - 2.6), mi=0, segs=8)
mk("StringLights_Wire", bm, [M_CHAR], C_PWALL, smooth_angle=60)
bm = bmesh.new()
for k in range(3, 72, 3):
    x, y, z = wire[k]
    add_sphere(bm, 1.5, (x, y, z - 4.6), scale=(1, 1, 1.35), u=10, v=8)
fairy = mk("StringLights_Bulbs", bm, [M_FAIRY], C_PWALL, smooth_angle=80)

# ---------------------------------------------------------------- floor: chair, pouf, plant, books
CHX, CHY = 24.0, -52.0
chair = empty("Chair", C_PFLOOR, (CHX, CHY, FLOOR), size=8)
chair.rotation_euler = (0, 0, rad(28))
chair["interactive"] = "chair"
bm = bmesh.new()
for k in range(5):
    a = 2 * math.pi * k / 5
    add_box(bm, (22, 2.6, 2.2), (math.cos(a) * 11, math.sin(a) * 11, 6.0), rot=(0, 0, a), mi=0)
    add_sphere(bm, 2.0, (math.cos(a) * 22, math.sin(a) * 22, 2.0), mi=1, u=10, v=6)
add_cyl(bm, 4.0, 3.0, (0, 0, 6.0), mi=0, segs=16)
add_cyl(bm, 1.8, 32, (0, 0, 22.0), mi=2, segs=12)
ch_base = mk("Chair_Base", bm, [M_CHAR, M_CHAR2, M_METAL], C_PFLOOR, smooth_angle=40, parent=chair)
ch_sw = empty("Chair_Swivel", C_PFLOOR, (0, 0, 38), parent=chair, size=5)
bm = bmesh.new()
add_box(bm, (44, 44, 7), (0, 0, 4.5), mi=0)
add_box(bm, (28, 28, 2), (0, 0, 0.5), mi=1)
ch_seat = mk("Chair_Seat", bm, [M_CREAM2, M_CHAR], C_PFLOOR, parent=ch_sw)
bevel(ch_seat, 2.5, 3, 30)
bm = bmesh.new()
add_box(bm, (5, 40, 36), (-22, 0, 33), rot=(0, rad(-8), 0), mi=0)
add_box(bm, (3, 6, 22), (-21.5, 0, 11), rot=(0, rad(-4), 0), mi=1)
ch_back = mk("Chair_Back", bm, [M_CREAM2, M_CHAR], C_PFLOOR, parent=ch_sw)
bevel(ch_back, 2.0, 3, 30)

POUF_R, POUF_H, POUF_BEV = 27.0, 24.0, 9.0
PCX, PCY = -50.0, 28.0
bm = bmesh.new()
add_cyl(bm, POUF_R, POUF_H, (0, 0, POUF_H / 2), segs=36)
pouf = mk("Pouf", bm, [M_MUST], C_PFLOOR, smooth_angle=40, loc=(PCX, PCY, RUG_TOP))
bevel(pouf, POUF_BEV, 6, 60).use_clamp_overlap = False

bm = bmesh.new()
z = 0
for k, (d, w, t, ang) in enumerate([(17, 23, 3.0, 5), (15, 21, 2.6, -9), (14, 19, 2.2, 14)]):
    add_book(bm, (d, t, w), (0, 0, z + t / 2), rot=(rad(90), 0, rad(ang)), cover_mi=[3, 0, 6][k])
    z += t
mk("Floor_Books", bm, books_mats, C_PFLOOR, loc=(-6, 66, RUG_TOP))
bevel(O["Floor_Books"], 0.15, 1)

FPX, FPY = 104.0, 100.0
fp = empty("FloorPlant", C_PFLOOR, (FPX, FPY, FLOOR), size=8)
fp["interactive"] = "plant"
bm = bmesh.new()
add_cyl(bm, 10.5, 26, (0, 0, 13), segs=24, r2=12.5)
add_cyl(bm, 13.0, 2.0, (0, 0, 26), segs=24, mi=0)
add_cyl(bm, 11.8, 0.4, (0, 0, 25.0), segs=24, mi=1)
fp_pot = mk("FloorPlant_Pot", bm, [M_CREAM, M_SOIL], C_PFLOOR, smooth_angle=40, parent=fp)
fp_sway = empty("FloorPlant_Sway", C_PFLOOR, (0, 0, 25), parent=fp, size=5)
bm = bmesh.new()


def add_leaf(bm, base, yaw_a, elev, L, W, droop, mi):
    base = Vector(base)
    fwd = lambda e: Vector((math.cos(yaw_a) * math.cos(e), math.sin(yaw_a) * math.cos(e), math.sin(e)))
    side = Vector((-math.sin(yaw_a), math.cos(yaw_a), 0))
    p = base.copy()
    secs = []
    n = 7
    for k in range(n + 1):
        u = k / n
        e = elev - droop * u * u
        w = W * (math.sin(math.pi * min(u * 1.05, 1.0)) ** 0.7) + 0.05
        up = side.cross(fwd(e)).normalized()
        secs.append([bm.verts.new(p + side * w / 2 + up * w * 0.15), bm.verts.new(p),
                     bm.verts.new(p - side * w / 2 + up * w * 0.15)])
        p = p + fwd(e) * (L / n)
    for k in range(n):
        a, b = secs[k], secs[k + 1]
        for f in (bm.faces.new((a[0], a[1], b[1], b[0])), bm.faces.new((a[1], a[2], b[2], b[1]))):
            f.material_index = mi


for k in range(10):
    a = 2 * math.pi * k / 10 + random.uniform(-0.2, 0.2)
    h = random.uniform(14, 30)
    tip = (math.cos(a) * 4, math.sin(a) * 4, h)
    sweep(bm, [(0, 0, 0), (tip[0] * 0.5, tip[1] * 0.5, h * 0.6), tip], circle_profile(0.35, 5), (1, 0, 0), mi=2)
    add_leaf(bm, tip, a, rad(random.uniform(25, 50)), random.uniform(16, 22), random.uniform(8, 11),
             rad(random.uniform(50, 80)), k % 2)
leaves = mk("FloorPlant_Leaves", bm, [M_LEAF, M_LEAF2, M_SAGED], C_PFLOOR, smooth_angle=70, parent=fp_sway)

# ---------------------------------------------------------------- more props: drawers, easel, blanket, slippers
M_BRASS = mat("M_Brass", "#C9A25A", 0.35, 0.85)
M_BLANKET = mat("M_Blanket", "#E9DCC6", 1.0)
M_BLANKET_STRIPE = mat("M_BlanketStripe", P["terracotta"], 1.0)
M_CANVAS = mat("M_CanvasArt", "#F1E6D6", 0.9)


def add_disc(bm, loc, scale, mi=0, segs=20, rot=(0, 0, 0)):
    r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=1, radius2=1, depth=1,
                              matrix=M(loc, rot, scale))
    tag(r["verts"], mi)
    return r["verts"]


# --- chest of drawers against the +X wall, beside the desk (fronts face -X, into the room)
DRW_Y0, DRW_Y1 = 31.0, 79.0
DRW_D, LEG_H, BODY_H = 34.0, 8.0, 58.0
dx1 = wall_x(DRW_Y0) - 0.6
dx0 = dx1 - DRW_D
dyc, dw = (DRW_Y0 + DRW_Y1) / 2, DRW_Y1 - DRW_Y0
z0, z1 = FLOOR + LEG_H, FLOOR + LEG_H + BODY_H
dresser = empty("Dresser", C_PFLOOR, ((dx0 + dx1) / 2, dyc, FLOOR), size=8)
bm = bmesh.new()
t = 1.8
add_box(bm, (DRW_D + 1.0, dw + 1.0, 2.2), (-0.5, 0, LEG_H + BODY_H + 1.1), mi=1)       # oak top
add_box(bm, (DRW_D, dw, t), (0, 0, LEG_H + t / 2), mi=0)                               # bottom
for sy in (-1, 1):
    add_box(bm, (DRW_D, t, BODY_H), (0, sy * (dw / 2 - t / 2), LEG_H + BODY_H / 2), mi=0)
add_box(bm, (t, dw, BODY_H), (DRW_D / 2 - t / 2, 0, LEG_H + BODY_H / 2), mi=0)          # back
for sx in (-1, 1):
    for sy in (-1, 1):
        add_cyl(bm, 1.6, LEG_H, (sx * (DRW_D / 2 - 3), sy * (dw / 2 - 3), LEG_H / 2), mi=1, segs=10, r2=1.9)
d_body = mk("Dresser_Body", bm, [M_SAGE, M_OAK], C_PFLOOR, parent=dresser)
bevel(d_body, 0.3, 2)
gap = 0.4
inner_h = BODY_H - t - 2 * gap
fh = (inner_h - 2 * gap) / 3
fw = dw - 2 * t - 2 * gap
for i in range(3):
    zc = LEG_H + BODY_H - gap - fh / 2 - i * (fh + gap)
    bm = bmesh.new()
    add_box(bm, (t, fw, fh), (0, 0, 0), mi=0)                                          # front
    bd = DRW_D - t - 3.0
    bh = fh - 4.0
    add_box(bm, (bd, fw - 2.0, 1.0), (t / 2 + bd / 2, 0, -bh / 2 + 0.5), mi=1)          # drawer box bottom
    for sy in (-1, 1):
        add_box(bm, (bd, 1.0, bh), (t / 2 + bd / 2, sy * (fw / 2 - 1.5), 0), mi=1)
    add_box(bm, (1.0, fw - 2.0, bh), (t / 2 + bd - 0.5, 0, 0), mi=1)
    add_sphere(bm, 1.3, (-t / 2 - 1.0, 0, 0), scale=(0.8, 1, 1), mi=2, u=10, v=6)
    add_cyl(bm, 0.5, 1.2, (-t / 2 - 0.4, 0, 0), (0, rad(90), 0), mi=2, segs=8)
    drw = mk(f"Drawer_{i + 1}", bm, [M_SAGE, M_OAKD, M_BRASS], C_PFLOOR, smooth_angle=45, parent=dresser,
             loc=(-DRW_D / 2 + t / 2, 0, zc))
    bevel(drw, 0.25, 2)
    drw["interactive"] = "drawer"
    x_closed = drw.location.x
    for f, v in [(1, 0.0), (10, -15.0), (14, -14.0)]:
        drw.location.x = x_closed + v
        drw.keyframe_insert("location", index=0, frame=f)
    push_nla(drw, f"Drawer_{i + 1}_Open")
    drw.location.x = x_closed

# dresser top: vase of dried pampas + two books
top_z = z1 + 2.2
bm = bmesh.new()
vx, vy = dx0 + 15, DRW_Y1 - 10
add_cyl(bm, 3.2, 14, (vx, vy, top_z + 7), mi=0, segs=16, r2=2.0)
add_sphere(bm, 4.2, (vx, vy, top_z + 4.5), scale=(1, 1, 0.9), mi=0, u=16, v=10)
for k in range(6):
    a = 2 * math.pi * k / 6
    tip = Vector((vx + math.cos(a) * 7, vy + math.sin(a) * 7, top_z + 34 + (k % 3) * 4))
    sweep(bm, [(vx, vy, top_z + 12), ((vx + tip.x) / 2, (vy + tip.y) / 2, top_z + 24), tip], circle_profile(0.2, 4), (1, 0, 0), mi=1)
    add_sphere(bm, 1.6, tuple(tip + Vector((0, 0, 3.0))), scale=(1, 1, 3.2), mi=2, u=8, v=6)
mk("Dresser_Vase", bm, [M_CREAM, M_BROWN, M_CREAM2], C_PFLOOR, smooth_angle=60)
bm = bmesh.new()
z = top_z
for k, (d, w, th, ang) in enumerate([(16, 22, 2.8, -4), (14, 20, 2.2, 9)]):
    add_book(bm, (d, th, w), (dx0 + 12, DRW_Y0 + 14, z + th / 2), rot=(rad(90), 0, rad(ang)), cover_mi=[1, 7][k])
    z += th
mk("Dresser_Books", bm, books_mats, C_PFLOOR)
bevel(O["Dresser_Books"], 0.15, 1)

# --- easel by the window, catching the daylight
EX, EY = -64.0, -90.0
easel = empty("Easel", C_PFLOOR, (EX, EY, FLOOR), size=10)
easel.rotation_euler = (0, 0, rad(17))
easel["interactive"] = "easel"
lean = math.atan2(10, 172)
bm = bmesh.new()
for sx in (-1, 1):
    add_beam(bm, (sx * 24, 8, 0), (sx * 2.5, -2, 172), 3.0, 2.4)
add_beam(bm, (0, -2, 168), (0, -48, 0), 2.6, 2.4)
add_beam(bm, (0, 7.5, 12), (0, -2.2, 178), 3.4, 2.2)
leg_at = lambda z: (24 - 21.5 * z / 172, 8 - 10 * z / 172)
lx, ly = leg_at(40)
add_beam(bm, (-lx, ly, 40), (lx, ly, 40), 2.0, 2.0)
tz = 76.0
_, ty = leg_at(tz)
add_box(bm, (58, 6.0, 2.4), (0, ty + 2.5, tz), mi=0)
add_box(bm, (58, 1.0, 2.0), (0, ty + 5.3, tz + 2.0), mi=0)
add_box(bm, (6, 4, 3), (0, -2.2 + 10 * (1 - 139 / 172) + 2.2, 139), mi=0)
easel_frame = mk("Easel_Frame", bm, [M_OAK], C_PFLOOR, parent=easel)
bevel(easel_frame, 0.3, 1)

cw, ch, cd = 48.0, 60.0, 2.4
ccy = ty + 2.5 - 0.5 - (ch / 2) * math.sin(lean)
ccz = tz + 1.2 + (ch / 2) * math.cos(lean)
bm = bmesh.new()
add_box(bm, (cw, cd, ch), (0, ccy, ccz), rot=(lean, 0, 0), mi=0)
canvas = mk("Easel_Canvas", bm, [M_WHITE], C_PFLOOR, parent=easel)
bevel(canvas, 0.2, 1)
up = Vector((0, -math.sin(lean), math.cos(lean)))
nrm = Vector((0, math.cos(lean), math.sin(lean)))
c0 = Vector((0, ccy, ccz)) + nrm * (cd / 2 + 0.05)
bm = bmesh.new()
quad(bm, c0, (-1, 0, 0), up, cw - 0.6, ch - 0.6, mi=0)                          # 0-1 UV surface for textures
for off, (ox, oz, w, h, mi) in enumerate([(0, 12, 46, 34, 1), (0, -9, 46, 12, 2), (-8, -17, 30, 10, 3)]):
    quad(bm, c0 + nrm * (0.05 * (off + 1)) + Vector((-ox, 0, 0)) + up * oz, (-1, 0, 0), up, w, h, mi=mi)
r = bmesh.ops.create_circle(bm, cap_ends=True, segments=20, radius=6.5,
                            matrix=Matrix.LocRotScale(c0 + nrm * 0.2 + up * 15 + Vector((-9, 0, 0)),
                                                      nrm.to_track_quat("Z", "Y"), Vector((1, 1, 1))))
tag(r["verts"], 4)
painting = mk("Easel_Painting", bm, [M_CANVAS, M_BLUSH, M_SAGE, M_SAGED, M_MUST], C_PFLOOR, uv=None, parent=easel)
painting["interactive"] = "easel"

# art stool with palette and brush jar
SX, SY = -26.0, -96.0
bm = bmesh.new()
add_cyl(bm, 14, 3, (0, 0, 44.5), mi=0, segs=24)
for k in range(3):
    a = 2 * math.pi * k / 3 + 0.3
    add_beam(bm, (math.cos(a) * 15, math.sin(a) * 15, 0), (math.cos(a) * 9, math.sin(a) * 9, 43.5), 2.2, 2.2, mi=0)
    add_beam(bm, (math.cos(a) * 12.5, math.sin(a) * 12.5, 15), (math.cos(a + 2.09) * 12.5, math.sin(a + 2.09) * 12.5, 15),
             1.4, 1.4, mi=0)
add_disc(bm, (3, -3, 46.4), (9.5, 7.0, 0.6), mi=1, segs=20, rot=(0, 0, rad(-20)))
for k, mi in enumerate([2, 3, 4, 5, 6]):
    a = rad(-60 + 32 * k)
    add_sphere(bm, 1.3, (3 + math.cos(a) * 6.5, -3 + math.sin(a) * 4.5, 46.9), scale=(1, 1, 0.45), mi=mi, u=8, v=5)
add_cyl(bm, 3.0, 9, (-6, 5, 46 + 4.5), mi=7, segs=14)
for k, mi in enumerate([3, 4, 6, 2]):
    a = 2 * math.pi * k / 4
    p0 = Vector((-6 + math.cos(a) * 1.3, 5 + math.sin(a) * 1.3, 48))
    p1 = p0 + Vector((math.cos(a) * 2.5, math.sin(a) * 2.5, 17))
    add_beam(bm, p0, p1, 0.6, 0.6, mi=0)
    add_beam(bm, p1, p1 + (p1 - p0).normalized() * 3, 0.9, 0.9, mi=mi)
mk("ArtStool", bm, [M_OAKD, M_OAK, M_TERRA, M_MUST, M_BLUE, M_SAGE, M_BLUSH, M_CREAM], C_PFLOOR, smooth_angle=45,
   loc=(SX, SY, FLOOR))

# --- blanket draped over the pouf, pooling on the rug
pouf_top = RUG_TOP + POUF_H + 0.6
bm = bmesh.new()
uvl = bm.loops.layers.uv.new()
NU, NV, BW, BL = 48, 42, 104.0, 92.0
ang0 = rad(25)
ca, sa = math.cos(ang0), math.sin(ang0)
off = Vector((6.0, -5.0))
grid, uvd = [], {}
for jv in range(NV + 1):
    row = []
    for iu in range(NU + 1):
        u, v = iu / NU, jv / NV
        lx, ly = (u - 0.5) * BW, (v - 0.5) * BL
        px, py = off.x + lx * ca - ly * sa, off.y + lx * sa + ly * ca
        d = math.hypot(px, py)
        a = math.atan2(py, px)
        r_top = POUF_R - POUF_BEV
        if d <= r_top:
            x, y, z = px, py, pouf_top + 0.4 * math.sin(px * 0.3) * math.cos(py * 0.25)
        else:
            # follow the pouf's rounded top edge (bevel radius 4), then hang, then pool on the rug
            s_ = d - r_top
            ro = POUF_BEV + 0.7
            edge_z = pouf_top - 0.6 - POUF_BEV
            fold = 1.4 * (0.5 + 0.5 * math.sin(a * 9 + v * 3)) * min(s_ / 8, 1)
            if s_ < ro * math.pi / 2:
                phi = s_ / ro
                rr, z = r_top + ro * math.sin(phi) + fold * phi / (math.pi / 2), edge_z + ro * math.cos(phi)
            else:
                s2 = s_ - ro * math.pi / 2
                z = edge_z - s2
                rr = POUF_R + 0.7 + fold
                if z < RUG_TOP + 0.5:
                    rr += (RUG_TOP + 0.5 - z) * 0.95
                    z = RUG_TOP + 0.5 + 0.5 * max(0, math.sin(a * 5 + u * 4))
            x, y = rr * math.cos(a), rr * math.sin(a)
        vt = bm.verts.new((x, y, z))
        uvd[vt] = (u, v)
        row.append(vt)
    grid.append(row)
for jv in range(NV):
    stripe = 1 if (jv in (4, 5, NV - 6, NV - 5)) else 0
    for iu in range(NU):
        f = bm.faces.new((grid[jv][iu], grid[jv][iu + 1], grid[jv + 1][iu + 1], grid[jv + 1][iu]))
        f.material_index = stripe
bm.normal_update()
if sum(f.normal.z for f in bm.faces) < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
for f in bm.faces:
    for l in f.loops:
        l[uvl].uv = uvd[l.vert]
mk("Blanket", bm, [M_BLANKET, M_BLANKET_STRIPE], C_PFLOOR, uv=None, smooth_angle=89, loc=(PCX, PCY, 0))

# --- slippers on the rug
bm = bmesh.new()
for (px, py, yaw_s) in [(-10.0, -14.0, 205.0), (3.0, -24.0, 222.0)]:
    vs = []
    vs += add_disc(bm, (0, 0, 0.7), (13.5, 5.2, 1.4), mi=0, segs=20)
    vs += add_sphere(bm, 1.0, (5.0, 0, 1.2), scale=(8.8, 5.6, 5.0), mi=1, u=16, v=10)
    vs += add_sphere(bm, 2.2, (8.0, 0, 5.6), mi=2, u=10, v=6)
    bmesh.ops.transform(bm, matrix=M((px, py, RUG_TOP), (0, 0, rad(yaw_s))), verts=list(set(vs)))
mk("Slippers", bm, [M_CREAM2, M_BLUSH, M_CREAM], C_PFLOOR, smooth_angle=50)

# ---------------------------------------------------------------- anchors for Three.js lights / camera
a_scr = empty("Anchor_ScreenLight", C_ANCH, (sx - 3, (sy0 + sy1) / 2, (sz0 + sz1) / 2), size=3)
set_parent(a_scr, mon)
empty("Anchor_WindowLight", C_ANCH, (wcx + 30, WT_OUT - 60, wcz + 60), size=6)
empty("Anchor_WindowTarget", C_ANCH, (wcx + 40, -40, FLOOR), size=6)
empty("Anchor_RainGlass", C_ANCH, (wcx, GY + 0.5, wcz), size=4)
empty("Anchor_CameraTarget", C_ANCH, (30, -10, 70), size=6)

# ---------------------------------------------------------------- loops / reactive clips
key_loop(dp_sway, "rotation_euler", 0, 0, rad(2.5), 96)
key_loop(dp_sway, "rotation_euler", 1, 0, rad(1.5), 96, phase=1)
push_nla(dp_sway, "Plant_Sway")
key_loop(fp_sway, "rotation_euler", 0, 0, rad(1.8), 96, phase=1)
key_loop(fp_sway, "rotation_euler", 1, 0, rad(2.2), 96)
push_nla(fp_sway, "Plant_Sway")
for ob, ph in [(cur_l, 0), (cur_r, 1)]:
    key_loop(ob, "rotation_euler", 0, rad(1.6), rad(1.6), 144, phase=ph)
    push_nla(ob, "Curtain_Sway")
key_loop(ch_sw, "rotation_euler", 2, 0, rad(4), 192, phase=1)
push_nla(ch_sw, "Chair_Swivel")

# Sound_Bump: short reaction for loud sounds (headphones swing on the bar, pencils rattle)
for f, v in [(1, 0), (4, 6), (9, -4), (14, 2.5), (19, -1), (25, 0)]:
    hp.rotation_euler[0] = rad(v)
    hp.keyframe_insert("rotation_euler", index=0, frame=f)
push_nla(hp, "Sound_Bump")
hp.rotation_euler[0] = 0
for i in range(1, 5):
    p = O[f"Pencil_{i}"]
    base = p.rotation_euler[0]
    for f, v in [(1, 0), (3 + i % 2, 4), (8, -3), (13, 1.5), (19, 0)]:
        p.rotation_euler[0] = base + rad(v * (1 if i % 2 else -1))
        p.keyframe_insert("rotation_euler", index=0, frame=f)
    push_nla(p, "Sound_Bump")
    p.rotation_euler[0] = base

# ---------------------------------------------------------------- web budget
# viewport subdivision drives the GLB; keep render levels as authored
for n, lv in [("Mug", 1), ("DeskPlant_Pot", 2)]:
    for md in O[n].modifiers:
        if md.type == "SUBSURF":
            md.levels = lv
for ob in D.objects:
    if ob.type == "MESH" and ob.data.users == 1:
        ob.data.name = ob.name

# ---------------------------------------------------------------- root for export scaling
root = empty("StudyRoom", ROOTC, (0, 0, 0), size=20, kind="ARROWS")
C.view_layer.update()
for c in [ROOTC] + list(ROOTC.children_recursive):
    for ob in c.objects:
        if ob.parent is None and ob is not root:
            set_parent(ob, root)

# any mesh still without UVs gets a box projection
for ob in D.objects:
    if ob.type == "MESH" and not ob.data.uv_layers and ob.users_collection[0] not in (C_ARCH,):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        box_uv(bm, 0.05)
        bm.to_mesh(ob.data)
        bm.free()

# ---------------------------------------------------------------- preview lights / camera (not exported)
cam = O["Cam_IsoPreview"]
cam.data.type = "ORTHO"
cam.data.ortho_scale = 300
cam.data.clip_start = 1
cam.data.clip_end = 3000
cam.location = (-400, 400, 380)
cam.rotation_euler = (Vector((35, -15, 80)) - cam.location).to_track_quat("-Z", "Y").to_euler()
S.camera = cam

sun = D.lights.new("Preview_Sun", "SUN")
sun.energy = 3.0
sun.color = srgb("#FFE6C4")[:3]
sun.angle = rad(2)
so = D.objects.new("Preview_Sun", sun)
C_PREV.objects.link(so)
so.rotation_euler = Vector((-0.25, 0.75, -0.6)).to_track_quat("-Z", "Y").to_euler()
pt = D.lights.new("Preview_LampLight", "SPOT")
pt.energy = 4.0e5
pt.color = srgb("#FFD49A")[:3]
pt.spot_size = rad(95)
pt.spot_blend = 0.6
pt.shadow_soft_size = 2
po = D.objects.new("Preview_LampLight", pt)
C_PREV.objects.link(po)
S.frame_set(30)
C.view_layer.update()
po.matrix_world = a_lamp.matrix_world.copy()
lo_t = a_lamp_t.matrix_world.translation
po.rotation_euler = (lo_t - po.location).to_track_quat("-Z", "Y").to_euler()
fill = D.lights.new("Preview_Fill", "AREA")
fill.energy = 3.0e6
fill.size = 300
fill.color = srgb("#FFF4E6")[:3]
fo = D.objects.new("Preview_Fill", fill)
C_PREV.objects.link(fo)
fo.location = (-300, 300, 400)
fo.rotation_euler = (Vector((60, -40, 60)) - fo.location).to_track_quat("-Z", "Y").to_euler()

world = S.world or D.worlds.new("World")
S.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = srgb("#E9DFD3")
bg.inputs["Strength"].default_value = 0.35

S.frame_start, S.frame_end = 1, 193
S.frame_set(1)
S.render.engine = "BLENDER_EEVEE"
C.preferences.filepaths.save_version = 0  # no .blend1 backups for a generated file
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=False)
print("SAVED", OUT_BLEND)
