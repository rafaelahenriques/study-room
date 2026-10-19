"""
Exports the StudyRoom collection of isometricroom_enriched.blend straight into the web app:
web/public/models/study_room.glb

Run from the blender/ folder:
  /Applications/Blender.app/Contents/MacOS/Blender -b isometricroom_enriched.blend -P export_glb.py

The .blend is authored in centimetres; the StudyRoom root is scaled by 0.01 for the
export only (the file is not saved), so the GLB is in metres.
"""
import bpy, os

S = bpy.context.scene
out_dir = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath), "..", "web", "public", "models"))
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "study_room.glb")

root = bpy.data.objects["StudyRoom"]
root.scale = (0.01, 0.01, 0.01)
S.frame_set(1)  # rest pose = "inactive room" (lamp asleep, loops at their start)

lc = bpy.context.view_layer.layer_collection.children["StudyRoom"]
bpy.context.view_layer.active_layer_collection = lc

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_active_collection=True,
    use_active_collection_with_nested=True,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_extras=True,
    export_cameras=False,
    export_lights=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_frame_range=False,
    export_draco_mesh_compression_enable=False,
)
print("EXPORTED", out, os.path.getsize(out) // 1024, "KB")
