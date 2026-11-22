"""
Render the CC0 3D packs into sprite sheets for the game.

    blender -b --factory-startup -P tools/blender/render_sprites.py -- <config.json>

Every model is normalised to a target height, posed from the game's top-down 3/4 camera,
and rendered with soft lighting on a transparent background. Animated models get idle, walk
and attack frames. Frames are packed into PNG sheets plus `sprites.json` (frame rects, feet
anchor, visible height) that the game loads at runtime. Re-run whenever models or the
manifest below change; the output is deterministic.
"""
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

RES = 4               # sheet pixels per game unit (matches the game's texture resolution)
ELEVATION = 30        # camera angle above the horizon, degrees (low enough to see faces)
FACING = 55           # yaw for characters: 3/4 view facing screen-right
SHEET_MAX_W = 2048
OUTLINE_PX = 2        # dark cartoon outline width in sheet pixels
OUTLINE_RGB = (0.13, 0.08, 0.15)
SATURATION = 1.25     # gentle colour boost after rendering
# Material overrides for models whose source colours are too dark for the art style.
# (linear colour values: steel-blue armour, brown boots)
RECOLOR = {'Armor': (0.22, 0.30, 0.50), 'Boots': (0.14, 0.06, 0.025), 'Skin': (0.80, 0.52, 0.34),
           'Grey': (0.30, 0.34, 0.44), 'Golden': (0.85, 0.55, 0.12)}  # names match by prefix (Grey.002 etc.)

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
MON = cfg['monsters']   # .../Ultimate Monsters
NAT = cfg['nature']     # .../Stylized Nature MegaKit[Standard]/glTF
KNIGHT = cfg['knight']  # .../KnightCharacter.fbx
OUT = cfg['out']        # public/sprites
ONLY = set(cfg.get('only', []))
# Optional helmet for the hero (a separate model in the knight pack), attached to the head bone.
HELMET = cfg.get('helmet')                      # path to HelmetN.fbx, or None
HELMET_POS = tuple(cfg.get('helmet_pos', (0.0, 0.02, 4.92)))  # helmet centre in the knight's rest pose
HELMET_SCALE = cfg.get('helmet_scale', 1.0)

IDLE = ['Idle', 'Flying_Idle', 'Idle_swordRight']
WALK = ['Run_swordRight', 'Walk', 'Run', 'Fast_Flying', 'Flying_Idle', 'Walking']
ATTACK = ['Bite_Front', 'Punch', 'Headbutt', 'Weapon', 'Attack', 'Run_swordAttack', 'Jump', 'Yes']

# name -> (path, sheet, cell size in game units, target height in units, kind)
def mon(sheet, rel, h=11.0, cell=24):
    return (f"{MON}/{rel}.gltf", sheet, cell, h, 'char')

def boss(sheet, rel):
    return mon(sheet, rel, h=26.0, cell=48)

MANIFEST = {
    'hero': (KNIGHT, 'hero', 32, 19.0, 'hero'),
    # Area 0 Greenfield Meadow
    'a0m0': mon('area0', 'Blob/glTF/GreenBlob'), 'a0m1': mon('area0', 'Flying/glTF/Pigeon'),
    'a0m2': mon('area0', 'Blob/glTF/Mushnub'), 'a0b': boss('area0', 'Big/glTF/MushroomKing'),
    # Area 1 Mirewood
    'a1m0': mon('area1', 'Blob/glTF/GreenSpikyBlob'), 'a1m1': mon('area1', 'Flying/glTF/Glub'),
    'a1m2': mon('area1', 'Flying/glTF/Armabee'), 'a1b': boss('area1', 'Big/glTF/Frog'),
    # Area 2 Sunscar Dunes
    'a2m0': mon('area2', 'Blob/glTF/Cactoro'), 'a2m1': mon('area2', 'Big/glTF/Dino', h=12.0),
    'a2m2': mon('area2', 'Flying/glTF/Alpaking'), 'a2b': boss('area2', 'Big/glTF/Cactoro'),
    # Area 3 Hollow Deep
    'a3m0': mon('area3', 'Blob/glTF/Alien'), 'a3m1': mon('area3', 'Flying/glTF/Ghost'),
    'a3m2': mon('area3', 'Flying/glTF/Goleling', h=12.0), 'a3b': boss('area3', 'Flying/glTF/Goleling_Evolved'),
    # Area 4 Frostveil
    'a4m0': mon('area4', 'Blob/glTF/Yeti'), 'a4m1': mon('area4', 'Flying/glTF/Squidle', h=12.0),
    'a4m2': mon('area4', 'Flying/glTF/Hywirl'), 'a4b': boss('area4', 'Big/glTF/Yeti'),
    # Area 5 Emberforge Caldera
    'a5m0': mon('area5', 'Blob/glTF/Orc'), 'a5m1': mon('area5', 'Big/glTF/Orc_Skull', h=13.0),
    'a5m2': mon('area5', 'Flying/glTF/Demon'), 'a5b': boss('area5', 'Flying/glTF/Dragon_Evolved'),
}
# Props: two variants each. (file, cell units, target height units)
PROPS = {
    'tree': [('CommonTree_1', 52, 37), ('CommonTree_3', 52, 34)],
    'pine': [('Pine_1', 52, 39), ('Pine_3', 52, 36)],
    'deadtree': [('DeadTree_1', 40, 29), ('DeadTree_3', 40, 26)],
    'rock': [('Rock_Medium_1', 20, 7), ('Rock_Medium_2', 20, 6)],
    'bush': [('Fern_1', 20, 7), ('Bush_Common_Flowers', 20, 8)],  # Bush_Common's leaf colour doesn't import (renders red)
    'shroom': [('Mushroom_Common', 14, 7), ('Mushroom_Laetiporus', 14, 6)],
    'decal0': [('Grass_Common_Short', 10, 3)],
    'decal1': [('Flower_3_Group', 10, 3)],
    'decal2': [('Pebble_Round_2', 10, 1.5)],
}


# --- Scene setup -------------------------------------------------------------------------

def reset_scene(cell_units):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    px = int(cell_units * RES)
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    try:
        sc.view_settings.look = 'Medium High Contrast'
    except TypeError:
        pass
    sc.view_settings.exposure = 0.12
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    # Bright, soft ambient (sky) + warm key sun from the top-left + cool rim from behind.
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.95, 0.95, 1.0, 1)
    bg.inputs[1].default_value = 0.65
    sc.world = world
    for name, energy, rot, color in (
        ('Key', 2.6, (math.radians(50), 0, math.radians(-35)), (1.0, 0.96, 0.88)),
        ('Rim', 1.6, (math.radians(-60), 0, math.radians(160)), (0.75, 0.85, 1.0)),
    ):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.color = color
        ld.angle = math.radians(12)
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        sc.collection.objects.link(lo)
    return sc


def add_camera(sc, cell_units, target_h):
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = cell_units
    cam = bpy.data.objects.new('Cam', cam_data)
    sc.collection.objects.link(cam)
    e = math.radians(ELEVATION)
    look = Vector((0, 0, target_h * 0.42))
    d = 100
    cam.location = look + Vector((0, -d * math.cos(e), d * math.sin(e)))
    cam.rotation_euler = (math.radians(90 - ELEVATION), 0, 0)
    cam_data.clip_end = 1000
    sc.camera = cam
    return cam


def import_model(path):
    before = set(bpy.data.objects)
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    fix_materials()
    root = bpy.data.objects.new('Root', None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    return root, objs


def fix_materials():
    """Some FBX exports import with zero alpha (invisible); force opaque and apply recolours."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if not bsdf:
            continue
        a = bsdf.inputs['Alpha']
        if not a.is_linked and a.default_value < 0.05:
            a.default_value = 1.0
            for attr, val in (('blend_method', 'OPAQUE'), ('surface_render_method', 'DITHERED')):
                try:
                    setattr(m, attr, val)
                except Exception:
                    pass
        # Fully metallic surfaces just mirror the bright sky (washed-out white); keep them matte-ish.
        met = bsdf.inputs['Metallic']
        if not met.is_linked and met.default_value > 0.3:
            met.default_value = 0.3
        key = next((k for k in RECOLOR if m.name == k or m.name.startswith(k + '.')), None)
        if key and not bsdf.inputs['Base Color'].is_linked:
            bsdf.inputs['Base Color'].default_value = (*RECOLOR[key], 1.0)


def world_bounds(objs):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(deps)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        pts.extend(mw @ v.co for v in mesh.vertices)
        ev.to_mesh_clear()
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def normalise(root, objs, target_h, yaw):
    mn, mx = world_bounds(objs)
    s = target_h / max(1e-6, (mx.z - mn.z))
    root.scale = (s, s, s)
    bpy.context.view_layer.update()
    mn, mx = world_bounds(objs)
    root.location -= Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    root.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()


def attach_helmet(arm, path):
    """Import a helmet, centre it on the head in the rest pose, and bone-parent it to 'Head'
    so it follows every animation."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    fix_materials()
    parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not parts or 'Head' not in arm.data.bones:
        return
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    mn, mx = world_bounds(parts)
    centre = (mn + mx) / 2
    for o in parts:
        o.scale = o.scale * HELMET_SCALE
    bpy.context.view_layer.update()
    for o in parts:
        o.location = o.location + (Vector(HELMET_POS) - centre)
    bpy.context.view_layer.update()
    for o in parts:
        world = o.matrix_world.copy()
        o.parent = arm
        o.parent_type = 'BONE'
        o.parent_bone = 'Head'
        o.matrix_world = world
    arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()


def find_action(names):
    acts = list(bpy.data.actions)
    for want in names:
        for a in acts:
            if a.name == want or a.name.endswith('|' + want):
                return a
    return None


def armature_of(objs):
    for o in objs:
        if o.type == 'ARMATURE':
            return o
    return None


def use_action(arm, act):
    ad = arm.animation_data or arm.animation_data_create()
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = act
    if hasattr(ad, 'action_slot') and getattr(act, 'slots', None):
        try:
            ad.action_slot = act.slots[0]
        except Exception:
            pass


def render_png(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return stylise(arr.reshape(h, w, 4))  # bottom-up rows


def stylise(px):
    """Saturation boost + a dark outline around the silhouette (cartoon look)."""
    rgb, a = px[:, :, :3], px[:, :, 3]
    lum = (rgb * np.array([0.299, 0.587, 0.114], dtype=np.float32)).sum(axis=2, keepdims=True)
    px[:, :, :3] = np.clip(lum + (rgb - lum) * SATURATION, 0, 1)
    mask = a > 0.35
    grown = mask.copy()
    r = OUTLINE_PX
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r + 1:
                continue
            grown |= np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
    edge = grown & ~mask
    px[edge, 0], px[edge, 1], px[edge, 2] = OUTLINE_RGB
    px[edge, 3] = 0.92
    # Under semi-transparent anti-aliased edges, darken toward the outline colour too.
    soft = (a > 0.02) & ~mask
    px[soft, :3] = px[soft, :3] * 0.4 + np.array(OUTLINE_RGB, dtype=np.float32) * 0.6
    px[soft, 3] = np.maximum(px[soft, 3], 0.92)
    return px


def sample_frames(act, n, loop):
    a, b = act.frame_range
    if n == 1:
        return [a]
    span = (b - a)
    return [a + span * i / (n if loop else n - 1) for i in range(n)]


# --- Render one entity ------------------------------------------------------------------

def render_entity(name, path, cell, target_h, kind, tmp):
    sc = reset_scene(cell)
    root, objs = import_model(path)
    yaw = FACING if kind in ('char', 'hero') else 0
    arm = armature_of(objs)
    if kind == 'hero' and HELMET and arm:
        attach_helmet(arm, HELMET)
        objs = [o for o in bpy.data.objects if o.type in ('MESH', 'ARMATURE')]
    idle = find_action(IDLE) if arm else None
    if arm and idle:
        use_action(arm, idle)
        sc.frame_set(int(idle.frame_range[0]))
    normalise(root, objs, target_h, yaw)
    cam = add_camera(sc, cell, target_h)
    bpy.context.view_layer.update()  # apply the camera transform before projecting
    feet = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
    anchor = [round(feet.x, 4), round(1 - feet.y, 4)]

    anims = {}
    if arm:
        plan = [('idle', IDLE, 4, True), ('walk', WALK, 6, True)]
        if kind != 'hero':
            plan.append(('attack', ATTACK, 4, False))
        for label, names, n, loop in plan:
            act = find_action(names)
            if not act:
                continue
            use_action(arm, act)
            frames = []
            for i, f in enumerate(sample_frames(act, n, loop)):
                sc.frame_set(int(f), subframe=f - int(f))
                frames.append(render_png(sc, os.path.join(tmp, f'{name}_{label}_{i}.png')))
            anims[label] = frames
    else:
        anims['idle'] = [render_png(sc, os.path.join(tmp, f'{name}.png'))]
    return anims, anchor


def visible_top(frames, anchor, cell_px):
    """Height (game units) from the feet to the top of the visible pixels, over all frames."""
    alpha = np.max(np.stack([f[:, :, 3] for f in frames]), axis=0)
    rows = np.where(alpha.max(axis=1) > 0.1)[0]
    cols = np.where(alpha.max(axis=0) > 0.1)[0]
    if len(rows) == 0:
        return 0, 0
    top_row_from_top = cell_px - 1 - rows.max()  # images are bottom-up
    feet_px = anchor[1] * cell_px
    width = (cols.max() - cols.min() + 1) / RES
    return round((feet_px - top_row_from_top) / RES, 2), round(width, 2)


# --- Packing ------------------------------------------------------------------------------

class Sheet:
    def __init__(self, name):
        self.name = name
        self.items = []  # (key, anim, index, array)

    def add(self, key, anim, i, arr):
        self.items.append((key, anim, i, arr))

    def pack(self):
        x = y = row_h = 0
        placed = []
        width = 0
        for key, anim, i, arr in self.items:
            h, w = arr.shape[:2]
            if x + w > SHEET_MAX_W:
                x, y, row_h = 0, y + row_h, 0
            placed.append((key, anim, i, x, y, w, h, arr))
            x += w
            row_h = max(row_h, h)
            width = max(width, x)
        height = y + row_h
        canvas = np.zeros((height, width, 4), dtype=np.float32)  # top-down
        rects = {}
        for key, anim, i, px, py, w, h, arr in placed:
            canvas[py:py + h, px:px + w] = arr[::-1]
            rects.setdefault(key, {}).setdefault(anim, []).append([px / RES, py / RES, w / RES, h / RES])
        return canvas, rects

    def save(self, folder):
        canvas, rects = self.pack()
        h, w = canvas.shape[:2]
        img = bpy.data.images.new(self.name, w, h, alpha=True)
        img.pixels.foreach_set(canvas[::-1].ravel())  # Blender images are bottom-up
        img.filepath_raw = os.path.join(folder, f'{self.name}.png')
        img.file_format = 'PNG'
        img.save()
        return rects, (w, h)


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='fb_sprites_')
    meta_path = os.path.join(OUT, 'sprites.json')
    meta = json.load(open(meta_path)) if (ONLY and os.path.exists(meta_path)) else {'res': RES, 'sheets': {}, 'sprites': {}}
    sheets = {}
    results = {}

    def want(name):
        return not ONLY or name in ONLY

    for name, (path, sheet, cell, h, kind) in MANIFEST.items():
        if not want(name):
            continue
        print(f'[render] {name} <- {os.path.basename(path)}', flush=True)
        anims, anchor = render_entity(name, path, cell, h, kind, tmp)
        top, width = visible_top([f for fs in anims.values() for f in fs], anchor, cell * RES)
        results[name] = dict(sheet=sheet, anchor=anchor, top=top, width=width, cell=cell, fly='/Flying/' in path)
        sh = sheets.setdefault(sheet, Sheet(sheet))
        for label, frames in anims.items():
            for i, f in enumerate(frames):
                sh.add(name, label, i, f)

    for kind, variants in PROPS.items():
        for v, (file, cell, h) in enumerate(variants):
            name = f'{kind}{v}' if not kind.startswith('decal') else kind
            if not want(name):
                continue
            print(f'[render] {name} <- {file}', flush=True)
            anims, anchor = render_entity(name, f'{NAT}/{file}.gltf', cell, h, 'prop', tmp)
            top, width = visible_top(anims['idle'], anchor, cell * RES)
            results[name] = dict(sheet='props', anchor=anchor, top=top, width=width, cell=cell, fly=False)
            sh = sheets.setdefault('props', Sheet('props'))
            sh.add(name, 'idle', 0, anims['idle'][0])

    # A partial re-render (ONLY) must re-pack whole sheets, so keep unchanged sheets as-is
    # only when none of their sprites were re-rendered.
    for sname, sh in sheets.items():
        rects, size = sh.save(OUT)
        meta['sheets'][sname] = {'file': f'{sname}.png', 'w': size[0], 'h': size[1]}
        for key, frames in rects.items():
            r = results[key]
            meta['sprites'][key] = {**r, 'frames': frames}
        print(f'[sheet] {sname}.png {size[0]}x{size[1]}', flush=True)

    json.dump(meta, open(meta_path, 'w'), indent=1)
    print('[done]', meta_path, flush=True)


main()
