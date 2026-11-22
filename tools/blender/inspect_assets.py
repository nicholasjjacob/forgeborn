"""Print animations and sizes for a few source models (run with: blender -b -P inspect_assets.py -- <files...>)."""
import sys, bpy
from mathutils import Vector

files = sys.argv[sys.argv.index('--') + 1:]
for path in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.lower().endswith(('.gltf', '.glb')):
        bpy.ops.import_scene.gltf(filepath=path)
    elif path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    elif path.lower().endswith('.blend'):
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = src.objects
            dst.actions = src.actions
        for o in dst.objects:
            if o: bpy.context.scene.collection.objects.link(o)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    if pts:
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        size = tuple(round(v, 2) for v in (mx - mn))
    else:
        size = None
    acts = [(a.name, int(a.frame_range[1] - a.frame_range[0])) for a in bpy.data.actions]
    mats = sorted({m.name for o in meshes for m in o.data.materials if m})
    print(f"@@ {path.split('/')[-1]} size={size} meshes={len(meshes)} mats={mats[:6]} actions={acts[:30]}")
