extends Node3D

# Self-verification harness: load the imported revolver model, parent it under
# the "Hand" pivot, auto-frame a camera around its real bounding box (so we
# don't have to guess a scale/position by eye first), then render and save a
# screenshot for inspection. Prints the AABB size so we know if Blender's
# meters need a scale correction before this ever goes near the game.

func _ready():
	print("PROTO: loading revolver.glb")
	var packed = load("res://models/revolver.glb")
	if packed == null:
		print("PROTO: FAILED to load resource")
		get_tree().quit(1)
		return

	var inst = packed.instantiate()
	$Hand.add_child(inst)
	print("PROTO: instanced, child count under Hand = %d" % $Hand.get_child_count())

	# Walk the tree to find every MeshInstance3D and combine their AABBs so we
	# get the model's real extent regardless of how many parts it's split into.
	var combined_aabb = AABB()
	var first = true
	var stack = [inst]
	while stack.size() > 0:
		var node = stack.pop_back()
		if node is MeshInstance3D:
			var mesh_aabb = node.get_aabb()
			var global_aabb = node.global_transform * mesh_aabb
			print("PROTO: mesh '%s' local_aabb=%s global_aabb=%s" % [node.name, str(mesh_aabb), str(global_aabb)])
			if first:
				combined_aabb = global_aabb
				first = false
			else:
				combined_aabb = combined_aabb.merge(global_aabb)
		for c in node.get_children():
			stack.append(c)

	print("PROTO: combined AABB position=%s size=%s" % [str(combined_aabb.position), str(combined_aabb.size)])

	var center = combined_aabb.get_center()
	var longest = max(combined_aabb.size.x, max(combined_aabb.size.y, combined_aabb.size.z))
	if longest <= 0.0:
		longest = 1.0

	# Frame the camera to fit the model regardless of its actual scale.
	var cam := $Camera3D
	cam.fov = 35.0
	var dist = longest * 1.3
	cam.global_position = center + Vector3(dist * 0.55, dist * 0.35, dist * 0.8)
	cam.look_at(center, Vector3.UP)

	var fill := OmniLight3D.new()
	fill.light_energy = 3.0
	fill.omni_range = longest * 4.0
	add_child(fill)
	fill.global_position = cam.global_position + Vector3(0, longest * 0.3, 0)

	var angles = {
		"front": Vector3(0, 0.15, 1),
		"side": Vector3(1, 0.1, 0),
		"topside": Vector3(0.6, 0.9, 0.6),
	}
	for label in angles:
		var dir = angles[label]
		cam.global_position = center + dir.normalized() * dist * 1.4
		cam.look_at(center, Vector3.UP)
		fill.global_position = cam.global_position
		await get_tree().process_frame
		await get_tree().process_frame
		var img = get_viewport().get_texture().get_image()
		var err = img.save_png("res://screenshot_%s.png" % label)
		print("PROTO: saved screenshot_%s.png err=%d" % [label, err])

	get_tree().quit(0)
