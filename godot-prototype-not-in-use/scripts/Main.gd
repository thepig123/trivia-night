extends Control
## TRIVIA NIGHT — Godot TV client.
## Purely a renderer: everything shown here comes from ServerConnection's
## "state:public" snapshots. This scene never decides scores, buzz order,
## or legal routes locally (doc section 8: server-authoritative state).

var _connected := false
var _has_state := false

# --- Connect overlay controls ---
var _connect_layer: CanvasLayer
var _url_input: LineEdit
var _room_input: LineEdit
var _status_label: Label

# --- Main game layer controls ---
var _game_layer: CanvasLayer
var _room_label: Label
var _phase_label: Label
var _scoreboard: HBoxContainer
var _question_panel: PanelContainer
var _question_label: Label
var _map_scroll: ScrollContainer
var _map_column: VBoxContainer

func _ready() -> void:
	_build_connect_overlay()
	_build_game_layer()
	_game_layer.visible = false

	ServerConnection.connection_changed.connect(_on_connection_changed)
	ServerConnection.state_received.connect(_on_state_received)
	ServerConnection.server_error.connect(_on_server_error)

# ---------------- Connect overlay ----------------

func _build_connect_overlay() -> void:
	_connect_layer = CanvasLayer.new()
	add_child(_connect_layer)

	var bg := ColorRect.new()
	bg.color = GameTheme.BG_DEEP
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_connect_layer.add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_connect_layer.add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	center.add_child(panel)
	_style_panel(panel, GameTheme.BG_PANEL)

	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 16)
	panel.add_child(v)

	var title := Label.new()
	title.text = "TRIVIA NIGHT"
	title.add_theme_font_size_override("font_size", 48)
	title.add_theme_color_override("font_color", GameTheme.CREAM)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "TV / Felles spillskjerm"
	subtitle.add_theme_color_override("font_color", GameTheme.TEAL)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(subtitle)

	_url_input = LineEdit.new()
	_url_input.text = "ws://127.0.0.1:8080"
	_url_input.placeholder_text = "Serveradresse"
	v.add_child(_url_input)

	_room_input = LineEdit.new()
	_room_input.placeholder_text = "Romkode (fra vertspanelet)"
	v.add_child(_room_input)

	var connect_btn := Button.new()
	connect_btn.text = "Koble til"
	connect_btn.custom_minimum_size = Vector2(0, 48)
	connect_btn.pressed.connect(_on_connect_pressed)
	v.add_child(connect_btn)

	_status_label = Label.new()
	_status_label.text = "Ikke tilkoblet."
	_status_label.add_theme_color_override("font_color", GameTheme.CREAM)
	_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_status_label)

func _on_connect_pressed() -> void:
	_status_label.text = "Kobler til…"
	# Say hello once connected — handled by ServerConnection when the socket opens,
	# but we set the pending room code now so it fires as soon as it's ready.
	ServerConnection.set_pending_room(_room_input.text.strip_edges().to_upper())
	ServerConnection.connect_to_server(_url_input.text.strip_edges())

func _on_connection_changed(is_connected: bool) -> void:
	_connected = is_connected
	_status_label.text = "Tilkoblet. Venter på rommet…" if is_connected else "Frakoblet. Prøver igjen…"

func _on_server_error(message: String) -> void:
	_status_label.text = "Feil: " + message

# ---------------- Main game layer ----------------

func _build_game_layer() -> void:
	_game_layer = CanvasLayer.new()
	add_child(_game_layer)

	var bg := ColorRect.new()
	bg.color = GameTheme.BG_DEEP
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_game_layer.add_child(bg)

	var root_v := VBoxContainer.new()
	root_v.set_anchors_preset(Control.PRESET_FULL_RECT)
	root_v.add_theme_constant_override("separation", 0)
	_game_layer.add_child(root_v)

	# --- Top bar ---
	var top_bar := HBoxContainer.new()
	top_bar.custom_minimum_size = Vector2(0, 54)
	root_v.add_child(top_bar)

	var title := Label.new()
	title.text = "TRIVIA NIGHT"
	title.add_theme_font_size_override("font_size", 27)
	title.add_theme_color_override("font_color", GameTheme.CREAM)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top_bar.add_child(title)

	_room_label = Label.new()
	_room_label.add_theme_font_size_override("font_size", 18)
	_room_label.add_theme_color_override("font_color", GameTheme.YELLOW)
	top_bar.add_child(_room_label)

	_phase_label = Label.new()
	_phase_label.visible = false

	# --- Route map with game-show question overlay ---
	var map_stage := Control.new()
	map_stage.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	map_stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root_v.add_child(map_stage)

	_map_scroll = ScrollContainer.new()
	_map_scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	map_stage.add_child(_map_scroll)
	var map_style := StyleBoxFlat.new()
	map_style.bg_color = Color("#1A1512")
	map_style.border_color = Color("#765638")
	map_style.set_border_width_all(2)
	map_style.set_corner_radius_all(10)
	_map_scroll.add_theme_stylebox_override("panel", map_style)

	_map_column = VBoxContainer.new()
	_map_column.alignment = BoxContainer.ALIGNMENT_END
	_map_column.add_theme_constant_override("separation", 28)
	_map_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_map_scroll.add_child(_map_column)

	var question_center := CenterContainer.new()
	question_center.set_anchors_preset(Control.PRESET_FULL_RECT)
	question_center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	map_stage.add_child(question_center)
	_question_panel = PanelContainer.new()
	_question_panel.custom_minimum_size = Vector2(520, 360)
	question_center.add_child(_question_panel)
	_style_question_panel(_question_panel)
	_question_panel.visible = false
	_question_label = Label.new()
	_question_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_question_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_question_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_question_label.add_theme_font_size_override("font_size", 30)
	_question_label.add_theme_color_override("font_color", GameTheme.CREAM)
	_question_panel.add_child(_question_label)


	# Fixed-height, edge-to-edge scoreboard. Every team owns an equal-width
	# cell; buzz effects are drawn inside the cell and can never overlap.
	var scoreboard_frame := PanelContainer.new()
	scoreboard_frame.custom_minimum_size = Vector2(0, 142)
	var scoreboard_style := StyleBoxFlat.new()
	scoreboard_style.bg_color = Color("#171310")
	scoreboard_style.border_color = Color("#765638")
	scoreboard_style.border_width_top = 3
	scoreboard_frame.add_theme_stylebox_override("panel", scoreboard_style)
	root_v.add_child(scoreboard_frame)
	_scoreboard = HBoxContainer.new()
	_scoreboard.add_theme_constant_override("separation", 0)
	scoreboard_frame.add_child(_scoreboard)

func _style_panel(panel: PanelContainer, color: Color) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.corner_radius_top_left = 16
	sb.corner_radius_top_right = 16
	sb.corner_radius_bottom_left = 16
	sb.corner_radius_bottom_right = 16
	sb.content_margin_left = 24
	sb.content_margin_right = 24
	sb.content_margin_top = 18
	sb.content_margin_bottom = 18
	panel.add_theme_stylebox_override("panel", sb)

func _style_question_panel(panel: PanelContainer) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#211B19")
	sb.border_color = GameTheme.YELLOW
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(12)
	sb.shadow_color = Color(0, 0, 0, 0.65)
	sb.shadow_size = 18
	sb.set_content_margin_all(38)
	panel.add_theme_stylebox_override("panel", sb)

# ---------------- State rendering ----------------

func _on_state_received(state: Dictionary) -> void:
	if not _has_state:
		_has_state = true
		_connect_layer.visible = false
		_game_layer.visible = true

	_room_label.text = "ROM " + str(state.get("roomCode", ""))
	var phase: String = str(state.get("phase", ""))
	_room_label.visible = phase == "lobby"

	_render_scoreboard(state.get("teams", []), state.get("currentResponderId", ""), state.get("lockedOutTeamIds", []), state.get("targetScore", 10000))
	_render_question(state)
	_render_map(state.get("map", {}))

func _render_scoreboard(teams: Array, current_responder_id, locked: Array, target_score: int) -> void:
	for c in _scoreboard.get_children():
		c.queue_free()

	var first_buzz_id: String = current_responder_id if current_responder_id != null else ""

	for team in teams:
		var panel := PanelContainer.new()
		panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		panel.custom_minimum_size = Vector2(0, 138)
		var team_color := Color(str(team.get("color", "#4A3B70")))
		var is_first: bool = team.get("id", "") == first_buzz_id
		_style_team_banner(panel, team_color, is_first)

		var v := VBoxContainer.new()
		v.alignment = BoxContainer.ALIGNMENT_CENTER
		v.add_theme_constant_override("separation", 2)
		panel.add_child(v)

		var name_label := Label.new()
		name_label.text = str(team.get("name", "Team"))
		name_label.add_theme_color_override("font_color", team_color)
		name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		name_label.add_theme_font_size_override("font_size", 20)
		v.add_child(name_label)

		var score_label := Label.new()
		score_label.text = str(team.get("score", 0))
		score_label.add_theme_color_override("font_color", GameTheme.CREAM)
		score_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		score_label.add_theme_font_size_override("font_size", 34)
		v.add_child(score_label)

		var progress_label := Label.new()
		if team.get("qualifiedForFinal", false):
			progress_label.text = "FINALIST"
			progress_label.add_theme_color_override("font_color", GameTheme.YELLOW)
		else:
			progress_label.text = "%d TIL FINALEN" % max(0, target_score - int(team.get("score", 0)))
			progress_label.add_theme_color_override("font_color", Color("#B8A98D"))
		progress_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		progress_label.add_theme_font_size_override("font_size", 11)
		v.add_child(progress_label)

		if team.get("id", "") in locked:
			var lock_label := Label.new()
			lock_label.text = "UTELÅST"
			lock_label.add_theme_color_override("font_color", GameTheme.CORAL)
			lock_label.add_theme_font_size_override("font_size", 12)
			lock_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			v.add_child(lock_label)
		elif is_first:
			var buzz_label := Label.new()
			buzz_label.text = "BUZZET INN"
			buzz_label.add_theme_color_override("font_color", GameTheme.YELLOW)
			buzz_label.add_theme_font_size_override("font_size", 12)
			buzz_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			v.add_child(buzz_label)

		_scoreboard.add_child(panel)

func _style_team_banner(panel: PanelContainer, team_color: Color, active: bool) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = team_color.darkened(0.68) if not active else team_color.darkened(0.15)
	sb.border_color = team_color if not active else GameTheme.YELLOW
	sb.border_width_left = 2 if not active else 6
	sb.border_width_right = 2 if not active else 6
	sb.border_width_top = 1
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	if active:
		sb.shadow_color = team_color
		sb.shadow_size = 14
	panel.add_theme_stylebox_override("panel", sb)

func _render_question(state: Dictionary) -> void:
	var q = state.get("activeQuestionPublic", null)
	if q == null:
		_question_panel.visible = false
		return
	var phase: String = str(state.get("phase", ""))
	_question_panel.visible = phase in ["reading", "buzzing"]
	if phase in ["reading", "buzzing"]:
		var prompt: String = str(q.get("prompt", ""))
		_question_label.text = prompt
		_question_label.add_theme_font_size_override("font_size", 38 if prompt.length() < 90 else 31)

func _render_map(map: Dictionary) -> void:
	for c in _map_column.get_children():
		c.queue_free()

	var nodes: Array = map.get("nodes", [])
	var steps: int = map.get("steps", 15)
	var node_controls := {}

	# Group nodes by step so we can draw one row per step.
	var by_step := {}
	for n in nodes:
		var step: int = n.get("step", 0)
		if not by_step.has(step):
			by_step[step] = []
		by_step[step].append(n)

	# Build bottom-up: START (step 0) must end up as the LAST child in the
	# VBoxContainer (rendered at the bottom), with each higher step above it.
	# We add rows in increasing step order but always insert at index 0, so
	# each new (higher) row pushes the previous ones further down — the
	# opposite of a plain top-to-bottom append.
	for step in range(0, steps + 1):
		if not by_step.has(step):
			continue
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.add_theme_constant_override("separation", 54)

		for n in by_step[step]:
			var dot := PanelContainer.new()
			dot.custom_minimum_size = Vector2(142, 74)
			var status: String = n.get("status", "available")
			var color: Color = GameTheme.NODE_STATUS_COLOR.get(status, GameTheme.BG_PANEL)
			var sb := StyleBoxFlat.new()
			sb.bg_color = color
			sb.corner_radius_top_left = 30
			sb.corner_radius_top_right = 30
			sb.corner_radius_bottom_left = 22
			sb.corner_radius_bottom_right = 22
			sb.border_width_left = 2
			sb.border_width_right = 2
			sb.border_width_top = 2
			sb.border_width_bottom = 2
			var tier: String = str(n.get("tier", "T5"))
			var tier_colors := { "T1": Color("#D1AA4E"), "T2": Color("#A8614E"), "T3": Color("#766392"), "T4": Color("#5D8275"), "T5": Color("#687986") }
			sb.border_color = tier_colors.get(tier, Color("#765638"))
			if status == "rejected":
				sb.bg_color = Color("#171412")
				sb.border_color = Color("#3A332D")
			if status == "selected" or status == "completed":
				sb.border_width_left = 3
				sb.border_width_right = 3
				sb.border_width_top = 3
				sb.border_width_bottom = 3
				sb.border_color = GameTheme.CREAM
			if status == "selected":
				sb.border_color = GameTheme.YELLOW
				sb.shadow_color = Color("#D8A94D80")
				sb.shadow_size = 10
			dot.add_theme_stylebox_override("panel", sb)

			var lbl := Label.new()
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			if n.get("id", "") == "START":
				lbl.text = "START"
			else:
				var category: String = str(n.get("category", "Ukjent"))
				var tier_sigil: String = GameTheme.TIER_SIGILS.get(tier, "◆")
				lbl.text = "%s\n%s  %s" % [category, tier_sigil, tier]
			lbl.add_theme_font_size_override("font_size", 15)
			lbl.add_theme_color_override("font_color", GameTheme.CREAM)
			dot.add_child(lbl)
			node_controls[str(n.get("id", ""))] = dot

			row.add_child(dot)

		_map_column.add_child(row)
		_map_column.move_child(row, 0)

	# Draw the real server-provided connections after containers have laid out
	# their node controls. Node2D children do not affect VBox layout.
	await get_tree().process_frame
	for n in nodes:
		var from_id: String = str(n.get("id", ""))
		if not node_controls.has(from_id):
			continue
		for target_id_value in n.get("nextNodeIds", []):
			var target_id: String = str(target_id_value)
			if not node_controls.has(target_id):
				continue
			var line := Line2D.new()
			var from_control: Control = node_controls[from_id]
			var target_control: Control = node_controls[target_id]
			line.add_point(from_control.global_position - _map_column.global_position + from_control.size / 2.0)
			line.add_point(target_control.global_position - _map_column.global_position + target_control.size / 2.0)
			line.width = 3.0
			line.default_color = GameTheme.YELLOW if n.get("status", "") in ["selected", "completed"] and target_id in map.get("selectedPath", []) else Color("#765638")
			line.z_index = -1
			_map_column.add_child(line)

	# The current step is now the TOP-most row (since higher steps get
	# pushed to the front). Scroll there so the active edge of the climb
	# stays in view as the game progresses.
	_map_scroll.scroll_vertical = 0
