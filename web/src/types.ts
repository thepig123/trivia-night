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

export function isGutta(category: string | null | undefined): boolean {
  return category?.trim().toLocaleLowerCase("nb-NO") === "gutta";
}
export function questionPoints(question: {category?: string | null; tier?: Tier | null}): number {
  return isGutta(question.category) ? 500 : question.tier ? TIER_POINTS[question.tier] : 0;
}

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
  revealMedia?: { type: "image" | "audio"; url: string };
  status: QuestionStatus;
  lastUsedSession?: string;
  mode?: "buzzer" | "friend_group" | "private_choice" | "closest";
  choices?: string[];
  progressiveImage?: boolean;
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
  | "dead_question" // no eligible teams remain; host can reveal or skip
  | "adjudicating" // host is judging a spoken answer
  | "route_choice" // controlling team is choosing the next node
  | "qualification" // tied cutoff requires host adjudication
  | "playoff" // five equal-weight questions for the second final place
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
  roundPhase: "ready" | "reading" | "buzzing" | "adjudicating" | "resolved";
  winnerIds: string[];
  suddenDeath: boolean;
  resultNote: string | null;
}

export interface PlayoffState {
  firstQualifierId: string;
  contenders: string[];
  questionIds: string[];
  currentIndex: number;
  scores: Record<string, number>;
  roundPhase: FinalState["roundPhase"];
  suddenDeath: boolean;
}

export interface QuestionClock {
  kind: "question" | "answer" | null;
  remainingMs: number;
  deadline: number | null;
  questionRemainingMs: number;
  warningId: string | null;
}

export interface TestControllerSession {
  roomCode: string;
  teamId: string;
  sessionToken: string;
  teamName: string;
}

export interface GameFeedback { id:string; kind:"correct"|"wrong"|"qualified"|"final"|"winner"; teamIds:string[]; points?:number; label:string; createdAt:number }

export interface EventLogEntry {
  id: string;
  ts: number;
  message: string;
}

/** The full authoritative state. Only the host client receives this verbatim. */
export interface HostGameState {
  roomCode: string;
  isTestRoom: boolean;
  eventMode: boolean;
  feedback: GameFeedback | null;
  gameId: string;
  phase: GamePhase;
  paused: boolean;
  questionClock: QuestionClock;
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
  playoffState: PlayoffState | null;
  qualificationPurpose: "first" | "second";
  eventLog: EventLogEntry[];
  questionPoolRemaining: number;
  questionPoolTotal: number;
  friendAnswers: Record<string, string>;
  startedAt: number | null;
  questionsPlayed: number;
  imageRevealStage: number;
  canRevealQuestion: boolean;
  canDismissQuestionCard: boolean;
  canUndo: boolean;
  undoLabel: string | null;
  canReplaceQuestion: boolean;
  legalNextNodeIds: string[];
  finalCandidateIds: string[];
}

/** Sanitized state broadcast to the TV client and team controllers — no answers. */
export interface PublicGameState {
  roomCode: string;
  isTestRoom: boolean;
  eventMode: boolean;
  feedback: GameFeedback | null;
  phase: GamePhase;
  paused: boolean;
  questionClock: QuestionClock;
  targetScore: number;
  teams: Team[];
  map: RouteMap;
  activeNodeId: string | null;
  activeQuestionPublic: {
    id: string;
    category: string;
    tier: Tier;
    points: number;
    prompt: string;
    mode?: "buzzer" | "friend_group" | "private_choice" | "closest";
    choices?: string[];
    progressiveImage?: boolean;
    media?: Question["media"];
  } | null;
  buzzOrder: { teamId: string }[]; // no timestamps needed publicly
  lockedOutTeamIds: string[];
  currentResponderId: string | null;
  controllingTeamId: string | null;
  finalState: FinalState | null;
  playoffState: PlayoffState | null;
  qualificationPurpose: "first" | "second";
  legalNextNodeIds: string[];
  finalCandidateIds: string[];
  friendAnswersSubmitted: string[];
  imageRevealStage: number;
  questionCardDismissed: boolean;
  revealedQuestion: { prompt: string; answer: string; media?: Question["media"]; results?: {teamId:string; answer:string; correct:boolean; distance?:number}[] } | null;
}

// ---------- Client -> Server messages ----------

export type ClientMessage =
  | { type: "host:create_room"; adminKey: string; testMode?: boolean; eventMode?: boolean }
  | { type: "host:list_events"; adminKey: string }
  | { type: "host:recover_event"; adminKey: string; roomCode: string }
  | { type: "host:choose_route"; roomCode: string; nodeId: string }
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
  | { type: "host:undo"; roomCode: string }
  | { type: "host:replace_question"; roomCode: string }
  | { type: "host:finish_route"; roomCode: string }
  | { type: "host:select_finalists"; roomCode: string; teamIds: string[] }
  | { type: "host:advance_playoff"; roomCode: string }
  | { type: "host:select_first_qualifier"; roomCode: string; teamId: string }
  | { type: "host:advance_final"; roomCode: string }
  | { type: "host:reveal_friend_answers"; roomCode: string }
  | { type: "host:advance_image"; roomCode: string }
  | { type: "host:reveal_question"; roomCode: string }
  | { type: "host:dismiss_question_card"; roomCode: string };

// ---------- Server -> Client messages ----------

export interface SavedEventSummary { roomCode: string; phase: GamePhase; teams: string[]; startedAt: number | null }

export type ServerMessage =
  | { type: "host:events"; events: SavedEventSummary[] }
  | { type: "room:created"; roomCode: string; sessionToken: string; testControllers?: TestControllerSession[] }
  | { type: "state:public"; state: PublicGameState }
  | { type: "state:host"; state: HostGameState }
  | { type: "team:joined"; teamId: string; roomCode: string; sessionToken: string }
  | { type: "error"; message: string; code?: "session_expired" };


export function numericAnswer(value: string): number | null {
  const text=value.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return null;
  const number=Number(text.replace(",", "."));
  return Number.isFinite(number) && Math.abs(number)<=1e15 ? number : null;
}
