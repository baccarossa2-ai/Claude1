import bpy, math
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 96
sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.filepath = '/home/user/Claude1/otho_test/render.png'
# floor
bpy.ops.mesh.primitive_plane_add(size=20); fl = bpy.context.object
m = bpy.data.materials.new('floor'); m.use_nodes=True
b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value=(0.12,0.12,0.14,1); b.inputs['Roughness'].default_value=0.15
fl.data.materials.append(m)
# sphere (metal) + smooth bevelled cube (glossy)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(-1.4,0,1), segments=64, ring_count=32); s=bpy.context.object
bpy.ops.object.shade_smooth()
m2 = bpy.data.materials.new('gold'); m2.use_nodes=True
b2=m2.node_tree.nodes['Principled BSDF']; b2.inputs['Base Color'].default_value=(1.0,0.7,0.25,1); b2.inputs['Metallic'].default_value=1; b2.inputs['Roughness'].default_value=0.2
s.data.materials.append(m2)
bpy.ops.mesh.primitive_cube_add(size=1.6, location=(1.3,0,0.8), rotation=(0,0,math.radians(30))); c=bpy.context.object
bv=c.modifiers.new('bv','BEVEL'); bv.width=0.12; bv.segments=6
ss=c.modifiers.new('ss','SUBSURF'); ss.levels=2
bpy.ops.object.shade_smooth()
m3=bpy.data.materials.new('red'); m3.use_nodes=True
b3=m3.node_tree.nodes['Principled BSDF']; b3.inputs['Base Color'].default_value=(0.7,0.04,0.04,1); b3.inputs['Roughness'].default_value=0.1; b3.inputs['Coat Weight'].default_value=1.0
c.data.materials.append(m3)
# lights
bpy.ops.object.light_add(type='AREA', location=(3,-4,5)); k=bpy.context.object; k.data.energy=900; k.data.size=4
k.rotation_euler=(math.radians(50),0,math.radians(35))
bpy.ops.object.light_add(type='AREA', location=(-5,-2,3)); f=bpy.context.object; f.data.energy=250; f.data.size=5
f.rotation_euler=(math.radians(65),0,math.radians(-60))
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True
w.node_tree.nodes['Background'].inputs['Color'].default_value=(0.03,0.04,0.07,1)
# camera
bpy.ops.object.camera_add(location=(0,-7.5,2.6)); cam=bpy.context.object
cam.data.lens=50
d = bpy.data.objects.new('t',None); bpy.context.collection.objects.link(d); d.location=(0,0,0.9)
tr=cam.constraints.new('TRACK_TO'); tr.target=d; tr.track_axis='TRACK_NEGATIVE_Z'; tr.up_axis='UP_Y'
sc.camera=cam
bpy.ops.render.render(write_still=True)
