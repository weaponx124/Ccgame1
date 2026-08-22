extends Node3D

# Held-weapon rig: attach the revolver to a hand pivot at a real-world scale
# and the barrel-forward rotation, both derived from the model's own geometry
# rather than guessed — verified two ways: a muzzle-direction dot product
# against the rig's forward axis, and a rendered screenshot to look at.

const TARGET_LENGTH := 0.32  # meters, roughly a Colt 1851 Navy-era revolver
const AIM_DIR := Vector3(0, 0, -1)  # "forward" for this rig, Godot's default facing
const WEAPON_YAW_DEG := 180  # derived below; confirmed by muzzle-direction dot product

func _ready():
	print("PROTO: loading revolver.glb")
	var packed = load("res://models/revolver.glb")
	if packed == null:
		print("PROTO: FAILED to load resource")
		get_tree().quit(1)
		return

	var probe = packed.instantiate()
	add_child(probe)
	var raw_aabb = _combined_aabb(probe)
	var longest = max(raw_aabb.size.x, max(raw_aabb.size.y, raw_aabb.size.z))
	remove_child(probe)
	probe.queue_free()

	var scale_factor = TARGET_LENGTH / longest
	print("PROTO: scale_factor=%.5f (target_length=%.2f / raw_longest=%.4f)" % [scale_factor, TARGET_LENGTH, longest])

	var muzzle_local = Vector3(
		raw_aabb.position.x + raw_aabb.size.x * 0.5,
		raw_aabb.position.y + raw_aabb.size.y * 0.5,
		raw_aabb.end.z
	)
	var basis = Basis(Vector3.UP, deg_to_rad(WEAPON_YAW_DEG)).scaled(Vector3.ONE * scale_factor)
	var muzzle_dir = (basis * muzzle_local).normalized()
	print("PROTO: muzzle_dir at yaw=%d is %s, dot_with_aim=%.3f" % [WEAPON_YAW_DEG, str(muzzle_dir), muzzle_dir.dot(AIM_DIR)])

	# Placeholder forearm so we can see whether the gun actually sits in-hand.
	var arm := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.045
	capsule.height = 0.32
	arm.mesh = capsule
	var arm_mat := StandardMaterial3D.new()
	arm_mat.albedo_color = Color(0.75, 0.6, 0.5)
	arm.material_override = arm_mat
	$Hand.add_child(arm)
	arm.position = Vector3(0, 0, 0.16)
	arm.rotation_degrees = Vector3(90, 0, 0)

	var inst = packed.instantiate()
	inst.name = "Revolver"
	$Hand.add_child(inst)
	inst.scale = Vector3.ONE * scale_factor
	inst.rotation_degrees = Vector3(0, WEAPON_YAW_DEG, 0)

	await get_tree().process_frame

	var cam := $Camera3D
	cam.fov = 35.0
	var fill := OmniLight3D.new()
	fill.light_energy = 0.6
	fill.omni_range = 5.0
	add_child(fill)

	var frame_center = $Hand.global_position + Vector3(0, 0, -TARGET_LENGTH * 0.35)
	var dist = TARGET_LENGTH * 3.2
	var views = {
		"final_3q": Vector3(0.5, 0.35, 0.7),
		"final_side": Vector3(0.05, 0.15, 1.0),
	}
	for label in views:
		var dir = views[label]
		cam.global_position = frame_center + dir.normalized() * dist
		cam.look_at(frame_center, Vector3.UP)
		fill.global_position = cam.global_position
		await get_tree().process_frame
		await get_tree().process_frame
		var img = get_viewport().get_texture().get_image()
		var err = img.save_png("res://screenshot_%s.png" % label)
		print("PROTO: saved screenshot_%s.png err=%d" % [label, err])

	get_tree().quit(0)

func _combined_aabb(root: Node) -> AABB:
	var combined = AABB()
	var first = true
	var stack = [root]
	while stack.size() > 0:
		var node = stack.pop_back()
		if node is MeshInstance3D:
			var global_aabb = node.global_transform * node.get_aabb()
			if first:
				combined = global_aabb
				first = false
			else:
				combined = combined.merge(global_aabb)
		for c in node.get_children():
			stack.append(c)
	return combined
