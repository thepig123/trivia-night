# TRIVIA NIGHT — playable MVP

This implements the "thin end-to-end slice" from your design doc's Development
Plan (Phase 1): create a room, join teams, activate a question, buzz,
adjudicate, award points, choose a route, activate the next question — all
server-authoritative, exactly as section 8 specifies.

```
trivia-night/
  server/   Node + TypeScript WebSocket server — the single source of truth
  web/      React app — team controller (phones) + host admin panel (laptop)
  godot/    Godot 4 project — the shared TV client
```

## 1. Run the server

```
cd server
npm install
npm run dev
```

Starts a WebSocket server on `ws://localhost:8080`. Every room lives in
memory (`GameEngine` in `src/gameState.ts`) — restarting the server clears
all rooms, matching Phase 1 scope (persistence/reconnect hardening is Phase 2
in your doc).

## 2. Run the web app (team controllers + host panel)

```
cd web
npm install
npm run dev
```

Opens at `http://localhost:5173`.

- `/host` — create a room, run the private admin panel (question text,
  answer, Correct/Wrong, score adjustments, event log).
- `/join` — the team-facing join screen and buzzer, meant to be opened on
  phones. On a real event, put this URL + the room code on a slide or sign.

If your phones aren't on the same machine, set `VITE_WS_URL` in a `web/.env`
file to your laptop's LAN IP, e.g. `VITE_WS_URL=ws://192.168.1.42:8080`, and
run `npm run dev -- --host` so the dev server is reachable on the LAN.

## 3. Run the Godot TV client

Open `godot/` as a project in Godot **4.2+**. Press Play. On the connect
screen, enter the server URL (`ws://127.0.0.1:8080` by default, or your LAN
IP) and the room code shown in the host panel, then Connect.

The TV client is a pure renderer: it draws whatever `state:public` snapshot
the server sends (scores, route map, active category/tier, buzz status) and
never computes anything itself, per your doc's authoritative-state
principle. Everything is built at runtime from `scripts/Main.gd` — there's
no hand-built scene tree to fight with in the editor, so it's easy to
restyle.

## How a round works end-to-end

1. Host clicks **Reveal first question** (or, after a route choice,
   the server auto-activates the next node).
2. Host clicks **Start reading**, reads the question aloud, then **Open
   buzzers**.
3. Teams tap **BUZZ** on their phones. The server timestamps the first valid
   buzz and locks in adjudication order.
4. Host marks **Correct** or **Wrong** for the team that's up.
   - Correct → points awarded, that team becomes "controlling," and (once
     the route-choice screen resolves) chooses the next of three route
     nodes.
   - Wrong → that team is locked out for this question; buzzing reopens for
     everyone else still eligible.
5. Repeat until two teams reach the target score (10,000) or the 15-step map
   runs out, at which point the top two scores enter the Final.

## Decisions I made to get to a playable build

Your doc flags several things as open (`Open Questions and Next Decisions`).
I picked defaults so the MVP runs; all are easy to change in one place:

| Decision | Default | Where to change |
|---|---|---|
| Map length | 15 steps (matches your completed Godot prototype) | `server/src/map.ts` → `TOTAL_STEPS` |
| Tier pacing (easy low, hard high) | banded random pool | `server/src/map.ts` → `TIER_BANDS` |
| Wrong-answer handling | locks out that team only; buzzing reopens for the rest | `GameEngine.markWrong` in `server/src/gameState.ts` |
| Final format | placeholder: top two scores at map-end also qualify; a 5-question final pool is drawn but scoring/win-condition UI isn't built out (doc explicitly leaves this undefined) | `GameEngine.startFinal`, `web/src/pages/Host.tsx` → `FinalPanel` |
| Question budget | 50 questions shipped (5 categories × 5 tiers × 2), matching your primary target | `server/src/data/questions.json` |
| Team colors | 8-color vibrant palette, auto-assigned on join | `server/src/palette.ts` |
| Elite/wager nodes | not implemented (doc: "should not block the first vertical slice") | — |

## Editing questions

`server/src/data/questions.json` is a flat array matching the `Question`
type in `server/src/types.ts` (category, tier, prompt, answer, accepted
alternatives, host note, status). Add, edit, or bulk-replace this file to
build your real 50-75 question set — no code changes needed.

## Visual direction

Palette is defined once per surface and kept in sync by convention:
`server/src/palette.ts`, `web/src/styles/theme.css`, and
`godot/scripts/GameTheme.gd`. It's a vibrant party-game palette — deep
plum background, hot pink / electric teal / golden yellow / violet accents,
chunky rounded display type (Baloo 2) over a clean geometric body face
(Space Grotesk) — built for TV-distance readability and a satisfying,
Jackbox-like buzzer feel.

## What's next (from your Phase 2/3)

- Reconnect/resume handling if a phone drops mid-game.
- Wire up a real Final format once you've decided it.
- Elite/wager nodes.
- Question status tooling (mark retired/needs-revision from the admin panel
  instead of only in the JSON file).
