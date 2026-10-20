"""
Adds the props used by the physics on the website, and prepares the shelf books for it.
Safe to run more than once (it skips what already exists).

  cd blender
  /Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P add_props.py

Then re-run bake_ao.py and export_glb.py.

  - PaperBin  : waste-paper bin on the floor, on the far side of the room (diagonally opposite
                the easel, between the dresser and the floor plant)
  - Notepad   : a pad of paper on the monitor riser — click it on the website to toss a paper ball
  - books     : each shelf's merged book mesh (Shelf_N_Books) is split into one object per book
                (Shelf_N_Book_01 …) with its origin at its centre, so every book can be a physics body
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

C, D = bpy.context, bpy.data
S = C.scene
root = D.objects["StudyRoom"]
props = D.collections["Props_Floor"]
FLOOR_TOP = 4.2  # top of the floor planks (cm)
BIN_AT = (62.0, 106.0, FLOOR_TOP)


def mat(name):
    return D.materials[name]


def finish(name, bm, mats, coll, loc):
    me = D.meshes.new(name)
    uv = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:  # simple box-projected UVs (every mesh in the GLB has a UV map)
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            l[uv].uv *= 0.05
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = D.objects.new(name, me)
    coll.objects.link(ob)
    ob.location = loc
    C.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = root
    ob.matrix_world = mw
    return ob


def smooth(ob, angle=40):
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(angle))


# ---------------------------------------------------------------- waste-paper bin
if "PaperBin" not in D.objects:
    R0, R1, H, T, SEG = 10.5, 12.5, 30.0, 0.7, 28
    bm = bmesh.new()

    def ring(r, z):
        return [bm.verts.new((r * math.cos(2 * math.pi * k / SEG), r * math.sin(2 * math.pi * k / SEG), z)) for k in range(SEG)]

    out0, out1 = ring(R0, 0), ring(R1, H)
    in0, in1 = ring(R0 - T, T), ring(R1 - T, H)
    for k in range(SEG):
        k2 = (k + 1) % SEG
        bm.faces.new((out0[k], out0[k2], out1[k2], out1[k])).material_index = 0      # outer wall
        bm.faces.new((in0[k2], in0[k], in1[k], in1[k2])).material_index = 0         # inner wall
        bm.faces.new((out1[k], out1[k2], in1[k2], in1[k])).material_index = 1       # rim
    bm.faces.new(list(reversed(out0))).material_index = 0                          # bottom (outside)
    bm.faces.new(in0).material_index = 0                                           # floor of the bin
    ob = finish("PaperBin", bm, [mat("M_SageDark"), mat("M_OakDark")], props, BIN_AT)
    smooth(ob)
    ob["interactive"] = "bin"
    print("PROPS added PaperBin")
else:  # keep the bin where it belongs when the script is re-run
    ob = D.objects["PaperBin"]
    C.view_layer.update()
    ob.matrix_world.translation = BIN_AT
    print("PROPS moved PaperBin to", BIN_AT)

# ---------------------------------------------------------------- notepad on the monitor riser
if "Notepad" not in D.objects:
    riser = D.objects["Monitor_Riser"]
    dg = C.evaluated_depsgraph_get()
    ev = riser.evaluated_get(dg)
    top = max((ev.matrix_world @ Vector(c)).z for c in ev.bound_box)
    bm = bmesh.new()
    for k, (dz, rot, mi) in enumerate([(0.3, -4, 0), (0.75, 3, 0), (1.2, -1, 0)]):
        r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale(
            Vector((0, 0, dz)), Matrix.Rotation(math.radians(rot), 3, "Z").to_quaternion(), Vector((14, 10, 0.45))))
        for f in {f for v in r["verts"] for f in v.link_faces}:
            f.material_index = mi
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.LocRotScale(
        Vector((6.2, 0, 1.25)), Matrix.Rotation(math.radians(-1), 3, "Z").to_quaternion(), Vector((1.8, 10.2, 0.6))))
    for f in {f for v in r["verts"] for f in v.link_faces}:
        f.material_index = 1                                                       # binding strip
    ob = finish("Notepad", bm, [mat("M_PaperWhite"), mat("M_Terracotta")], D.collections["Props_Desk"],
                (100.0, -64.0, top))
    ob["interactive"] = "paper"
    print("PROPS added Notepad")

# ---------------------------------------------------------------- one object per shelf book
for shelf in ("Shelf_1_Books", "Shelf_2_Books", "Shelf_3_Books"):
    src = D.objects.get(shelf)
    if not src:
        continue
    prefix = shelf.replace("_Books", "_Book_")
    if C.object and C.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    C.view_layer.objects.active = src
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = list(C.selected_objects)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    parts.sort(key=lambda o: o.matrix_world.translation.y)
    for i, ob in enumerate(parts, 1):
        ob.name = f"{prefix}{i:02d}"
        ob.data.name = ob.name
    print("PROPS split", shelf, "into", len(parts), "books")

C.preferences.filepaths.save_version = 0
bpy.ops.wm.save_mainfile()
print("PROPS saved")
