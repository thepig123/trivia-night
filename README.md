# TRIVIA NIGHT — playable MVP

This implements the "thin end-to-end slice" from your design doc's Development
Plan (Phase 1): create a room, join teams, activate a question, buzz,
adjudicate, award points, choose a route, activate the next question — all
server-authoritative, exactly as section 8 specifies.

```
trivia-night/
  server/   Node + TypeScript WebSocket server — the single source of truth
  web/      React app — team controller (phones) + host admin panel (laptop)
  godot-prototype-not-in-use/  Archived Godot 4 TV prototype
```

## Quick start from the repository root

Use Node.js **22.12+** (Node 24 is supported) and npm **10+**.
The server imports question data using JSON import attributes, so older
Node versions are not supported by this setup.

```sh
npm install
npm run start
```

One install sets up the `server` and `web` npm workspaces. Start runs both
development servers together; Ctrl+C stops both. Open
`http://localhost:5173/host` for the host panel and
`http://localhost:5173/join` for teams. The WebSocket server uses port 8080.
The Godot TV client still runs separately (see below).

| Root command | Purpose |
|---|---|
| `npm start` / `npm run start` | Start both apps in development mode |
| `npm run dev` | Same as start, with automatic reload on edits |
| `npm run dev:lan` | Expose the web app for phones on the same network |
| `npm run build` | Compile the server and build the web app |
| `npm test` | Run the server game-engine tests |
| `npm run start:server` | Run the compiled server after building |
| `npm run start:built` | Run the compiled server and preview the built web app on port 4173 |

`start:built` is for local verification; Vite preview is not a production
hosting server. For phone play, run `npm run dev:lan` and open
`http://YOUR-LAPTOP-IP:5173/join` on each phone. By default, the web app
connects to port 8080 on the same hostname you opened in the browser.
If the backend uses a different host or port, set `VITE_WS_URL` in `web/.env`.
Allow ports 5173 and 8080 through the host computer's firewall if needed.
Changing the server's `PORT` also requires updating `VITE_WS_URL`.

Commit the root `package-lock.json`; use `npm ci` for reproducible installs.

## 1. Run the server separately (optional)

```
cd server
npm install
npm run dev
```

Starts a WebSocket server on `ws://localhost:8080`. Rooms are saved atomically to `server/runtime/rooms.json`, including scores,
question usage, Final state, host/team reconnect tokens and Undo history.
A recovered game is paused and all teams start offline until they reconnect.
The host must press Resume after checking the restored state.

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

For phones, use the root `npm run dev:lan` command described above.

## 3. Run the React TV client

Open `http://localhost:5173/tv`, enter the room code shown in the host panel,
and use the browser's fullscreen mode on the shared TV/projector.

The TV route is a pure renderer: it draws whatever `state:public` snapshot
the server sends (scores, route map, active category/tier, buzz status) and
never computes anything itself, per your doc's authoritative-state
principle. Everything is built at runtime from `scripts/Main.gd` — there's
It reuses the same `RouteMap` React component as the team controller, with
TV-specific scaling and a longer lookahead.

The original Godot implementation is preserved under
`godot-prototype-not-in-use/` as a learning reference and possible foundation
for a future 3D doors-and-dungeon edition. It is no longer the supported TV
client for the current game.

The route is an endless procedural climb. The server keeps five connected rows
ahead of the players and extends the map as they advance. Each row contains a
shuffled easy/medium/hard spread for that section of the climb. Encounter nodes
show category and tier sigil; the separate tier table carries point values. Real route lines determine which nodes
can be reached. Phones render a compact window around the current position.
Merely previewing or rejecting a node never consumes a question.

Routes may contain deliberate committed stretches with one available node, but
never for more than three consecutive encounters. The next row then branches or
reconnects to restore a meaningful choice.

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
5. Repeat until two teams reach the target score (10,000 by default). The host
   may adjust the target in 500-point increments if the event is running long.
   Qualified teams become spectators while the remaining teams race onward.

## Teams and Friend Group rounds

One player from each team opens `/join`, enters the room code, team name, and
both player names, then that shared phone represents the team. Rooms accept up
to five teams; the planned format is four teams of two. The host panel receives
each registration automatically and stays focused on monitoring and scoring.

When the host starts reading, the public question prompt appears in a centered
game-show card over the TV map. The card contains only the question in large
type—no category, tier, points, or other metadata. It remains visible while
buzzers are open, then disappears as soon as the first team buzzes so nobody
can buzz early and keep reading. Public snapshots include the prompt but never
expose the answer.

The TV is deliberately minimal: the route map owns the full central stage and
an edge-to-edge, fixed-height scoreboard spans the bottom. Each team receives
an equal-width cell, so three to five teams cannot overlap or resize each other.
The current responder is highlighted inside its cell without moving layout.
Tier values remain on the phone UI rather than occupying permanent TV space.

Category and interaction are independent. A Gutta question can use text/emoji,
image/audio buzzer, or private multiple choice just like any other category.
Private-choice answers stay hidden until the host reveals; every correct team
scores and the trailing correct non-finalist receives route control.

## Decisions I made to get to a playable build

Your doc flags several things as open (`Open Questions and Next Decisions`).
I picked defaults so the MVP runs; all are easy to change in one place:

| Decision | Default | Where to change |
|---|---|---|
| Map length | Infinite; five connected rows generated ahead | `server/src/map.ts` → `LOOKAHEAD_ROWS` |
| Tier pacing | Controlled three-tier spread, shuffled per row | `server/src/map.ts` → `tiersForStep` |
| Wrong-answer handling | subtract full question value, allow negative scores, lock out team, reopen for eligible teams | `GameEngine.markWrong` in `server/src/gameState.ts` |
| Final format | Five questions, separate scores starting at zero, extra questions on ties, explicit winner/shared-result screen | `GameEngine.startFinal`, `web/src/pages/Host.tsx` → `FinalPanel` |
| Question bank | Private import; 195 reviewed candidates + 55 archived examples after import | `/questions` |
| Team colors | 8-color vibrant palette, auto-assigned on join | `server/src/palette.ts` |
| Elite/wager nodes | not implemented (doc: "should not block the first vertical slice") | — |

## Question bank: `/questions`

Start the app, open `http://localhost:5173/questions`, and enter the editor key
printed in the server terminal. This key protects the full bank, including
answers; it is separate from room codes and is kept only in the browser tab's
session storage. You can also open the bank from the host panel.

The repository starts with an empty bank. Import your private
`Trivia_Night_Reviewed_Bank.json` via **Importer CSV / JSON**, review the
summary, and apply it. This file was converted from
`Trivia_Night_Question_Bank_Reviewed.xlsx` and is deliberately kept out of Git:

195 candidates with original IDs, PICK/MAYBE/UNREVIEWED decisions, notes,
accepted answers, sources, asset briefs and original format descriptions.
All 127 picks are in the imported evening pack; only 91 are initially playable.
Media-dependent and unsupported formats remain drafts/need media. The 55 old
examples are archived and excluded. `questions.json` is now only a legacy
engine-test fixture; live rooms use the bank.

### Prepare an evening

1. Search/filter by category, selection, format or readiness.
2. Create, edit or duplicate questions. Category is free text; use Gutta for
   friend-specific questions. Choose the interaction separately.
3. For supported formats, fill the prompt, answer, accepted alternatives and
   private host notes. Upload image/audio clues and optional reveal media.
4. Preview TV, phone and host views. Mark PICK + Klar only when ready.
5. Include questions with the pack checkboxes. Create an empty pack or copy
   an existing one for another evening. The active pack supplies new rooms.

Supported now: text/emoji buzzer, image/audio buzzer and private multiple choice.
Closest-number, sorting, list challenges, wagers, progressive images and timer
challenges can be authored and saved as drafts, but cannot be marked ready.
Multiple choice needs at least two distinct choices and an exact matching
correct answer. The editor and server both validate ready questions.

Each new room gets a deep copy of its active pack at **room creation**, not
start-reading. Bank edits afterward affect future rooms only. Maps derive
category/tier choices from that room's selected pool. If an advertised pair
runs out, activation falls back to remaining questions and updates the node's
actual category/tier/points. Creating a room with no playable questions gives
an actionable error.

The host can reveal the previous question's answer and optional reveal media
on TV with **Vis fasit på TV**. The next reading clears it. Private-choice
rounds reveal automatically. Audio pauses on buzz/game pause and resumes after
an incorrect answer without restarting the clip. Browsers may require someone
to press Play on the TV before audio is allowed.

### Persistence, import and backup

Edits save atomically to `server/runtime/question-bank.json`; stale revisions
are rejected instead of overwriting someone else's changes. Uploads live in
`server/runtime/media/`, and the generated editor key is stored alongside them.
This folder is ignored by Git and survives server restarts. Room progress and reconnect tokens are stored separately in `rooms.json`
in the same runtime folder. Back up that folder to preserve the live game too.

- Export JSON for the full bank and evening packs. Import previews new,
  updated and unchanged questions by stable ID before applying. Pack IDs are
  also preserved; matching packs update and unrelated packs remain.
- Export CSV to edit in Excel/Sheets, then import CSV back. Original QUESTION
  BANK sheet column names are supported too; save that tab as UTF-8 CSV.
  Quoted commas, Unicode and multiline cells are preserved. XLSX is not a
  direct upload format.
- Imports upsert; they never delete unrelated questions. A CSV import does
  not automatically add new questions to an evening pack.
- JSON/CSV exports do **not** contain media bytes. Back up/copy the whole
  runtime folder to preserve uploads and the key when moving computers.

Override `BANK_DATA_DIR` for a different persistent directory, or
`BANK_ADMIN_KEY` for an explicit editor key. Keep runtime files out of Git.
Image/audio uploads are limited to 15 MB. Accepted uploads: PNG, JPEG, GIF,
WebP, MP3, WAV, OGG and M4A.

Vite development and preview proxy `/api` and `/media` to port 8080. With a
custom backend, set `TRIVIA_BACKEND_URL` for the proxy and `VITE_WS_URL` for
WebSockets. A production reverse proxy must route both HTTP paths and the
WebSocket connection to the backend.

## Visual direction

Palette is defined once per surface and kept in sync by convention:
`server/src/palette.ts`, `web/src/styles/theme.css`, and
`godot/scripts/GameTheme.gd`. The current direction is an original dark-fantasy
roguelike expedition: weathered map surfaces, torch-gold highlights, muted
gem tones, encounter sigils, and tier bounties. It takes inspiration from the
feeling of climbing a dangerous branching map without copying any game assets.

## Host recovery controls and timing

- At least two teams must join before the first question starts. The host can
  correct names/player names and remove teams while still in the lobby.
- The host can override a legal route choice if the controlling phone is offline.
- Presence is counted across all connections for a team; closing one tab does
  not disconnect another. Socket heartbeats detect stale connections. When the
  last host connection closes, the game pauses until the host resumes it.
- **Angre** restores up to five scoring/route/question actions and pauses the
  game for inspection. Current connection status and team photos are preserved.
- **Bytt aktivt spørsmål** swaps in an unused question, clears buzzes/private
  answers and returns to reading preparation. The old question stays used.
- Buzzing has a 30-second server clock. A buzz freezes the main clock and starts
  five seconds to **begin** answering. Click **Laget har begynt å svare** as soon
  as speech starts; it stops that clock so longer spoken answers are allowed.
  Correct/Wrong can also be used directly. Silence incurs the normal penalty.
- After a wrong answer, remaining teams get at least five seconds. With no
  eligible teams, or when question time runs out, the host reveals/skips.
  Private-choice questions reveal automatically on timeout.
- Pause and restart recovery freeze clocks. Undo grants at least five seconds
  on a restored running clock. Incoming commands are validated at runtime;
  malformed fields cannot turn scores into strings/NaN or bypass role checks.

## Final rules

A room reserves up to five questions (at most one third of a small bank) for
its Final. Both finalists start at zero Final points; route scores are retained
separately. Other teams spectate. Ordinary questions use ± their tier value;
private-choice questions award the full value to every correct finalist, with
zero for incorrect answers. Host reading, buzz, timer, pause, replacement,
Undo and reveal controls work in the Final too.

After five questions (or a shorter available set), the highest Final score wins.
A tie draws additional unused questions. In sudden death, a sole correct team
wins immediately; all-wrong / tied private answers can lead to another question.
If no new questions remain, the result explicitly says **delt seier** instead
of inventing a winner. A tie at the route qualification cutoff is different:
the host runs an oral tiebreak and selects two finalists; already qualified
teams and teams strictly above the cutoff keep their places.

## Remaining development

- Implement closest-number, sorting, list challenges, wagers, progressive
  image reveals and precision minigames currently available only as drafts.
- Run a visual/mobile/LAN playtest on the actual TV and phones.
- Recheck and supply media for the selected question bank before the event.
