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
	subtitle.text = "TV / Shared Game Client"
	subtitle.add_theme_color_override("font_color", GameTheme.TEAL)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(subtitle)

	_url_input = LineEdit.new()
	_url_input.text = "ws://127.0.0.1:8080"
	_url_input.placeholder_text = "Server URL"
	v.add_child(_url_input)

	_room_input = LineEdit.new()
	_room_input.placeholder_text = "Room code (from the host panel)"
	v.add_child(_room_input)

	var connect_btn := Button.new()
	connect_btn.text = "Connect"
	connect_btn.custom_minimum_size = Vector2(0, 48)
	connect_btn.pressed.connect(_on_connect_pressed)
	v.add_child(connect_btn)

	_status_label = Label.new()
	_status_label.text = "Not connected."
	_status_label.add_theme_color_override("font_color", GameTheme.CREAM)
	_status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_status_label)

func _on_connect_pressed() -> void:
	_status_label.text = "Connecting…"
	# Say hello once connected — handled by ServerConnection when the socket opens,
	# but we set the pending room code now so it fires as soon as it's ready.
	ServerConnection.set_pending_room(_room_input.text.strip_edges().to_upper())
	ServerConnection.connect_to_server(_url_input.text.strip_edges())

func _on_connection_changed(is_connected: bool) -> void:
	_connected = is_connected
	_status_label.text = "Connected. Waiting for room state…" if is_connected else "Disconnected. Retrying…"

func _on_server_error(message: String) -> void:
	_status_label.text = "Error: " + message

# ---------------- Main game layer ----------------

func _build_game_layer() -> void:
	_game_layer = CanvasLayer.new()
	add_child(_game_layer)

	var bg := ColorRect.new()
	bg.color = GameTheme.BG_DEEP
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_game_layer.add_child(bg)

	var root_h := HBoxContainer.new()
	root_h.set_anchors_preset(Control.PRESET_FULL_RECT)
	root_h.add_theme_constant_override("separation", 14)
	_game_layer.add_child(root_h)

	var root_v := VBoxContainer.new()
	root_v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root_v.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root_v.add_theme_constant_override("separation", 12)
	root_h.add_child(root_v)

	# --- Top bar ---
	var top_bar := HBoxContainer.new()
	top_bar.custom_minimum_size = Vector2(0, 70)
	root_v.add_child(top_bar)

	var title := Label.new()
	title.text = "TRIVIA NIGHT"
	title.add_theme_font_size_override("font_size", 34)
	title.add_theme_color_override("font_color", GameTheme.CREAM)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top_bar.add_child(title)

	_room_label = Label.new()
	_room_label.add_theme_font_size_override("font_size", 28)
	_room_label.add_theme_color_override("font_color", GameTheme.YELLOW)
	top_bar.add_child(_room_label)

	_phase_label = Label.new()
	_phase_label.add_theme_font_size_override("font_size", 20)
	_phase_label.add_theme_color_override("font_color", GameTheme.TEAL)
	root_v.add_child(_phase_label)

	# --- Scoreboard ---
	_scoreboard = HBoxContainer.new()
	_scoreboard.add_theme_constant_override("separation", 14)
	_scoreboard.custom_minimum_size = Vector2(0, 110)
	root_v.add_child(_scoreboard)

	# --- Active question banner ---
	_question_panel = PanelContainer.new()
	_question_panel.custom_minimum_size = Vector2(0, 90)
	root_v.add_child(_question_panel)
	_style_panel(_question_panel, GameTheme.BG_PANEL)

	_question_label = Label.new()
	_question_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_question_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_question_label.add_theme_font_size_override("font_size", 26)
	_question_label.add_theme_color_override("font_color", GameTheme.CREAM)
	_question_panel.add_child(_question_label)

	# --- Route map ---
	_map_scroll = ScrollContainer.new()
	_map_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root_v.add_child(_map_scroll)

	_map_column = VBoxContainer.new()
	_map_column.alignment = BoxContainer.ALIGNMENT_END
	_map_column.add_theme_constant_override("separation", 10)
	_map_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_map_scroll.add_child(_map_column)

	root_h.add_child(_build_tier_legend())

func _build_tier_legend() -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(205, 0)
	_style_panel(panel, GameTheme.BG_PANEL)

	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	panel.add_child(v)

	var heading := Label.new()
	heading.text = "TIER BOUNTY"
	heading.add_theme_font_size_override("font_size", 19)
	heading.add_theme_color_override("font_color", GameTheme.YELLOW)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(heading)

	for tier in ["T1", "T2", "T3", "T4", "T5"]:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var icon := Label.new()
		icon.text = GameTheme.TIER_SIGILS.get(tier, "◆")
		icon.custom_minimum_size = Vector2(28, 0)
		icon.add_theme_color_override("font_color", GameTheme.YELLOW)
		icon.add_theme_font_size_override("font_size", 20)
		row.add_child(icon)
		var label := Label.new()
		label.text = tier
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.add_theme_font_size_override("font_size", 18)
		row.add_child(label)
		var value := Label.new()
		value.text = str(GameTheme.TIER_POINTS[tier])
		value.add_theme_color_override("font_color", GameTheme.CREAM)
		value.add_theme_font_size_override("font_size", 18)
		row.add_child(value)
		v.add_child(row)

	var note := Label.new()
	note.text = "Harder encounters\nyield greater rewards."
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.add_theme_color_override("font_color", Color("#B8A98D"))
	note.add_theme_font_size_override("font_size", 13)
	v.add_child(note)
	return panel

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

# ---------------- State rendering ----------------

func _on_state_received(state: Dictionary) -> void:
	if not _has_state:
		_has_state = true
		_connect_layer.visible = false
		_game_layer.visible = true

	_room_label.text = "ROOM " + str(state.get("roomCode", ""))
	_phase_label.text = "PHASE: " + str(state.get("phase", "")).to_upper()

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
		var team_color := Color(str(team.get("color", "#4A3B70")))
		var is_first: bool = team.get("id", "") == first_buzz_id
		_style_panel(panel, team_color.darkened(0.6) if not is_first else team_color.darkened(0.2))

		var v := VBoxContainer.new()
		panel.add_child(v)

		var name_label := Label.new()
		name_label.text = str(team.get("name", "Team"))
		name_label.add_theme_color_override("font_color", team_color)
		name_label.add_theme_font_size_override("font_size", 18)
		v.add_child(name_label)

		var score_label := Label.new()
		score_label.text = str(team.get("score", 0))
		score_label.add_theme_color_override("font_color", GameTheme.CREAM)
		score_label.add_theme_font_size_override("font_size", 30)
		v.add_child(score_label)

		var progress_label := Label.new()
		if team.get("qualifiedForFinal", false):
			progress_label.text = "FINALIST"
			progress_label.add_theme_color_override("font_color", GameTheme.YELLOW)
		else:
			progress_label.text = "%d TO FINAL" % max(0, target_score - int(team.get("score", 0)))
			progress_label.add_theme_color_override("font_color", Color("#B8A98D"))
		progress_label.add_theme_font_size_override("font_size", 11)
		v.add_child(progress_label)

		if team.get("id", "") in locked:
			var lock_label := Label.new()
			lock_label.text = "LOCKED OUT"
			lock_label.add_theme_color_override("font_color", GameTheme.CORAL)
			lock_label.add_theme_font_size_override("font_size", 12)
			v.add_child(lock_label)
		elif is_first:
			var buzz_label := Label.new()
			buzz_label.text = "BUZZED IN"
			buzz_label.add_theme_color_override("font_color", GameTheme.YELLOW)
			buzz_label.add_theme_font_size_override("font_size", 12)
			v.add_child(buzz_label)

		_scoreboard.add_child(panel)

func _render_question(state: Dictionary) -> void:
	var q = state.get("activeQuestionPublic", null)
	if q == null:
		_question_label.text = "—"
		return
	var points = GameTheme.TIER_POINTS.get(q.get("tier", "T5"), 0)
	_question_label.text = "%s  ·  %s  ·  %d pts" % [q.get("category", ""), q.get("tier", ""), points]

func _render_map(map: Dictionary) -> void:
	for c in _map_column.get_children():
		c.queue_free()

	var nodes: Array = map.get("nodes", [])
	var steps: int = map.get("steps", 15)

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
		row.add_theme_constant_override("separation", 24)

		for n in by_step[step]:
			var dot := PanelContainer.new()
			dot.custom_minimum_size = Vector2(108, 66)
			var status: String = n.get("status", "available")
			var color: Color = GameTheme.NODE_STATUS_COLOR.get(status, GameTheme.BG_PANEL)
			var sb := StyleBoxFlat.new()
			sb.bg_color = color
			sb.corner_radius_top_left = 22
			sb.corner_radius_top_right = 22
			sb.corner_radius_bottom_left = 15
			sb.corner_radius_bottom_right = 15
			sb.border_width_left = 2
			sb.border_width_right = 2
			sb.border_width_top = 2
			sb.border_width_bottom = 2
			sb.border_color = Color("#765638")
			if status == "selected" or status == "completed":
				sb.border_width_left = 3
				sb.border_width_right = 3
				sb.border_width_top = 3
				sb.border_width_bottom = 3
				sb.border_color = GameTheme.CREAM
			dot.add_theme_stylebox_override("panel", sb)

			var lbl := Label.new()
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			if n.get("id", "") == "START":
				lbl.text = "START"
			else:
				var tier: String = str(n.get("tier", "T5"))
				var category: String = str(n.get("category", "Unknown"))
				lbl.text = "%s\n%s · %d" % [category, tier, GameTheme.TIER_POINTS.get(tier, 0)]
			lbl.add_theme_font_size_override("font_size", 12)
			lbl.add_theme_color_override("font_color", GameTheme.CREAM)
			dot.add_child(lbl)

			row.add_child(dot)

		_map_column.add_child(row)
		_map_column.move_child(row, 0)

	# The current step is now the TOP-most row (since higher steps get
	# pushed to the front). Scroll there so the active edge of the climb
	# stays in view as the game progresses.
	await get_tree().process_frame
	_map_scroll.scroll_vertical = 0
