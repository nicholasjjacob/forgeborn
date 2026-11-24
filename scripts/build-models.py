"""
Converts the CC0 Quaternius source models into small web-ready GLB files in public/models/.

Run with Blender (tested on 5.3):
  blender -b --python scripts/build-models.py

Sources (not in the repo; all CC0 1.0 by Quaternius, https://quaternius.com):
  ../assets-src/monsters/Ultimate Monsters/          Ultimate Monsters pack
  ~/Downloads/Stylized Nature MegaKit[Standard]        Stylized Nature MegaKit (free version)

Only the animations the game uses are kept, normal maps are dropped and textures are shrunk,
so each file stays small enough for a phone on mobile data.
"""
import bpy, os, re, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'public', 'models')
DL = os.path.join(os.path.expanduser('~'), 'Downloads')
MON = os.path.join(os.path.dirname(ROOT), 'assets-src', 'monsters', 'Ultimate Monsters')
KNIGHT = os.path.join(DL, 'Knight Character Animated by Quaternius', 'FBX')
NATURE = os.path.join(DL, 'Stylized Nature MegaKit[Standard]', 'glTF')
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def small_nature_copy(size=256):
    """Copy the nature kit's glTF folder with its textures shrunk (Blender's own image scaling
    crashes on these), using the system Python's Pillow."""
    dst = os.path.join(OUT, '..', '..', 'node_modules', '.nature-small')
    if not os.path.isdir(dst):
        shutil.copytree(NATURE, dst)
        subprocess.run(['python', '-c',
            'import sys,glob;from PIL import Image\n'
            'for f in glob.glob(sys.argv[1]+"/*.png"):\n'
            ' im=Image.open(f);im.thumbnail((int(sys.argv[2]),)*2);im.save(f)', dst, str(size)], check=True)
    return dst


def drop_normal_maps():
    for m in bpy.data.materials:
        nt = m.node_tree
        if nt is None:
            continue
        doomed = set()
        for n in nt.nodes:
            if n.type == 'NORMAL_MAP':
                doomed.add(n.name)
                for l in n.inputs['Color'].links:
                    doomed.add(l.from_node.name)
        for name in doomed:
            nt.nodes.remove(nt.nodes[name])


def keep_actions(patterns):
    """Delete every action whose name doesn't match one of the regex patterns."""
    for a in list(bpy.data.actions):
        if not any(re.search(p, a.name) for p in patterns):
            bpy.data.actions.remove(a)
        else:
            # Tidy names: "HumanArmature|HumanArmature|Run" -> "Run"
            a.name = a.name.split('|')[-1]


def export(name, anims=True, lossless=False):
    """lossless: keep PNG textures. Character palette atlases are tiny colour grids that lossy
    WebP (chroma subsampling) turns to grey mush."""
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_image_format='AUTO' if lossless else 'WEBP', export_image_quality=80,
        export_animations=anims, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_apply=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_cameras=False, export_lights=False, export_extras=False,
    )
    print('WROTE', name, os.path.getsize(path))


def attach_helmet(path, pos=(0.0, 0.02, 4.92)):
    """Import a helmet, centre it on the knight's head in the rest pose and bone-parent it to
    'Head' so it follows every animation (same fit as the old sprite renderer)."""
    from mathutils import Vector
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
        bpy.data.objects.remove(o)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in parts for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (mn + mx) / 2
    for o in parts:
        o.location = o.location + (Vector(pos) - centre)
    bpy.context.view_layer.update()
    for o in parts:
        world = o.matrix_world.copy()
        o.parent = arm
        o.parent_type = 'BONE'
        o.parent_bone = 'Head'
        o.matrix_world = world
    arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()


ONLY = os.environ.get('FB_ONLY', '')

# The hero characters come from the KayKit Adventurers pack: see scripts/build-heroes.mjs.

# --- Monsters: (folder, file) for each area's three monsters and its boss ----------------------
MONSTERS = {
    'm0_0': ('Blob', 'GreenBlob'), 'm0_1': ('Flying', 'Pigeon'), 'm0_2': ('Blob', 'Mushnub'), 'm0_3': ('Big', 'MushroomKing'),
    'm1_0': ('Blob', 'GreenSpikyBlob'), 'm1_1': ('Flying', 'Glub'), 'm1_2': ('Flying', 'Armabee'), 'm1_3': ('Flying', 'Glub_Evolved'),
    'm2_0': ('Blob', 'Cactoro'), 'm2_1': ('Big', 'Dino'), 'm2_2': ('Flying', 'Alpaking'), 'm2_3': ('Big', 'Cactoro'),
    'm3_0': ('Blob', 'Alien'), 'm3_1': ('Flying', 'Ghost'), 'm3_2': ('Flying', 'Goleling'), 'm3_3': ('Flying', 'Goleling_Evolved'),
    'm4_0': ('Blob', 'Yeti'), 'm4_1': ('Flying', 'Squidle'), 'm4_2': ('Flying', 'Hywirl'), 'm4_3': ('Big', 'Yeti'),
    'm5_0': ('Blob', 'Orc'), 'm5_1': ('Big', 'Orc_Skull'), 'm5_2': ('Flying', 'Demon'), 'm5_3': ('Flying', 'Dragon_Evolved'),
}
KEEP = [r'Idle$', r'Flying_Idle$', r'Walk$', r'Run$', r'Fast_Flying$', r'Flying$', r'Bite_Front$', r'Punch$',
        r'Headbutt$', r'Weapon$', r'Death$', r'HitRe']
for name, (folder, f) in (MONSTERS.items() if ONLY in ('', 'monsters') else []):
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(MON, folder, 'glTF', f + '.gltf'))
    keep_actions(KEEP)
    export(name, lossless=True)

# --- Scenery ---------------------------------------------------------------------------
PROPS = {
    'tree_0': 'CommonTree_1', 'tree_1': 'CommonTree_2', 'tree_2': 'CommonTree_3', 'tree_3': 'CommonTree_4',
    'pine_0': 'Pine_1', 'pine_1': 'Pine_2', 'pine_2': 'Pine_3', 'pine_3': 'Pine_5',
    'deadtree_0': 'DeadTree_1', 'deadtree_1': 'DeadTree_2', 'deadtree_2': 'DeadTree_3', 'deadtree_3': 'DeadTree_4',
    'rock_0': 'Rock_Medium_1', 'rock_1': 'Rock_Medium_2', 'rock_2': 'Rock_Medium_3', 'rock_3': 'Rock_Medium_1',
    'bush_0': 'Bush_Common', 'bush_1': 'Bush_Common_Flowers',
    'shroom_0': 'Mushroom_Common', 'shroom_1': 'Mushroom_Laetiporus',
    'grass_0': 'Grass_Common_Short', 'grass_1': 'Grass_Wispy_Short', 'grass_2': 'Grass_Common_Tall',
    'flower_0': 'Flower_3_Group', 'flower_1': 'Flower_4_Group', 'fern_0': 'Fern_1',
    'pebble_0': 'Pebble_Round_1', 'pebble_1': 'Pebble_Square_2',
}
done = set()
SMALL = None if ONLY not in ('', 'props') else 0
if SMALL is not None:
    SMALL = small_nature_copy()
for name, f in (PROPS.items() if SMALL else []):
    if f in done and name.endswith('_3'):
        continue
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SMALL, f + '.gltf'))
    drop_normal_maps()
    if name.startswith('bush'):
        # The kit's bushes use the red twisted-tree leaves; give them green tree leaves.
        for img in bpy.data.images:
            if 'TwistedTree' in img.name:
                img.filepath = os.path.join(SMALL, 'Leaves_NormalTree_C.png')
                img.reload()
    export(name, anims=False)
    done.add(f)
