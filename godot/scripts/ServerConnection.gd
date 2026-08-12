extends Node
## Autoload: thin WebSocket client. The Godot TV client never computes game
## logic locally — it only renders whatever "state:public" snapshot the
## server last sent. See server/src/types.ts for the wire format.

signal connection_changed(is_connected: bool)
signal state_received(state: Dictionary)
signal server_error(message: String)
signal room_hello_ack(room_code: String)

var _socket := WebSocketPeer.new()
var _url := "ws://127.0.0.1:8080"
var _is_connected := false
var _is_reconnecting := false
var _should_connect := false
var _room_code := ""
var _reconnect_timer: Timer

func _ready() -> void:
	_reconnect_timer = Timer.new()
	_reconnect_timer.wait_time = 1.5
	_reconnect_timer.one_shot = true
	_reconnect_timer.timeout.connect(_on_reconnect_timeout)
	add_child(_reconnect_timer)

func set_pending_room(room_code: String) -> void:
	_room_code = room_code

func connect_to_server(url: String) -> void:
	_url = url
	_should_connect = true

	# Cancel any scheduled automatic attempt before manually connecting.
	if not _reconnect_timer.is_stopped():
		_reconnect_timer.stop()

	_is_reconnecting = false

	var ready_state := _socket.get_ready_state()

	# Do not connect the same WebSocketPeer twice.
	if ready_state == WebSocketPeer.STATE_CONNECTING:
		return

	if ready_state == WebSocketPeer.STATE_OPEN:
		# The room code will be sent through the existing connection.
		if _room_code != "":
			say_hello(_room_code)
		return

	if ready_state == WebSocketPeer.STATE_CLOSING:
		return

	# Create a fresh peer after a closed connection.
	_socket = WebSocketPeer.new()

	var err := _socket.connect_to_url(_url)
	if err != OK:
		emit_signal(
			"server_error",
			"Could not start connection to %s (code %d)" % [_url, err]
		)

func say_hello(room_code: String) -> void:
	_room_code = room_code
	_send({"type": "tv:hello", "roomCode": room_code})

func send_raw(payload: Dictionary) -> void:
	_send(payload)

func _send(payload: Dictionary) -> void:
	if _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.send_text(JSON.stringify(payload))

func _on_reconnect_timeout() -> void:
	_is_reconnecting = false
	connect_to_server(_url)

func _process(_delta: float) -> void:
	_socket.poll()
	var state := _socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN and not _is_connected:
		_is_connected = true
		emit_signal("connection_changed", true)
		if _room_code != "":
			say_hello(_room_code)

	if state == WebSocketPeer.STATE_CLOSED and _is_connected:
		_is_connected = false
		emit_signal("connection_changed", false)

	if state == WebSocketPeer.STATE_CLOSED and _should_connect and not _is_connected and not _is_reconnecting:
		# Auto-reconnect a short beat after a drop, via a real Timer node
		# (avoids stacking coroutines by awaiting inside _process).
		_is_reconnecting = true
		_reconnect_timer.start()

	while _socket.get_available_packet_count() > 0:
		var packet := _socket.get_packet().get_string_from_utf8()
		var parsed = JSON.parse_string(packet)
		if parsed == null:
			continue
		match parsed.get("type", ""):
			"state:public":
				emit_signal("state_received", parsed.get("state", {}))
			"room:created":
				emit_signal("room_hello_ack", parsed.get("roomCode", ""))
			"error":
				emit_signal("server_error", parsed.get("message", "Unknown error"))
