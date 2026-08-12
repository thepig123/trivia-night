extends Node
## Autoload: color + tier constants shared by all TV scenes.
## Keep these values in sync with web/src/styles/theme.css and server/src/palette.ts.

const BG_DEEP := Color("#170C29")
const BG_PANEL := Color("#241541")
const PINK := Color("#FF3D81")
const TEAL := Color("#00E5C7")
const YELLOW := Color("#FFC93C")
const VIOLET := Color("#8C52FF")
const SKY := Color("#38B6FF")
const CORAL := Color("#FF5C5C")
const CREAM := Color("#FFF6EE")

const TEAM_COLORS := [
	Color("#FF3D81"),
	Color("#00E5C7"),
	Color("#FFC93C"),
	Color("#8C52FF"),
	Color("#38B6FF"),
	Color("#FF7A3D"),
	Color("#7CFF6B"),
	Color("#FF5C5C"),
]

const TIER_POINTS := {
	"T1": 1000,
	"T2": 800,
	"T3": 600,
	"T4": 400,
	"T5": 200,
}

const NODE_STATUS_COLOR := {
	"available": Color("#4A3B70"),
	"selected": Color("#FFC93C"),
	"rejected": Color("#241541"),
	"completed": Color("#00E5C7"),
	"locked": Color("#241541"),
}
