extends Node
## Autoload: color + tier constants shared by all TV scenes.
## Keep these values in sync with web/src/styles/theme.css and server/src/palette.ts.

const BG_DEEP := Color("#110F12")
const BG_PANEL := Color("#211B19")
const PINK := Color("#9F3E39")
const TEAL := Color("#5B8975")
const YELLOW := Color("#D8A94D")
const VIOLET := Color("#745B86")
const SKY := Color("#667F92")
const CORAL := Color("#B74C3F")
const CREAM := Color("#EEE0C4")

const TEAM_COLORS := [
	Color("#B74C3F"), Color("#5B8975"), Color("#D8A94D"), Color("#745B86"),
	Color("#667F92"), Color("#A8693D"), Color("#789157"), Color("#9F3E39"),
]

const TIER_POINTS := {
	"T1": 1000,
	"T2": 800,
	"T3": 600,
	"T4": 400,
	"T5": 200,
}

const NODE_STATUS_COLOR := {
	"available": Color("#51463D"),
	"selected": Color("#7A602D"),
	"rejected": Color("#211B19"),
	"completed": Color("#5B704F"),
	"locked": Color("#211B19"),
}

const TIER_SIGILS := { "T1": "♛", "T2": "⚔", "T3": "◆", "T4": "⬟", "T5": "✦" }
const CATEGORY_SIGILS := {
	"Science": "⚗", "History": "♜", "Geography": "⌖",
	"Entertainment": "★", "Sports": "⚑",
}
