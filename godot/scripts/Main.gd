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
	ServerConnection.connect_to_server(_url_input.text.strip_edges())
	# Say hello once connected — handled by ServerConnection when the socket opens,
	# but we set the pending room code now so it fires as soon as it's ready.
	ServerConnection.set_pending_room(_room_input.text.strip_edges().to_upper())

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

	var root_v := VBoxContainer.new()
	root_v.set_anchors_preset(Control.PRESET_FULL_RECT)
	root_v.add_theme_constant_override("separation", 12)
	_game_layer.add_child(root_v)

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

	_render_scoreboard(state.get("teams", []), state.get("currentResponderId", ""), state.get("lockedOutTeamIds", []))
	_render_question(state)
	_render_map(state.get("map", {}))

func _render_scoreboard(teams: Array, current_responder_id, locked: Array) -> void:
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
			dot.custom_minimum_size = Vector2(56, 56)
			var status: String = n.get("status", "available")
			var color: Color = GameTheme.NODE_STATUS_COLOR.get(status, GameTheme.BG_PANEL)
			var sb := StyleBoxFlat.new()
			sb.bg_color = color
			sb.corner_radius_top_left = 28
			sb.corner_radius_top_right = 28
			sb.corner_radius_bottom_left = 28
			sb.corner_radius_bottom_right = 28
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
			lbl.text = "START" if n.get("id", "") == "START" else str(n.get("tier", ""))
			lbl.add_theme_font_size_override("font_size", 10)
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
