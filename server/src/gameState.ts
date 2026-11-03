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
  QuestionClock,
} from "./types.js";
import { questionPoints, isGutta } from "./types.js";
import { generateRouteMap, legalNextNodeIds, chooseRoute, markNodeCompleted, refreshRouteOptions } from "./map.js";
import { TEAM_COLORS } from "./palette.js";
import questionsData from "./data/questions.json" with { type: "json" };

const TARGET_SCORE = 10000; // doc section 7: working target score
const FINAL_QUESTION_COUNT = 5;

export class GameEngine {
  roomCode: string;
  gameId: string;
  isTestRoom = false;
  phase: GamePhase = "lobby";
  paused = false;
  targetScore = TARGET_SCORE;
  teams: Team[] = [];
  map: ReturnType<typeof generateRouteMap>;
  activeNodeId: string | null = null;
  activeQuestion: Question | null = null;
  buzzOrder: BuzzEntry[] = [];
  lockedOutTeamIds: string[] = [];
  controllingTeamId: string | null = null;
  finalState: FinalState | null = null;
  eventLog: EventLogEntry[] = [];
  friendAnswers: Record<string, string> = {};
  questionPool: Question[];
  private completedQuestion: Question | null = null;
  reservedFinalQuestionIds: string[] = [];
  finalCandidateIds: string[] = [];
  clock: QuestionClock = {kind:null, remainingMs:15000, deadline:null, questionRemainingMs:15000, warningId:null};
  private undoHistory: {label:string;state:Record<string,unknown>}[] = [];
  questionCardDismissed = false;
  revealedQuestion: PublicGameState["revealedQuestion"] = null;

  constructor(roomCode: string, questions: Question[] = questionsData as Question[]) {
    this.roomCode = roomCode;
    this.gameId = nanoid(10);
    this.questionPool = JSON.parse(JSON.stringify(questions)) as Question[];
    const reserveCount = Math.min(FINAL_QUESTION_COUNT, Math.max(0, Math.floor(this.questionPool.length / 3)));
    this.reservedFinalQuestionIds = [...this.questionPool].sort(() => Math.random() - .5).slice(0, reserveCount).map(q => q.id);
    this.map = generateRouteMap(this.routePool());
  }

  exportState(): Record<string, unknown> {
    const state=JSON.parse(JSON.stringify(this));
    if(state.clock.deadline!==null)state.clock.remainingMs=Math.max(0,state.clock.deadline-Date.now());
    state.clock.deadline=null;
    return state;
  }

  static restore(value: unknown): GameEngine {
    const data=value as any;
    if (!data || typeof data.roomCode !== "string" || !Array.isArray(data.questionPool) || !Array.isArray(data.teams) || !data.map || !data.gameId) throw new Error("Ugyldig lagret spill.");
    const game=Object.assign(new GameEngine(data.roomCode,data.questionPool),data);
    game.clock.warningId ??= null;
    game.clock.questionRemainingMs=Math.min(15000,game.clock.questionRemainingMs);
    if(game.clock.kind === "question")game.clock.remainingMs=Math.min(15000,game.clock.remainingMs);
    game.clampScores();
    for(const team of game.teams) team.connected=false;
    if(!["lobby","ended"].includes(game.phase)) game.paused=true;
    return game;
  }

  private checkpoint(label: string) {
    const state=this.exportState(); delete state.undoHistory;
    for(const team of state.teams as Team[])delete team.photoDataUrl;
    this.undoHistory.push({label,state});
    if(this.undoHistory.length>5)this.undoHistory.shift();
  }
  undo() {
    const previous=this.undoHistory.pop();if(!previous)return;
    const history=this.undoHistory;
    const presence=new Map(this.teams.map(t=>[t.id,t.connected]));
    const photos=new Map(this.teams.map(t=>[t.id,t.photoDataUrl]));
    Object.assign(this,previous.state);
    this.undoHistory=history;
    this.clampScores();
    for(const team of this.teams){team.connected=presence.get(team.id)??false;team.photoDataUrl=photos.get(team.id);}
    this.clock.deadline=null;
    if(this.clock.kind)this.clock.remainingMs=Math.max(5000,this.clock.remainingMs);
    this.paused=true;
    this.log(`Angret: ${previous.label}. Spillet er satt på pause for kontroll.`);
  }
  replaceQuestion(): boolean {
    if(!this.activeQuestion || !["map","reading","buzzing","adjudicating","dead_question","final"].includes(this.phase))return false;
    const pool=(this.phase==="final"?this.questionPool:this.routePool()).filter(q=>q.status==="unused");
    const replacement=pool.find(q=>q.tier===this.activeQuestion!.tier&&q.category===this.activeQuestion!.category)??pool.find(q=>q.tier===this.activeQuestion!.tier)??pool[0];
    if(!replacement)return false;
    this.checkpoint("byttet spørsmål");
    replacement.status="used";
    this.activeQuestion=replacement;
    this.resetClock();
    this.buzzOrder=[];this.lockedOutTeamIds=[];this.friendAnswers={};this.completedQuestion=null;this.revealedQuestion=null;
    if(this.phase==="final") {
      this.finalState!.questionIds[this.finalState!.currentIndex]=replacement.id;
      this.finalState!.roundPhase="ready";
    } else {
      const node=this.map.nodes.find(n=>n.id===this.activeNodeId)!;
      node.questionId=replacement.id;node.category=replacement.category;node.tier=replacement.tier;
      this.phase="map";
    }
    this.map = refreshRouteOptions(this.map, this.routePool());
    this.log("Verten byttet spørsmål. Det gamle spørsmålet trekkes ikke igjen.");
    return true;
  }

  private resetClock() { this.clock={kind:null,remainingMs:15000,deadline:null,questionRemainingMs:15000, warningId:null}; }
  private freezeClock(now=Date.now()) { if(this.clock.deadline!==null)this.clock.remainingMs=Math.max(0,this.clock.deadline-now);this.clock.deadline=null; }
  private stopClock() { this.freezeClock();this.clock.kind=null; }
  private armClock(kind: "question" | "answer", milliseconds:number) { this.clock.kind=kind;this.clock.remainingMs=milliseconds;this.clock.deadline=this.paused?null:Date.now()+milliseconds; }
  private clockSnapshot() { return {...this.clock,remainingMs:this.clock.deadline===null?this.clock.remainingMs:Math.max(0,this.clock.deadline-Date.now())}; }
  tick(now=Date.now()): boolean {
    if(this.paused || this.clock.deadline===null || now<this.clock.deadline)return false;
    const kind=this.clock.kind;this.clock.remainingMs=0;this.clock.deadline=null;
    if(kind==="answer") {
      this.stopClock();
      this.clock.warningId=nanoid(10);
      this.log("Lydsignal: laget har brukt sju sekunder. Verten avgjør svaret uten automatisk trekk.");
    } else if(kind==="question") {
      if(["private_choice","friend_group"].includes(this.activeQuestion?.mode??"")) this.revealFriendAnswers();
      else {
        this.checkpoint("spørsmålstiden løp ut");
        this.completedQuestion=this.activeQuestion;
        if(this.phase==="final")this.resolveFinalQuestion();else this.setQuestionPhase("dead_question");
        this.stopClock();this.log("Tiden er ute. Verten kan vise fasit og gå videre.");
      }
    }
    return true;
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
      name: name.trim().slice(0, 24) || `Lag ${this.teams.length + 1}`,
      color,
      score: 0,
      connected: true,
      qualifiedForFinal: false,
      players: ["", ""],
    };
    this.teams.push(team);
    this.log(`${team.name} ble med i rommet.`);
    return team;
  }

  initializeDefaultTeams() {
    // Teams self-register from one shared phone. Kept as a compatibility
    // hook for room creation so older servers/clients can upgrade cleanly.
  }

  removeTeam(teamId: string) {
    if (this.phase !== "lobby") return;
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
    this.log(`${team.name} ble med i rommet.`);
    return team;
  }

  registerTeam(name: string, players: string[], photoDataUrl?: string): Team | null {
    if (this.phase !== "lobby" || this.teams.length >= 5) return null;
    const cleanPlayers = players.slice(0, 2).map((player) => player.trim().slice(0, 24));
    if (cleanPlayers.length !== 2 || !name.trim() || cleanPlayers.some((player) => !player)) return null;
    const team = this.addTeam(name);
    team.players = cleanPlayers;
    if (photoDataUrl?.startsWith("data:image/") && photoDataUrl.length <= 450_000) team.photoDataUrl = photoDataUrl;
    return team;
  }

  setTargetScore(value: number) {
    if (this.finalState || !Number.isFinite(value) || !["lobby", "map", "route_choice"].includes(this.phase)) return;
    this.checkpoint("endret poengmål");
    const previous = this.targetScore;
    this.targetScore = Math.max(1000, Math.min(20000, Math.round(value / 500) * 500));
    this.log(`Poengmålet ble endret fra ${previous} til ${this.targetScore}.`);
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
      this.map = chooseRoute(this.map, pick, this.routePool());
      this.log("Åpningsruten ble valgt automatisk.");
      node = this.map.nodes.find((n) => n.id === this.map.selectedPath[this.map.selectedPath.length - 1]);
    }

    if (!node || node.tier === null) return;
    if (node.questionId) return; // already activated

    const question = this.pickQuestion(node.tier, node.category);
    if (!question) {
      this.log(`Ingen ubrukte spørsmål igjen. Går videre til finalen.`);
      this.finishRoutePhase(true);
      return;
    }
    question.status = "used";
    this.map = refreshRouteOptions(this.map, this.routePool());
    this.friendAnswers = {};
    if (question.mode === "friend_group") {
      const playerNames = [...new Set(this.teams.flatMap((team) => team.players).filter(Boolean))];
      question.choices = [...new Set([...(question.choices ?? []), ...playerNames, question.answer].filter(Boolean))];
      this.friendAnswers = {};
    }
    node.questionId = question.id;
    this.activeNodeId = node.id;
    this.activeQuestion = question;
    this.resetClock();
    this.phase = "map";
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    // A depleted category/tier pair falls back to the tier pool. Keep the node
    // label truthful if that happens during a long session.
    node.category = question.category;
    node.tier = question.tier;
    this.log(`Aktiverte ${node.tier}-spørsmål i ${question.category} (${questionPoints(node)} poeng).`);
  }

  private pickQuestion(tier: Tier, category: string | null): Question | undefined {
    const gutta = isGutta(category) ? this.routePool().filter(q=>q.status === "unused" && isGutta(q.category)) : [];
    if(gutta.length)return gutta[Math.floor(Math.random()*gutta.length)];
    const exact = this.routePool().filter(
      (q) => q.status === "unused" && q.tier === tier && q.category === category,
    );
    const sameTier = this.routePool().filter((q) => q.status === "unused" && q.tier === tier);
    const eligible = exact.length > 0 ? exact : sameTier.length > 0 ? sameTier : this.routePool().filter((q) => q.status === "unused");
    if (eligible.length === 0) return undefined;
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  private routePool() { return this.questionPool.filter(q => !this.reservedFinalQuestionIds.includes(q.id)); }
  private questionPhase(): string { return this.phase === "final" ? this.finalState!.roundPhase : this.phase; }
  private setQuestionPhase(phase: "map" | "reading" | "buzzing" | "adjudicating" | "dead_question") {
    if (this.phase === "final") this.finalState!.roundPhase = phase === "map" ? "ready" : phase === "dead_question" ? "resolved" : phase;
    else this.phase = phase;
  }
  private eligible(team: Team) { return team.connected && (this.phase === "final" ? !!this.finalState?.finalists.includes(team.id) : !team.qualifiedForFinal); }
  private clampScores() {
    for(const team of this.teams)team.score=Math.max(0,team.score);
    if(this.finalState)for(const id of this.finalState.finalists)this.finalState.scores[id]=Math.max(0,this.finalState.scores[id]);
  }
  private award(team: Team, points: number) {
    if (this.phase === "final") this.finalState!.scores[team.id] = Math.max(0,this.finalState!.scores[team.id] + points);
    else team.score = Math.max(0,team.score + points);
  }

  startReading() {
    if (this.paused) return;
    if (!["map", "ready"].includes(this.questionPhase()) || !this.activeQuestion) return;
    this.resetClock();
    this.revealedQuestion = null;
    this.questionCardDismissed = false;
    this.completedQuestion = null;
    this.setQuestionPhase("reading");
    this.log("Verten begynte å lese spørsmålet.");
  }

  openBuzzers() {
    if (this.paused) return;
    if (!["reading", "map", "ready"].includes(this.questionPhase()) || !this.activeQuestion) return;
    this.revealedQuestion = null;
    this.questionCardDismissed = false;
    this.setQuestionPhase("buzzing");
    this.armClock("question",this.clock.questionRemainingMs);
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.log("Buzzerne er åpne.");
  }

  registerBuzz(teamId: string): boolean {
    if (this.paused || this.tick()) return false;
    if (!this.teams.some((team) => team.id === teamId && this.eligible(team))) return false;
    if (this.questionPhase() !== "buzzing" || ["friend_group", "private_choice"].includes(this.activeQuestion?.mode ?? "")) return false;
    if (this.lockedOutTeamIds.includes(teamId)) return false;
    if (this.buzzOrder.some((b) => b.teamId === teamId)) return false;
    this.buzzOrder.push({ teamId, serverTimestamp: Date.now() });
    if (this.currentResponderId() === teamId) {
      this.freezeClock();this.clock.questionRemainingMs=this.clock.remainingMs;
      this.clock.warningId=null;this.armClock("answer",7000);
      this.setQuestionPhase("adjudicating");
      this.log(`${this.teamName(teamId)} buzzet inn.`);
    }
    return true;
  }

  /** First team in buzz order who hasn't since been locked out — i.e. who the host is judging right now. */
  currentResponderId(): string | null {
    const entry = this.buzzOrder.find((b) => !this.lockedOutTeamIds.includes(b.teamId));
    return entry?.teamId ?? null;
  }

  private teamName(id: string) {
    return this.teams.find((t) => t.id === id)?.name ?? "Ukjent lag";
  }

  markCorrect(teamId: string) {
    if (this.paused) return;
    this.tick();
    if (this.questionPhase() !== "adjudicating") return;
    if (this.currentResponderId() !== teamId) return; // only the team currently up can be adjudicated
    this.checkpoint("riktig svar");
    this.stopClock();
    if (this.phase === "final") {
      const team = this.teams.find(t => t.id === teamId)!;
      this.award(team, questionPoints(this.activeQuestion!));
      this.log(`${team.name} svarte riktig i finalen.`);
      this.resolveFinalQuestion();
      this.revealQuestion();
      if (this.finalState!.suddenDeath) this.endFinal();
      return;
    }
    const node = this.map.nodes.find((n) => n.id === this.activeNodeId);
    const team = this.teams.find((t) => t.id === teamId);
    if (!node || !team || node.tier === null) return;

    team.score += questionPoints(node);
    this.log(`${team.name} svarte riktig (+${questionPoints(node)}). Poeng: ${team.score}.`);
    this.map = markNodeCompleted(this.map, node.id);
    this.controllingTeamId = team.id;
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.completedQuestion = this.activeQuestion;
    this.activeQuestion = null;
    this.activeNodeId = null;

    this.checkQualification(team);
    this.revealQuestion();

    // The second qualifier starts the Final immediately. Do not overwrite
    // that transition with route_choice below.
    if (this.finalState !== null) return;

    if (team.qualifiedForFinal) {
      const legal = legalNextNodeIds(this.map);
      if (legal.length) {
        this.map = chooseRoute(this.map, legal[Math.floor(Math.random() * legal.length)], this.routePool());
        this.controllingTeamId = null;
        this.activateCurrentNode();
      }
      return;
    }

    this.phase = "route_choice";
  }

  markWrong(teamId: string) {
    if (this.paused) return;
    this.tick();
    if (this.questionPhase() !== "adjudicating") return;
    if (this.currentResponderId() !== teamId) return;
    this.checkpoint("feil svar");
    this.stopClock();
    const team = this.teams.find(team => team.id === teamId)!;
    const points = questionPoints(this.activeQuestion!);
    const before = this.phase === "final" ? this.finalState!.scores[team.id] : team.score;
    this.award(team, -points);
    this.lockedOutTeamIds.push(teamId);
    const after = this.phase === "final" ? this.finalState!.scores[team.id] : team.score;
    this.log(`${team.name} svarte feil og er utelåst. ${before > after ? `−${before-after} poeng.` : "Ingen poeng å trekke."} Poeng: ${after}.`);
    // Doc section 5: lockout/rebound rule is still to be finalized.
    // Default behavior: any team not yet locked out (whether they've already
    // buzzed and are waiting, or haven't buzzed yet) may still answer.
    const stillEligible = this.teams.some((t) => this.eligible(t) && !this.lockedOutTeamIds.includes(t.id));
    if (stillEligible) {
      // If another team already buzzed earlier, they become the new current
      // responder immediately; otherwise buzzers stay open for fresh buzzes.
      this.setQuestionPhase(this.currentResponderId() ? "adjudicating" : "buzzing");

      this.clock.questionRemainingMs=Math.max(5000,this.clock.questionRemainingMs);
      this.armClock("question",this.clock.questionRemainingMs);
    } else {
      // Nobody left to answer — question is dead, host must skip.
      if (this.phase === "final") this.resolveFinalQuestion();
      else this.setQuestionPhase("dead_question");
      this.completedQuestion = this.completedQuestion ?? this.activeQuestion;
      this.log("Ingen lag kan svare. Vis fasit eller hopp over spørsmålet.");
    }
  }

  skipQuestion() {
    if (this.paused) return;
    if (this.phase === "final") {
      if (this.activeQuestion) { this.checkpoint("hoppet over finalespørsmål"); this.resolveFinalQuestion(); }
      return;
    }
    if (!this.activeNodeId || !["map", "reading", "buzzing", "adjudicating", "dead_question"].includes(this.phase)) return;
    this.checkpoint("hoppet over spørsmål");
    this.stopClock();
    this.completedQuestion = this.activeQuestion;
    this.activeQuestion = null;
    if (this.activeNodeId) {
      this.map = markNodeCompleted(this.map, this.activeNodeId);
    }
    this.activeNodeId = null;
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.log("Verten hoppet over spørsmålet.");

    // Nobody earned control of a skipped/dead question, so auto-select a
    // route and keep the live game moving instead of entering an impossible
    // route_choice state with no controlling team.
    const legal = legalNextNodeIds(this.map);
    if (legal.length === 0) {
      this.finishRoutePhase(true);
      return;
    }
    const pick = legal[Math.floor(Math.random() * legal.length)];
    this.map = chooseRoute(this.map, pick, this.routePool());
    this.controllingTeamId = null;
    this.log("Neste rute ble valgt automatisk.");
    this.activateCurrentNode();
  }

  chooseRoute(teamId: string, nodeId: string) {
    if (this.paused) return;
    if (this.phase !== "route_choice") return;
    if (this.controllingTeamId !== teamId) return;
    const legal = legalNextNodeIds(this.map);
    if (!legal.includes(nodeId)) return;
    this.checkpoint("valgte rute");
    this.map = chooseRoute(this.map, nodeId, this.routePool());
    this.controllingTeamId = null;
    this.phase = "map";
    this.log(`${this.teamName(teamId)} valgte neste rute.`);
    this.activateCurrentNode();
  }

  chooseRouteByHost(nodeId: string) {
    if (this.paused || this.phase !== "route_choice" || !legalNextNodeIds(this.map).includes(nodeId)) return;
    this.checkpoint("vertens rutevalg");
    this.map = chooseRoute(this.map, nodeId, this.routePool());
    this.controllingTeamId = null;
    this.phase = "map";
    this.log("Verten valgte neste rute manuelt.");
    this.activateCurrentNode();
  }

  private checkQualification(team: Team) {
    if (team.qualifiedForFinal) return;
    if (team.score < this.targetScore) return;
    const alreadyQualified = this.teams.filter((t) => t.qualifiedForFinal);
    if (alreadyQualified.length >= 2) return;
    team.qualifiedForFinal = true;
    this.log(`${team.name} kvalifiserte seg til finalen!`);
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
    if (this.paused || this.tick() || this.questionPhase() !== "buzzing" || !["friend_group", "private_choice"].includes(this.activeQuestion?.mode ?? "")) return;
    const team = this.teams.find((candidate) => candidate.id === teamId && this.eligible(candidate));
    if (!team || this.friendAnswers[teamId]) return;
    if (!this.activeQuestion?.choices?.includes(answer)) return;
    this.friendAnswers[teamId] = answer;
  }

  revealFriendAnswers() {
    if (this.paused || this.questionPhase() !== "buzzing" || !["friend_group", "private_choice"].includes(this.activeQuestion?.mode ?? "")) return;
    this.checkpoint("avslørte private svar");
    this.stopClock();
    if (this.phase === "final") {
      const correct = this.teams.filter(t => this.finalState!.finalists.includes(t.id) && this.friendAnswers[t.id] === this.activeQuestion!.answer);
      for (const team of correct) this.award(team, questionPoints(this.activeQuestion!));
      this.resolveFinalQuestion(); this.revealQuestion();
      if (this.finalState!.suddenDeath && correct.length === 1) this.endFinal();
      return;
    }
    const node = this.map.nodes.find((candidate) => candidate.id === this.activeNodeId);
    if (!node?.tier) return;
    this.completedQuestion = this.activeQuestion;
    this.revealQuestion();
    const correct = this.teams.filter((team) => this.friendAnswers[team.id] === this.activeQuestion?.answer);
    for (const team of correct) { team.score += questionPoints(node); this.checkQualification(team); }
    if (this.finalState) return;
    const controller = [...correct].filter((team) => !team.qualifiedForFinal).sort((a, b) => a.score - b.score)[0];
    this.map = markNodeCompleted(this.map, node.id);
    this.activeQuestion = null; this.activeNodeId = null; this.friendAnswers = {};
    if (controller) { this.controllingTeamId = controller.id; this.phase = "route_choice"; }
    else {
      const legal = legalNextNodeIds(this.map);
      if (legal.length) { this.map = chooseRoute(this.map, legal[Math.floor(Math.random() * legal.length)], this.routePool()); this.activateCurrentNode(); }
    }
  }

  revealQuestion() {
    if (!this.completedQuestion) return;
    this.questionCardDismissed = false;
    const q = this.completedQuestion;
    this.revealedQuestion = {prompt:q.prompt, answer:q.answer, media:q.revealMedia ?? q.media};
  }

  dismissQuestionCard() {
    if (!this.revealedQuestion) return;
    this.revealedQuestion = null;
    this.questionCardDismissed = true;
  }

  finishRoutePhase(force = false) {
    if (this.finalState || this.paused || (!force && !["lobby", "map", "route_choice", "qualification"].includes(this.phase))) return;
    if(!force)this.checkpoint("avsluttet hovedrunden");
    const required = this.teams.filter(t => t.qualifiedForFinal);
    const remaining = this.teams.filter(t => !t.qualifiedForFinal).sort((a,b) => b.score - a.score);
    const slots = Math.max(0, 2 - required.length);
    const cutoff = remaining[Math.min(slots, remaining.length) - 1]?.score;
    const candidates = remaining.filter(t => cutoff !== undefined && t.score >= cutoff);
    if (candidates.length > slots) {
      for(const team of remaining.filter(t=>t.score>cutoff!))team.qualifiedForFinal=true;
      this.finalCandidateIds = [...required, ...candidates].map(t=>t.id);
      this.activeQuestion = null; this.activeNodeId = null; this.buzzOrder = [];
      this.phase = "qualification";
      this.log("Lik poengsum ved finalegrensen. Verten må avgjøre hvem som går videre.");
      return;
    }
    for (const team of remaining.slice(0,slots)) team.qualifiedForFinal = true;
    this.startFinal();
  }

  selectFinalists(ids: string[]) {
    if (this.paused || this.phase !== "qualification" || ids.length !== 2 || new Set(ids).size !== 2) return;
    if (ids.some(id => !this.finalCandidateIds.includes(id))) return;
    if (this.teams.some(t => t.qualifiedForFinal && !ids.includes(t.id))) return;
    this.checkpoint("valgte finalister");
    for (const team of this.teams) team.qualifiedForFinal = ids.includes(team.id);
    this.startFinal();
  }

  private startFinal() {
    if (this.finalState) return;
    const finalists = this.teams.filter(t => t.qualifiedForFinal).map(t=>t.id).slice(0,2);
    const pool = this.questionPool.filter(q=>q.status === "unused");
    const reserve = pool.filter(q=>this.reservedFinalQuestionIds.includes(q.id));
    const extras = pool.filter(q=>!this.reservedFinalQuestionIds.includes(q.id)).sort(()=>Math.random()-.5);
    const picks = [...reserve,...extras].slice(0,FINAL_QUESTION_COUNT);
    for (const question of picks) question.status = "used";
    this.finalState = {finalists, questionIds:picks.map(q=>q.id), currentIndex:0, scores:Object.fromEntries(finalists.map(id=>[id,0])), roundPhase:picks.length ? "ready" : "resolved", winnerIds:[], suddenDeath:false, resultNote:null};
    this.activeQuestion = picks[0] ?? null;
    this.activeNodeId = null; this.controllingTeamId = null;
    this.buzzOrder = []; this.lockedOutTeamIds = []; this.friendAnswers = {}; this.revealedQuestion = null;
    this.phase = "final";
    this.resetClock();
    this.log(`Finalen begynner: ${finalists.map(id=>this.teamName(id)).join(" mot ")}. Finale-poengene starter på null.`);
  }

  private resolveFinalQuestion() {
    this.stopClock();
    this.completedQuestion = this.activeQuestion;
    this.activeQuestion = null;
    this.finalState!.roundPhase = "resolved";
    this.buzzOrder = []; this.lockedOutTeamIds = [];
  }

  private endFinal(note: string | null = null) {
    this.stopClock();
    const final = this.finalState!;
    const high = Math.max(...final.finalists.map(id=>final.scores[id]));
    final.winnerIds = final.finalists.filter(id=>final.scores[id] === high);
    final.resultNote = note;
    this.activeQuestion = null; this.activeNodeId = null; this.buzzOrder = []; this.lockedOutTeamIds = [];
    final.roundPhase = "resolved";
    this.phase = "ended";
    this.revealedQuestion = null;
    this.questionCardDismissed = false;
    this.log(`${final.winnerIds.length > 1 ? "Delt seier" : "Vinner"}: ${final.winnerIds.map(id=>this.teamName(id)).join(" og ")}.`);
  }

  advanceFinal() {
    const final = this.finalState;
    if (this.paused || this.phase !== "final" || !final || final.roundPhase !== "resolved") return;
    this.checkpoint("gikk videre i finalen");
    const next = final.currentIndex + 1;
    if (next < final.questionIds.length) {
      final.currentIndex = next;
      this.activeQuestion = this.questionPool.find(q=>q.id===final.questionIds[next]) ?? null;
    } else {
      const scores = final.finalists.map(id=>final.scores[id]);
      if (new Set(scores).size > 1 || final.finalists.length < 2) { this.endFinal(); return; }
      const unused = this.questionPool.filter(q=>q.status==="unused");
      if (!unused.length) { this.endFinal("Ingen nye spørsmål igjen til omspill. Finalen ender med delt seier."); return; }
      const question = unused[Math.floor(Math.random()*unused.length)]; question.status = "used";
      final.questionIds.push(question.id); final.currentIndex = next; final.suddenDeath = true;
      this.activeQuestion = question;
      this.log("Uavgjort finale. Nytt omspillsspørsmål.");
    }
    this.resetClock();
    final.roundPhase = "ready"; this.revealedQuestion = null; this.completedQuestion = null;
    this.buzzOrder = []; this.lockedOutTeamIds = []; this.friendAnswers = {};
  }

  pause() {
    this.tick();this.freezeClock();
    this.paused = true;
  }
  resume() {
    if(!this.paused)return;
    this.paused = false;
    if(this.clock.kind)this.armClock(this.clock.kind,this.clock.remainingMs);
  }

  adjustScore(teamId: string, delta: number) {
    const team = this.teams.find((t) => t.id === teamId);
    if (this.phase === "ended" || !team || !Number.isSafeInteger(delta) || Math.abs(delta) > 100000) return;
    this.checkpoint("justerte poeng");
    this.award(team, delta);
    this.log(`Verten justerte poengene til ${team.name} med ${delta > 0 ? "+" : ""}${delta}.`);
  }

  // ---------- Snapshots ----------

  toHostState(): HostGameState {
    return {
      roomCode: this.roomCode,
      isTestRoom: this.isTestRoom,
      gameId: this.gameId,
      phase: this.phase,
      paused: this.paused,
      questionClock: this.clockSnapshot(),
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
      questionPoolRemaining: this.routePool().filter((q) => q.status === "unused").length,
      questionPoolTotal: this.questionPool.length,
      friendAnswers: this.friendAnswers,
      canRevealQuestion: this.completedQuestion !== null,
      canDismissQuestionCard: this.revealedQuestion !== null,
      canUndo: this.undoHistory.length > 0,
      undoLabel: this.undoHistory.at(-1)?.label ?? null,
      canReplaceQuestion: !!this.activeQuestion && (this.phase === "final" ? this.questionPool : this.routePool()).some(q=>q.status==="unused"),
      finalCandidateIds: this.finalCandidateIds,
      legalNextNodeIds: this.phase === "route_choice" ? legalNextNodeIds(this.map) : [],
    };
  }

  toPublicState(): PublicGameState {
    const node = this.map.nodes.find((n) => n.id === this.activeNodeId);
    return {
      roomCode: this.roomCode,
      isTestRoom: this.isTestRoom,
      phase: this.phase,
      paused: this.paused,
      questionClock: this.clockSnapshot(),
      targetScore: this.targetScore,
      teams: this.teams,
      map: this.map,
      activeNodeId: this.activeNodeId,
      activeQuestionPublic: this.activeQuestion && (node?.tier || this.phase === "final")
        ? { category:this.activeQuestion.category, tier:this.activeQuestion.tier, points:questionPoints(this.activeQuestion), prompt:this.activeQuestion.prompt, mode:this.activeQuestion.mode ?? "buzzer", choices:this.activeQuestion.choices, media:this.activeQuestion.media }
        : null,
      buzzOrder: this.buzzOrder.map((b) => ({ teamId: b.teamId })),
      lockedOutTeamIds: this.lockedOutTeamIds,
      currentResponderId: this.currentResponderId(),
      controllingTeamId: this.controllingTeamId,
      finalState: this.finalState,
      finalCandidateIds: this.finalCandidateIds,
      legalNextNodeIds: this.phase === "route_choice" ? legalNextNodeIds(this.map) : [],
      friendAnswersSubmitted: Object.keys(this.friendAnswers),
      revealedQuestion: this.revealedQuestion,
      questionCardDismissed: this.questionCardDismissed,
    };
  }
}
