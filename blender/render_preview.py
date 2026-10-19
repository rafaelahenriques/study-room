"""Render look-dev previews of the enriched room (EEVEE, preview lights only).
Usage (from blender/): Blender -b isometricroom_enriched.blend -P render_preview.py -- [out_dir] [frame] [shots]
"""
import bpy, sys, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else os.path.join(os.path.dirname(bpy.data.filepath), "previews")
frame = int(argv[1]) if len(argv) > 1 else 1
os.makedirs(out, exist_ok=True)
S = bpy.context.scene
S.frame_set(frame)
S.render.engine = "BLENDER_EEVEE"
S.eevee.taa_render_samples = 32
S.render.resolution_x, S.render.resolution_y = 1400, 1050
S.view_settings.view_transform = "AgX"
cam = bpy.data.objects["Cam_IsoPreview"]
S.camera = cam
shots = {
    "iso": ((-400, 400, 380), (30, -5, 82), 345),
    "desk": ((-120, 60, 170), (90, -45, 85), 115),
    "window": ((60, 120, 180), (20, -120, 120), 150),
    "shelves": ((-90, -10, 200), (115, -15, 140), 170),
    "headphones": ((-20, 60, 110), (63, 11, 77), 40),
    "rug": ((-170, 140, 130), (-35, 12, 10), 110),
    "lights": ((-60, 40, 190), (120, -20, 185), 120),
    "art": ((40, 60, 160), (-50, -95, 70), 120),
}
only = argv[2].split(",") if len(argv) > 2 else list(shots)
for name in only:
    loc, tgt, scale = shots[name]
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale
    S.render.filepath = os.path.join(out, f"{name}_f{frame}.png")
    bpy.ops.render.render(write_still=True)
