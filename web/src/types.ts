// TRIVIA NIGHT — shared domain + protocol types.
// This file is the source of truth for the WebSocket contract.
// Mirror copies live in web/src/types.ts (React) and are re-implemented
// in GDScript for the Godot client — keep all three in sync if you change this.

export type Tier = "T1" | "T2" | "T3" | "T4" | "T5";

export const TIER_POINTS: Record<Tier, number> = {
  T1: 1000,
  T2: 800,
  T3: 600,
  T4: 400,
  T5: 200,
};

export type QuestionStatus = "unused" | "used" | "retired" | "needs_revision";

export interface Question {
  id: string;
  category: string;
  subcategory?: string;
  tier: Tier;
  prompt: string;
  answer: string;
  acceptedAlternatives: string[];
  hostNote?: string;
  media?: { type: "image" | "audio" | "video"; url: string; effect?: "none" | "pixelated" | "blurred" };
  status: QuestionStatus;
  lastUsedSession?: string;
  mode?: "buzzer" | "friend_group";
  choices?: string[];
}

export type NodeStatus = "locked" | "available" | "selected" | "rejected" | "completed";

export interface MapNode {
  id: string;
  step: number; // 0 = START
  slot: number; // 0..2 within the step, START has slot 0 only
  tier: Tier | null; // null for START
  category: string | null; // visible before selection so route choice is strategic
  status: NodeStatus;
  questionId: string | null; // assigned only when activated
  nextNodeIds: string[];
}

export interface RouteMap {
  steps: number; // total steps above START, e.g. 15
  nodes: MapNode[]; // flattened, includes START at step 0
  selectedPath: string[]; // node ids, START first
  currentStep: number; // index of the last *selected* step (0 = at START)
}

export interface Team {
  id: string;
  name: string;
  color: string; // hex, assigned from the palette on join
  score: number;
  connected: boolean;
  qualifiedForFinal: boolean;
  finalScore?: number;
  players: string[];
  photoDataUrl?: string;
}

export type GamePhase =
  | "lobby" // waiting for teams to join
  | "map" // node activated, waiting for host to start reading
  | "reading" // host reading the question aloud, buzzers closed
  | "buzzing" // buzzers open, waiting for / collecting buzzes
  | "adjudicating" // host is judging a spoken answer
  | "route_choice" // controlling team is choosing the next node
  | "final" // final round in progress
  | "ended";

export interface BuzzEntry {
  teamId: string;
  serverTimestamp: number;
}

export interface FinalState {
  finalists: string[]; // team ids, in qualification order
  questionIds: string[];
  currentIndex: number;
  scores: Record<string, number>;
}

export interface EventLogEntry {
  id: string;
  ts: number;
  message: string;
}

/** The full authoritative state. Only the host client receives this verbatim. */
export interface HostGameState {
  roomCode: string;
  gameId: string;
  phase: GamePhase;
  paused: boolean;
  targetScore: number;
  teams: Team[];
  map: RouteMap;
  activeNodeId: string | null;
  activeQuestion: Question | null; // full question incl. answer
  buzzOrder: BuzzEntry[];
  lockedOutTeamIds: string[];
  currentResponderId: string | null;
  controllingTeamId: string | null;
  finalState: FinalState | null;
  eventLog: EventLogEntry[];
  questionPoolRemaining: number;
  questionPoolTotal: number;
  friendAnswers: Record<string, string>;
}

/** Sanitized state broadcast to the TV client and team controllers — no answers. */
export interface PublicGameState {
  roomCode: string;
  phase: GamePhase;
  paused: boolean;
  targetScore: number;
  teams: Team[];
  map: RouteMap;
  activeNodeId: string | null;
  activeQuestionPublic: {
    category: string;
    tier: Tier;
    points: number;
    prompt: string;
    mode?: "buzzer" | "friend_group";
    choices?: string[];
    media?: Question["media"];
  } | null;
  buzzOrder: { teamId: string }[]; // no timestamps needed publicly
  lockedOutTeamIds: string[];
  currentResponderId: string | null;
  controllingTeamId: string | null;
  finalState: FinalState | null;
  legalNextNodeIds: string[];
  friendAnswersSubmitted: string[];
}

// ---------- Client -> Server messages ----------

export type ClientMessage =
  | { type: "host:create_room" }
  | { type: "host:add_team"; roomCode: string }
  | { type: "host:remove_team"; roomCode: string; teamId: string }
  | { type: "host:update_team"; roomCode: string; teamId: string; name: string; players: string[] }
  | { type: "host:set_target"; roomCode: string; targetScore: number }
  | { type: "host:resume_room"; roomCode: string; sessionToken: string }
  | { type: "team:join"; roomCode: string; teamName: string; players: string[]; photoDataUrl?: string }
  | { type: "team:resume"; roomCode: string; teamId: string; sessionToken: string }
  | { type: "team:buzz"; roomCode: string; teamId: string }
  | { type: "team:choose_route"; roomCode: string; teamId: string; nodeId: string }
  | { type: "team:submit_friend_answer"; roomCode: string; teamId: string; answer: string }
  | { type: "tv:hello"; roomCode: string }
  | { type: "host:start_reading"; roomCode: string }
  | { type: "host:open_buzzers"; roomCode: string }
  | { type: "host:mark_correct"; roomCode: string; teamId: string }
  | { type: "host:mark_wrong"; roomCode: string; teamId: string }
  | { type: "host:skip_question"; roomCode: string }
  | { type: "host:pause"; roomCode: string }
  | { type: "host:resume"; roomCode: string }
  | { type: "host:adjust_score"; roomCode: string; teamId: string; delta: number }
  | { type: "host:advance_final"; roomCode: string }
  | { type: "host:reveal_friend_answers"; roomCode: string };

// ---------- Server -> Client messages ----------

export type ServerMessage =
  | { type: "room:created"; roomCode: string; sessionToken: string }
  | { type: "state:public"; state: PublicGameState }
  | { type: "state:host"; state: HostGameState }
  | { type: "team:joined"; teamId: string; roomCode: string; sessionToken: string }
  | { type: "error"; message: string };
