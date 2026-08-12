import { nanoid } from "nanoid";
import type {
  BuzzEntry,
  EventLogEntry,
  FinalState,
  GamePhase,
  HostGameState,
  PublicGameState,
  Question,
  Team,
  Tier,
} from "./types.js";
import { TIER_POINTS } from "./types.js";
import { generateRouteMap, legalNextNodeIds, chooseRoute, markNodeCompleted } from "./map.js";
import { TEAM_COLORS } from "./palette.js";
import questionsData from "./data/questions.json" with { type: "json" };

const TARGET_SCORE = 10000; // doc section 7: working target score
const FINAL_QUESTION_COUNT = 5; // placeholder — doc marks Final format as "still to define"

export class GameEngine {
  roomCode: string;
  gameId: string;
  phase: GamePhase = "lobby";
  paused = false;
  targetScore = TARGET_SCORE;
  teams: Team[] = [];
  map = generateRouteMap();
  activeNodeId: string | null = null;
  activeQuestion: Question | null = null;
  buzzOrder: BuzzEntry[] = [];
  lockedOutTeamIds: string[] = [];
  controllingTeamId: string | null = null;
  finalState: FinalState | null = null;
  eventLog: EventLogEntry[] = [];
  friendAnswers: Record<string, string> = {};
  questionPool: Question[];

  constructor(roomCode: string) {
    this.roomCode = roomCode;
    this.gameId = nanoid(10);
    this.questionPool = JSON.parse(JSON.stringify(questionsData)) as Question[];
  }

  private log(message: string) {
    this.eventLog.push({ id: nanoid(6), ts: Date.now(), message });
    if (this.eventLog.length > 200) this.eventLog.shift();
  }

  // ---------- Teams ----------

  addTeam(name: string): Team {
    const color = TEAM_COLORS[this.teams.length % TEAM_COLORS.length];
    const team: Team = {
      id: nanoid(8),
      name: name.trim().slice(0, 24) || `Team ${this.teams.length + 1}`,
      color,
      score: 0,
      connected: true,
      qualifiedForFinal: false,
      players: ["", ""],
    };
    this.teams.push(team);
    this.log(`${team.name} joined the room.`);
    return team;
  }

  initializeDefaultTeams() {
    if (this.teams.length === 0) for (let i = 1; i <= 4; i++) this.addTeam(`Team ${i}`);
    for (const team of this.teams) team.connected = false;
  }

  removeTeam(teamId: string) {
    if (this.phase !== "lobby" || this.teams.length <= 3) return;
    this.teams = this.teams.filter((team) => team.id !== teamId);
  }

  updateTeam(teamId: string, name: string, players: string[]) {
    if (this.phase !== "lobby") return;
    const team = this.teams.find((candidate) => candidate.id === teamId);
    if (!team) return;
    team.name = name.trim().slice(0, 24) || team.name;
    team.players = players.slice(0, 2).map((player) => player.trim().slice(0, 24));
  }

  joinTeam(teamId: string): Team | null {
    const team = this.teams.find((candidate) => candidate.id === teamId);
    if (!team || team.connected) return null;
    team.connected = true;
    this.log(`${team.name} joined the room.`);
    return team;
  }

  setTargetScore(value: number) {
    if (this.finalState) return;
    const previous = this.targetScore;
    this.targetScore = Math.max(1000, Math.min(20000, Math.round(value / 500) * 500));
    this.log(`Final target changed from ${previous} to ${this.targetScore}.`);
    this.qualifyEligibleTeams();
  }

  setConnected(teamId: string, connected: boolean) {
    const t = this.teams.find((t) => t.id === teamId);
    if (t) t.connected = connected;
  }

  // ---------- Core loop ----------

  /** Host activates the currently-selected map node and pulls a question for it. */
  activateCurrentNode() {
    let node = this.map.nodes.find((n) => n.id === this.map.selectedPath[this.map.selectedPath.length - 1]);

    if (node && node.tier === null) {
      // We're at START with no controlling team yet (nobody has answered
      // anything). The doc doesn't specify who picks the opening path, so
      // as a default the server auto-selects one of the three step-1 nodes
      // to kick the game off.
      const opening = legalNextNodeIds(this.map);
      if (opening.length === 0) return;
      const pick = opening[Math.floor(Math.random() * opening.length)];
      this.map = chooseRoute(this.map, pick);
      this.log("Opening path auto-selected to start the game.");
      node = this.map.nodes.find((n) => n.id === this.map.selectedPath[this.map.selectedPath.length - 1]);
    }

    if (!node || node.tier === null) return;
    if (node.questionId) return; // already activated

    const question = this.pickQuestion(node.tier, node.category);
    if (!question) {
      this.log(`No unused questions left for tier ${node.tier} — pool exhausted.`);
      return;
    }
    question.status = "used";
    if (question.mode === "friend_group") {
      const playerNames = [...new Set(this.teams.flatMap((team) => team.players).filter(Boolean))];
      question.choices = playerNames.length ? playerNames : this.teams.map((team) => team.name);
      this.friendAnswers = {};
    }
    node.questionId = question.id;
    this.activeNodeId = node.id;
    this.activeQuestion = question;
    this.phase = "map";
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    // A depleted category/tier pair falls back to the tier pool. Keep the node
    // label truthful if that happens during a long session.
    node.category = question.category;
    this.log(`Activated ${node.tier} question in ${question.category} (${TIER_POINTS[node.tier]} pts).`);
  }

  private pickQuestion(tier: Tier, category: string | null): Question | undefined {
    const exact = this.questionPool.filter(
      (q) => q.status === "unused" && q.tier === tier && q.category === category,
    );
    const eligible = exact.length > 0 ? exact : this.questionPool.filter((q) => q.status === "unused" && q.tier === tier);
    if (eligible.length === 0) return undefined;
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  startReading() {
    if (this.paused) return;
    if (this.phase !== "map") return;
    this.phase = "reading";
    this.log("Host started reading the question.");
  }

  openBuzzers() {
    if (this.paused) return;
    if (this.phase !== "reading" && this.phase !== "map") return;
    this.phase = "buzzing";
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.log("Buzzers open.");
  }

  registerBuzz(teamId: string): boolean {
    if (this.paused) return false;
    if (!this.teams.some((team) => team.id === teamId && team.connected && !team.qualifiedForFinal)) return false;
    if (this.phase !== "buzzing") return false;
    if (this.lockedOutTeamIds.includes(teamId)) return false;
    if (this.buzzOrder.some((b) => b.teamId === teamId)) return false;
    this.buzzOrder.push({ teamId, serverTimestamp: Date.now() });
    if (this.currentResponderId() === teamId) {
      this.phase = "adjudicating";
      this.log(`${this.teamName(teamId)} buzzed in.`);
    }
    return true;
  }

  /** First team in buzz order who hasn't since been locked out — i.e. who the host is judging right now. */
  currentResponderId(): string | null {
    const entry = this.buzzOrder.find((b) => !this.lockedOutTeamIds.includes(b.teamId));
    return entry?.teamId ?? null;
  }

  private teamName(id: string) {
    return this.teams.find((t) => t.id === id)?.name ?? "Unknown team";
  }

  markCorrect(teamId: string) {
    if (this.paused) return;
    if (this.phase !== "adjudicating") return;
    if (this.currentResponderId() !== teamId) return; // only the team currently up can be adjudicated
    const node = this.map.nodes.find((n) => n.id === this.activeNodeId);
    const team = this.teams.find((t) => t.id === teamId);
    if (!node || !team || node.tier === null) return;

    team.score += TIER_POINTS[node.tier];
    this.log(`${team.name} answered correctly (+${TIER_POINTS[node.tier]}). Score: ${team.score}.`);
    this.map = markNodeCompleted(this.map, node.id);
    this.controllingTeamId = team.id;
    this.activeQuestion = null;
    this.activeNodeId = null;

    this.checkQualification(team);

    // The second qualifier starts the Final immediately. Do not overwrite
    // that transition with route_choice below.
    if (this.finalState !== null) return;

    if (team.qualifiedForFinal) {
      const legal = legalNextNodeIds(this.map);
      if (legal.length) {
        this.map = chooseRoute(this.map, legal[Math.floor(Math.random() * legal.length)]);
        this.controllingTeamId = null;
        this.activateCurrentNode();
      }
      return;
    }

    this.phase = "route_choice";
  }

  markWrong(teamId: string) {
    if (this.paused) return;
    if (this.phase !== "adjudicating") return;
    if (this.currentResponderId() !== teamId) return;
    this.lockedOutTeamIds.push(teamId);
    this.log(`${this.teamName(teamId)} answered incorrectly and is locked out.`);
    // Doc section 5: lockout/rebound rule is still to be finalized.
    // Default behavior: any team not yet locked out (whether they've already
    // buzzed and are waiting, or haven't buzzed yet) may still answer.
    const stillEligible = this.teams.some((t) => !t.qualifiedForFinal && !this.lockedOutTeamIds.includes(t.id));
    if (stillEligible) {
      // If another team already buzzed earlier, they become the new current
      // responder immediately; otherwise buzzers stay open for fresh buzzes.
      this.phase = this.currentResponderId() ? "adjudicating" : "buzzing";
    } else {
      // Nobody left to answer — question is dead, host must skip.
      this.log("No teams remain eligible to answer. Use Skip to move on.");
    }
  }

  skipQuestion() {
    if (this.paused) return;
    if (!this.activeNodeId || !["map", "reading", "buzzing", "adjudicating"].includes(this.phase)) return;
    this.activeQuestion = null;
    if (this.activeNodeId) {
      this.map = markNodeCompleted(this.map, this.activeNodeId);
    }
    this.activeNodeId = null;
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.log("Host skipped the question.");

    // Nobody earned control of a skipped/dead question, so auto-select a
    // route and keep the live game moving instead of entering an impossible
    // route_choice state with no controlling team.
    const legal = legalNextNodeIds(this.map);
    if (legal.length === 0) {
      this.finishRoutePhase();
      return;
    }
    const pick = legal[Math.floor(Math.random() * legal.length)];
    this.map = chooseRoute(this.map, pick);
    this.controllingTeamId = null;
    this.log("Next route auto-selected after the skipped question.");
    this.activateCurrentNode();
  }

  chooseRoute(teamId: string, nodeId: string) {
    if (this.paused) return;
    if (this.phase !== "route_choice") return;
    if (this.controllingTeamId !== teamId) return;
    const legal = legalNextNodeIds(this.map);
    if (!legal.includes(nodeId)) return;
    this.map = chooseRoute(this.map, nodeId);
    this.controllingTeamId = null;
    this.phase = "map";
    this.log(`${this.teamName(teamId)} chose the next route.`);
    this.activateCurrentNode();
  }

  private checkQualification(team: Team) {
    if (team.qualifiedForFinal) return;
    if (team.score < this.targetScore) return;
    const alreadyQualified = this.teams.filter((t) => t.qualifiedForFinal);
    if (alreadyQualified.length >= 2) return;
    team.qualifiedForFinal = true;
    this.log(`${team.name} qualified for the Final!`);
    if (this.teams.filter((t) => t.qualifiedForFinal).length === 2) {
      this.startFinal();
    }
  }

  private qualifyEligibleTeams() {
    const eligible = this.teams.filter((team) => !team.qualifiedForFinal && team.score >= this.targetScore).sort((a, b) => b.score - a.score);
    for (const team of eligible) {
      if (this.teams.filter((candidate) => candidate.qualifiedForFinal).length >= 2) break;
      this.checkQualification(team);
    }
  }

  submitFriendAnswer(teamId: string, answer: string) {
    if (this.paused || this.phase !== "buzzing" || this.activeQuestion?.mode !== "friend_group") return;
    const team = this.teams.find((candidate) => candidate.id === teamId && candidate.connected && !candidate.qualifiedForFinal);
    if (!team || this.friendAnswers[teamId]) return;
    if (!this.activeQuestion.choices?.includes(answer)) return;
    this.friendAnswers[teamId] = answer;
  }

  revealFriendAnswers() {
    if (this.phase !== "buzzing" || this.activeQuestion?.mode !== "friend_group") return;
    const node = this.map.nodes.find((candidate) => candidate.id === this.activeNodeId);
    if (!node?.tier) return;
    const correct = this.teams.filter((team) => this.friendAnswers[team.id] === this.activeQuestion?.answer);
    for (const team of correct) { team.score += TIER_POINTS[node.tier]; this.checkQualification(team); }
    if (this.finalState) return;
    const controller = [...correct].filter((team) => !team.qualifiedForFinal).sort((a, b) => a.score - b.score)[0];
    this.map = markNodeCompleted(this.map, node.id);
    this.activeQuestion = null; this.activeNodeId = null; this.friendAnswers = {};
    if (controller) { this.controllingTeamId = controller.id; this.phase = "route_choice"; }
    else {
      const legal = legalNextNodeIds(this.map);
      if (legal.length) { this.map = chooseRoute(this.map, legal[Math.floor(Math.random() * legal.length)]); this.activateCurrentNode(); }
    }
  }

  private finishRoutePhase() {
    // Map exhausted before two teams qualified — fall back to top two scores.
    const sorted = [...this.teams].sort((a, b) => b.score - a.score);
    for (const t of sorted.slice(0, 2)) t.qualifiedForFinal = true;
    this.startFinal();
  }

  private startFinal() {
    const finalists = this.teams.filter((t) => t.qualifiedForFinal).map((t) => t.id);
    const pool = this.questionPool.filter((q) => q.status === "unused");
    const picks: string[] = [];
    for (let i = 0; i < FINAL_QUESTION_COUNT && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool[idx].id);
      pool[idx].status = "used";
      pool.splice(idx, 1);
    }
    this.finalState = {
      finalists,
      questionIds: picks,
      currentIndex: 0,
      scores: Object.fromEntries(finalists.map((id) => [id, 0])),
    };
    this.activeQuestion = picks.length > 0 ? this.questionPool.find((q) => q.id === picks[0]) ?? null : null;
    this.activeNodeId = null;
    this.controllingTeamId = null;
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.phase = "final";
    this.log(`Final begins between ${finalists.map((id) => this.teamName(id)).join(" and ")}.`);
  }

  advanceFinal() {
    if (this.paused || this.phase !== "final" || !this.finalState) return;
    this.finalState.currentIndex += 1;
    if (this.finalState.currentIndex >= this.finalState.questionIds.length) {
      this.activeQuestion = null;
      this.phase = "ended";
      this.log("Final question set completed.");
      return;
    }
    const questionId = this.finalState.questionIds[this.finalState.currentIndex];
    this.activeQuestion = this.questionPool.find((q) => q.id === questionId) ?? null;
    this.log(`Advanced to Final question ${this.finalState.currentIndex + 1}.`);
  }

  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }

  adjustScore(teamId: string, delta: number) {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return;
    team.score = Math.max(0, team.score + delta);
    this.log(`Host manually adjusted ${team.name}'s score by ${delta > 0 ? "+" : ""}${delta}.`);
  }

  // ---------- Snapshots ----------

  toHostState(): HostGameState {
    return {
      roomCode: this.roomCode,
      gameId: this.gameId,
      phase: this.phase,
      paused: this.paused,
      targetScore: this.targetScore,
      teams: this.teams,
      map: this.map,
      activeNodeId: this.activeNodeId,
      activeQuestion: this.activeQuestion,
      buzzOrder: this.buzzOrder,
      lockedOutTeamIds: this.lockedOutTeamIds,
      currentResponderId: this.currentResponderId(),
      controllingTeamId: this.controllingTeamId,
      finalState: this.finalState,
      eventLog: this.eventLog,
      questionPoolRemaining: this.questionPool.filter((q) => q.status === "unused").length,
      questionPoolTotal: this.questionPool.length,
      friendAnswers: this.friendAnswers,
    };
  }

  toPublicState(): PublicGameState {
    const node = this.map.nodes.find((n) => n.id === this.activeNodeId);
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      paused: this.paused,
      targetScore: this.targetScore,
      teams: this.teams,
      map: this.map,
      activeNodeId: this.activeNodeId,
      activeQuestionPublic:
        node && node.tier
          ? { category: this.activeQuestion?.category ?? "?", tier: node.tier, points: TIER_POINTS[node.tier], mode: this.activeQuestion?.mode ?? "buzzer", choices: this.activeQuestion?.choices }
          : null,
      buzzOrder: this.buzzOrder.map((b) => ({ teamId: b.teamId })),
      lockedOutTeamIds: this.lockedOutTeamIds,
      currentResponderId: this.currentResponderId(),
      controllingTeamId: this.controllingTeamId,
      finalState: this.finalState,
      legalNextNodeIds: this.phase === "route_choice" ? legalNextNodeIds(this.map) : [],
      friendAnswersSubmitted: Object.keys(this.friendAnswers),
    };
  }
}
