import { nanoid } from "nanoid";
import type {
  BuzzEntry,
  GameFeedback,
  EventLogEntry,
  FinalState,
  PlayoffState,
  LobbySettings,
  QuestionRecord,
  GamePhase,
  HostGameState,
  PublicGameState,
  Question,
  Team,
  Tier,
  QuestionClock,
} from "./types.js";
import { questionPoints, isGutta, numericAnswer } from "./types.js";
import { generateRouteMap, legalNextNodeIds, chooseRoute, markNodeCompleted, refreshRouteOptions } from "./map.js";
import { summarizeStats } from "./statistics.js";
import { TEAM_COLORS } from "./palette.js";
import questionsData from "./data/questions.json" with { type: "json" };

const TARGET_SCORE = 10000; // doc section 7: working target score
const FINAL_QUESTION_COUNT = 5;

export class GameEngine {
  roomCode: string;
  gameId: string;
  isTestRoom = false;
  eventMode = false;
  feedback: GameFeedback | null = null;
  startedAt: number | null = null;
  lobby: LobbySettings = {title:"quiz med gutta",joinUrl:"",musicUrl:""};
  private questionHistory: QuestionRecord[] = [];
  private buzzElapsedMs = 0;
  private buzzWindowStartedAt: number | null = null;
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
  playoffState: PlayoffState | null = null;
  qualificationPurpose: "first" | "second" | "elimination" = "second";
  reservedPlayoffQuestionIds: string[] = [];
  reservedDuelQuestionIds: string[] = [];
  eventLog: EventLogEntry[] = [];
  friendAnswers: Record<string, string> = {};
  questionPool: Question[];
  private completedQuestion: Question | null = null;
  reservedFinalQuestionIds: string[] = [];
  finalCandidateIds: string[] = [];
  clock: QuestionClock = {kind:null, remainingMs:15000, deadline:null, questionRemainingMs:15000, warningId:null};
  private undoHistory: {label:string;state:Record<string,unknown>}[] = [];
  imageRevealStage = 0;
  private completedAnswers: NonNullable<PublicGameState["revealedQuestion"]>["results"] = [];
  questionCardDismissed = false;
  revealedQuestion: PublicGameState["revealedQuestion"] = null;

  constructor(roomCode: string, questions: Question[] = questionsData as Question[], finalQuestionIds: string[] = [], playoffQuestionIds: string[] = []) {
    this.roomCode = roomCode;
    this.gameId = nanoid(10);
    this.questionPool = JSON.parse(JSON.stringify(questions)) as Question[];
    const curatedPlayoff=this.questionPool.filter(q=>playoffQuestionIds.includes(q.id)).map(q=>q.id);
    const finalPool=this.questionPool.filter(q=>!curatedPlayoff.includes(q.id));
    const reserveCount = Math.min(FINAL_QUESTION_COUNT, Math.max(0, Math.floor(finalPool.length / 3)));
    const curated = finalPool.filter(q=>finalQuestionIds.includes(q.id)).map(q=>q.id);
    this.reservedFinalQuestionIds = curated.length ? curated : [...finalPool].sort(() => Math.random() - .5).slice(0, reserveCount).map(q => q.id);
    const spare=this.questionPool.filter(q=>!this.reservedFinalQuestionIds.includes(q.id));
    const playoffReserveCount=Math.max(curatedPlayoff.length,spare.length>=6 ? 5 : Math.floor(spare.length/4));
    this.reservedPlayoffQuestionIds=[...curatedPlayoff,...spare.filter(q=>!curatedPlayoff.includes(q.id)).sort(()=>Math.random()-.5).map(q=>q.id)].slice(0,playoffReserveCount);
    this.reservedDuelQuestionIds=spare.filter(q=>!this.reservedPlayoffQuestionIds.includes(q.id)).sort(()=>Math.random()-.5).slice(0,spare.length>=9?3:0).map(q=>q.id);
    this.map = generateRouteMap(this.routePool());
  }

  exportState(): Record<string, unknown> {
    const state=JSON.parse(JSON.stringify(this));
    if(state.clock.deadline!==null)state.clock.remainingMs=Math.max(0,state.clock.deadline-Date.now());
    state.clock.deadline=null;
    state.buzzElapsedMs=this.buzzElapsedMs+(this.buzzWindowStartedAt===null?0:Math.max(0,Date.now()-this.buzzWindowStartedAt));
    state.buzzWindowStartedAt=null;
    return state;
  }

  static restore(value: unknown): GameEngine {
    const data=value as any;
    if (!data || typeof data.roomCode !== "string" || !Array.isArray(data.questionPool) || !Array.isArray(data.teams) || !data.map || !data.gameId) throw new Error("Ugyldig lagret spill.");
    const game=Object.assign(new GameEngine(data.roomCode,data.questionPool),data);
    if(!Array.isArray(data.reservedDuelQuestionIds))game.reservedDuelQuestionIds=[];
    game.clock.warningId ??= null;
    game.clock.questionRemainingMs=Math.min(game.duration(),game.clock.questionRemainingMs);
    if(game.clock.kind === "question")game.clock.remainingMs=Math.min(game.duration(),game.clock.remainingMs);
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
    this.feedback=null;
    this.clampScores();
    for(const team of this.teams){team.connected=presence.get(team.id)??false;team.photoDataUrl=photos.get(team.id);}
    this.clock.deadline=null;
    if(this.clock.kind)this.clock.remainingMs=Math.max(5000,this.clock.remainingMs);
    this.paused=true;
    this.log(`Angret: ${previous.label}. Spillet er satt på pause for kontroll.`);
  }
  replaceQuestion(): boolean {
    if(!this.activeQuestion || !["map","reading","buzzing","adjudicating","dead_question","final","playoff"].includes(this.phase))return false;
    const pool=(this.phase==="final"?this.questionPool:this.phase==="playoff"?this.playoffPool():this.routePool()).filter(q=>q.status==="unused");
    const replacement=pool.find(q=>q.tier===this.activeQuestion!.tier&&q.category===this.activeQuestion!.category)??pool.find(q=>q.tier===this.activeQuestion!.tier)??pool[0];
    if(!replacement)return false;
    this.checkpoint("byttet spørsmål");
    const replaced=this.questionHistory.find(q=>q.questionId===this.activeQuestion!.id);if(replaced)replaced.voided=true;
    replacement.status="used";
    this.activeQuestion=replacement;
    this.resetClock();
    this.buzzOrder=[];this.lockedOutTeamIds=[];this.friendAnswers={};this.completedQuestion=null;this.completedAnswers=[];this.revealedQuestion=null;
    if(this.phase==="final" || this.phase==="playoff") {
      const round=this.phase==="playoff"?this.playoffState!:this.finalState!;
      round.questionIds[round.currentIndex]=replacement.id;
      round.roundPhase="ready";
    } else {
      const node=this.map.nodes.find(n=>n.id===this.activeNodeId)!;
      node.questionId=replacement.id;node.category=replacement.category;node.tier=replacement.tier;
      this.phase="map";
    }
    this.map = refreshRouteOptions(this.map, this.routePool());
    this.log("Verten byttet spørsmål. Det gamle spørsmålet trekkes ikke igjen.");
    return true;
  }

  configureLobby(title:string,joinUrl:string,musicUrl:string):boolean {
    if(this.phase!=="lobby" || !title.trim() || title.length>80)return false;
    const webUrl=(value:string)=>{try{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}};
    if(joinUrl && !webUrl(joinUrl))return false;
    if(musicUrl && !webUrl(musicUrl) && !/^\/media\/[a-zA-Z0-9._-]+$/.test(musicUrl))return false;
    this.lobby={title:title.trim(),joinUrl,musicUrl};return true;
  }

  private freezeBuzzWindow(now=Date.now()) {
    if(this.buzzWindowStartedAt!==null)this.buzzElapsedMs+=Math.max(0,now-this.buzzWindowStartedAt);
    this.buzzWindowStartedAt=null;
  }
  private trackQuestion() {
    const q=this.activeQuestion;if(!q)return null;
    let record=this.questionHistory.find(record=>record.questionId===q.id&&!record.voided);
    if(!record){record={questionId:q.id,category:q.category,round:this.phase==="final"?"final":this.phase==="playoff"?"playoff":"main",eligibleTeamIds:this.teams.filter(t=>this.eligible(t)).map(t=>t.id),resolved:false,skipped:false,voided:false,attempts:[]};this.questionHistory.push(record);}
    return record;
  }
  private judgeAttempt(teamId:string,correct:boolean) {
    const record=this.trackQuestion();if(!record)return;
    if(!record.eligibleTeamIds.includes(teamId))record.eligibleTeamIds.push(teamId);
    const attempt=record.attempts.find(a=>a.teamId===teamId);
    if(attempt)attempt.correct=correct;else record.attempts.push({teamId,correct});
  }
  private completeStats(skipped=false) { const record=this.trackQuestion();if(record){record.resolved=true;record.skipped ||= skipped;} }

  private duration() { return this.activeQuestion?.mode === "closest" ? 30000 : 15000; }
  private resetClock() { this.clock={kind:null,remainingMs:this.duration(),deadline:null,questionRemainingMs:this.duration(), warningId:null}; this.imageRevealStage=0; this.buzzElapsedMs=0;this.buzzWindowStartedAt=null; }
  private freezeClock(now=Date.now()) { if(this.clock.deadline!==null)this.clock.remainingMs=Math.max(0,this.clock.deadline-now);this.clock.deadline=null; }
  private stopClock() { this.freezeClock();this.freezeBuzzWindow();this.clock.kind=null; }
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
      if(["private_choice","friend_group","closest"].includes(this.activeQuestion?.mode??"")) this.revealFriendAnswers();
      else {
        this.checkpoint("spørsmålstiden løp ut");
        this.completeStats();
        this.completedQuestion=this.activeQuestion;
        if(this.phase==="final")this.resolveFinalQuestion();else if(this.phase==="playoff")this.resolvePlayoffQuestion();else this.setQuestionPhase("dead_question");
        this.stopClock();this.log("Tiden er ute. Verten kan vise fasit og gå videre.");
      }
    }
    return true;
  }

  private announce(kind: GameFeedback["kind"], teamIds:string[], label:string, points?:number) {
    this.feedback={id:nanoid(10),kind,teamIds,label,points,createdAt:Date.now()};
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
      this.log(`Ingen ubrukte hovedspørsmål igjen. Avslutter hovedrunden og avgjør finaleplassene.`);
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

  private routePool() { return this.questionPool.filter(q => !this.reservedFinalQuestionIds.includes(q.id) && !this.reservedPlayoffQuestionIds.includes(q.id) && !this.reservedDuelQuestionIds.includes(q.id)); }
  private playoffPool() { return this.questionPool.filter(q=>!this.reservedFinalQuestionIds.includes(q.id) && (this.playoffState?.stage?.startsWith("duel") || !this.reservedDuelQuestionIds.includes(q.id))); }
  private questionPhase(): string { return this.phase === "final" ? this.finalState!.roundPhase : this.phase === "playoff" ? this.playoffState!.roundPhase : this.phase; }
  private setQuestionPhase(phase: "map" | "reading" | "buzzing" | "adjudicating" | "dead_question") {
    if (this.phase === "final" || this.phase === "playoff") (this.phase === "final" ? this.finalState! : this.playoffState!).roundPhase = phase === "map" ? "ready" : phase === "dead_question" ? "resolved" : phase;
    else this.phase = phase;
  }
  private eligible(team: Team) { return team.connected && (this.phase === "final" ? !!this.finalState?.finalists.includes(team.id) : this.phase === "playoff" ? !!this.playoffState?.contenders.includes(team.id) : !team.qualifiedForFinal); }
  private clampScores() {
    for(const team of this.teams)team.score=Math.max(0,team.score);
    if(this.finalState)for(const id of this.finalState.finalists)this.finalState.scores[id]=Math.max(0,this.finalState.scores[id]);
  }
  private award(team: Team, points: number) {
    if(this.phase === "playoff") { if(points>0)this.playoffState!.scores[team.id]++; }
    else if (this.phase === "final") this.finalState!.scores[team.id] = Math.max(0,this.finalState!.scores[team.id] + points);
    else team.score = Math.max(0,team.score + points);
  }

  startReading() {
    if (this.paused) return;
    if (!["map", "ready"].includes(this.questionPhase()) || !this.activeQuestion) return;
    this.startedAt ??= Date.now();
    this.resetClock();
    this.revealedQuestion = null;
    this.questionCardDismissed = false;
    this.completedQuestion = null;
    this.completedAnswers = [];
    this.imageRevealStage = 0;
    this.trackQuestion();
    this.setQuestionPhase("reading");
    this.log("Verten begynte å lese spørsmålet.");
  }

  openBuzzers() {
    if (this.paused) return;
    if (!["reading", "map", "ready"].includes(this.questionPhase()) || !this.activeQuestion) return;
    this.revealedQuestion = null;
    this.questionCardDismissed = false;
    const record=this.trackQuestion();if(record)record.eligibleTeamIds=this.teams.filter(t=>this.eligible(t)).map(t=>t.id);
    this.setQuestionPhase("buzzing");
    this.buzzElapsedMs=0;this.buzzWindowStartedAt=Date.now();
    this.armClock("question",this.clock.questionRemainingMs);
    this.buzzOrder = [];
    this.lockedOutTeamIds = [];
    this.log("Buzzerne er åpne.");
  }

  registerBuzz(teamId: string): boolean {
    if (this.paused || this.tick()) return false;
    if (!this.teams.some((team) => team.id === teamId && this.eligible(team))) return false;
    if (this.questionPhase() !== "buzzing" || ["friend_group", "private_choice", "closest"].includes(this.activeQuestion?.mode ?? "")) return false;
    if (this.lockedOutTeamIds.includes(teamId)) return false;
    if (this.buzzOrder.some((b) => b.teamId === teamId)) return false;
    const record=this.trackQuestion();
    this.freezeBuzzWindow();
    if(record&&!record.eligibleTeamIds.includes(teamId))record.eligibleTeamIds.push(teamId);
    record?.attempts.push({teamId,correct:null,buzzMs:Math.round(this.buzzElapsedMs),rebound:record.attempts.length>0});
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
    this.judgeAttempt(teamId,true);this.completeStats();
    this.stopClock();
    if(this.phase === "playoff") {
      const team=this.teams.find(t=>t.id===teamId)!;
      this.award(team,1);this.announce("correct",[team.id],"Riktig i kvalifiseringen!",1);
      this.log(`${team.name} fikk ett riktig svar i kvalifiseringen.`);
      this.resolvePlayoffQuestion();this.revealQuestion();return;
    }
    if (this.phase === "final") {
      const team = this.teams.find(t => t.id === teamId)!;
      this.award(team, questionPoints(this.activeQuestion!));
      this.announce("correct",[team.id],"Riktig!",questionPoints(this.activeQuestion!));
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
    this.announce("correct",[team.id],"Riktig!",questionPoints(node));
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

    // Qualification starts the playoff (or a two-team Final). Preserve
    // that transition instead of returning to the route map.
    if (this.finalState !== null || this.playoffState !== null || this.phase === "qualification") return;

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
    this.judgeAttempt(teamId,false);
    this.stopClock();
    const team = this.teams.find(team => team.id === teamId)!;
    const points = questionPoints(this.activeQuestion!);
    const before = this.phase === "final" ? this.finalState!.scores[team.id] : this.phase === "playoff" ? this.playoffState!.scores[team.id] : team.score;
    this.award(team, -points);
    this.lockedOutTeamIds.push(teamId);
    const after = this.phase === "final" ? this.finalState!.scores[team.id] : this.phase === "playoff" ? this.playoffState!.scores[team.id] : team.score;
    this.announce("wrong",[team.id],"Feil svar",after-before);
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
      this.buzzWindowStartedAt=Date.now();
      this.armClock("question",this.clock.questionRemainingMs);
    } else {
      this.completeStats();
      // Nobody left to answer — question is dead, host must skip.
      if (this.phase === "final") this.resolveFinalQuestion();
      else if (this.phase === "playoff") this.resolvePlayoffQuestion();
      else this.setQuestionPhase("dead_question");
      this.completedQuestion = this.completedQuestion ?? this.activeQuestion;
      this.log("Ingen lag kan svare. Vis fasit eller hopp over spørsmålet.");
    }
  }

  skipQuestion() {
    if (this.paused) return;
    if (this.phase === "playoff") {
      if(this.activeQuestion){this.checkpoint("hoppet over kvalifiseringsspørsmål");this.completeStats(true);this.resolvePlayoffQuestion();this.revealQuestion();}return;
    }
    if (this.phase === "final") {
      if (this.activeQuestion) { this.checkpoint("hoppet over finalespørsmål"); this.completeStats(true); this.resolveFinalQuestion(); }
      return;
    }
    if (!this.activeNodeId || !["map", "reading", "buzzing", "adjudicating", "dead_question"].includes(this.phase)) return;
    this.checkpoint("hoppet over spørsmål");
    this.completeStats(true);
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
    if(this.playoffState || this.finalState || team.qualifiedForFinal || team.score<this.targetScore)return;
    const existing=this.teams.find(t=>t.qualifiedForFinal);
    if(existing){this.startPlayoff(existing.id);return;}
    team.qualifiedForFinal=true;
    this.log(`${team.name} vant hovedrunden og er første finalist.`);
    this.startPlayoff(team.id);
  }

  private qualifyEligibleTeams() {
    if(this.playoffState || this.finalState)return;
    const eligible=this.teams.filter(t=>!t.qualifiedForFinal && t.score>=this.targetScore).sort((a,b)=>b.score-a.score);
    if(!eligible.length)return;
    const leaders=eligible.filter(t=>t.score===eligible[0].score);
    if(leaders.length>1){this.requestFirstQualifier(leaders.map(t=>t.id));return;}
    this.checkQualification(leaders[0]);
  }

  submitFriendAnswer(teamId: string, answer: string) {
    if (this.paused || this.tick() || this.questionPhase() !== "buzzing" || !["friend_group", "private_choice", "closest"].includes(this.activeQuestion?.mode ?? "")) return;
    const team = this.teams.find((candidate) => candidate.id === teamId && this.eligible(candidate));
    if (!team || this.friendAnswers[teamId]) return;
    if (this.activeQuestion?.mode === "closest") {
      if (numericAnswer(answer) === null) return;
    } else if (!this.activeQuestion?.choices?.includes(answer)) return;
    this.friendAnswers[teamId] = answer;
  }

  revealFriendAnswers() {
    if (this.paused || this.questionPhase() !== "buzzing" || !["friend_group", "private_choice", "closest"].includes(this.activeQuestion?.mode ?? "")) return;
    this.checkpoint("avslørte private svar");
    this.stopClock();
    const q=this.activeQuestion!;
    const entrants=this.teams.filter(t=>(this.phase === "final" ? this.finalState!.finalists.includes(t.id) : this.phase === "playoff" ? this.playoffState!.contenders.includes(t.id) : !t.qualifiedForFinal) && Object.hasOwn(this.friendAnswers,t.id));
    const target=q.mode === "closest" ? numericAnswer(q.answer) : null;
    const distances=new Map(entrants.map(t=>[t.id,target === null ? Infinity : Math.abs(numericAnswer(this.friendAnswers[t.id])!-target)]));
    const best=Math.min(...distances.values());
    const correct=entrants.filter(t=>q.mode === "closest" ? Math.abs(distances.get(t.id)!-best) <= Number.EPSILON*4*Math.max(1,best) : this.friendAnswers[t.id] === q.answer);
    for(const team of entrants)this.judgeAttempt(team.id,correct.includes(team));
    this.completeStats();
    if(correct.length)this.announce("correct",correct.map(t=>t.id),q.mode === "closest" ? "Nærmest!" : "Riktig!",this.phase === "playoff" ? 1 : questionPoints(q));
    this.completedAnswers=entrants.map(t=>({teamId:t.id,answer:this.friendAnswers[t.id],correct:correct.includes(t),...(q.mode === "closest" ? {distance:distances.get(t.id)} : {})}));
    if(this.phase === "playoff") {
      for(const team of correct)this.award(team,1);
      this.resolvePlayoffQuestion();this.revealQuestion();return;
    }
    if (this.phase === "final") {
      for (const team of correct) this.award(team, questionPoints(this.activeQuestion!));
      this.resolveFinalQuestion(); this.revealQuestion();
      if (this.finalState!.suddenDeath && correct.length === 1) this.endFinal();
      return;
    }
    const node = this.map.nodes.find((candidate) => candidate.id === this.activeNodeId);
    if (!node?.tier) return;
    this.completedQuestion = this.activeQuestion;
    this.map = markNodeCompleted(this.map, node.id);
    for (const team of correct) team.score += questionPoints(node);
    this.qualifyEligibleTeams();
    this.revealQuestion();
    if (this.finalState || this.playoffState || this.phase === "qualification") return;
    const controller = [...correct].filter((team) => !team.qualifiedForFinal).sort((a, b) => a.score - b.score)[0];
    this.activeQuestion = null; this.activeNodeId = null; this.friendAnswers = {};
    if (controller) { this.controllingTeamId = controller.id; this.phase = "route_choice"; }
    else {
      const legal = legalNextNodeIds(this.map);
      if (legal.length) { this.map = chooseRoute(this.map, legal[Math.floor(Math.random() * legal.length)], this.routePool()); this.activateCurrentNode(); }
    }
  }

  advanceImage() {
    if (this.paused || !this.activeQuestion?.progressiveImage || !["reading","buzzing"].includes(this.questionPhase()) || this.imageRevealStage>=3) return;
    this.checkpoint("avslørte mer av bildet");
    this.imageRevealStage++;
  }

  revealQuestion() {
    if (!this.completedQuestion) return;
    this.questionCardDismissed = false;
    const q = this.completedQuestion;
    this.revealedQuestion = {prompt:q.prompt, answer:q.answer, media:q.revealMedia ?? q.media, ...(this.completedAnswers?.length ? {results:this.completedAnswers} : {})};
  }

  dismissQuestionCard() {
    if (!this.revealedQuestion) return;
    this.revealedQuestion = null;
    this.questionCardDismissed = true;
  }

  finishRoutePhase(force = false) {
    if(this.finalState || this.playoffState || this.paused || (!force && !["lobby","map","route_choice"].includes(this.phase)))return;
    if(!force)this.checkpoint("avsluttet hovedrunden");
    this.stopClock();
    const qualified=this.teams.filter(t=>t.qualifiedForFinal);
    if(qualified.length>=2){this.startFinal();return;} // older saved games
    if(qualified.length===1){this.startPlayoff(qualified[0].id);return;}
    const highest=Math.max(...this.teams.map(t=>t.score));
    const leaders=this.teams.filter(t=>t.score===highest);
    if(leaders.length!==1){this.requestFirstQualifier(leaders.map(t=>t.id));return;}
    leaders[0].qualifiedForFinal=true;this.startPlayoff(leaders[0].id);
  }

  private requestFirstQualifier(ids:string[]) {
    this.stopClock();this.activeQuestion=null;this.activeNodeId=null;this.buzzOrder=[];this.controllingTeamId=null;
    this.finalCandidateIds=ids;this.qualificationPurpose="first";this.phase="qualification";
    this.log("Lik hovedpoengsum på førsteplass. Verten avgjør et muntlig omspill før kvalifiseringen.");
  }

  selectFirstQualifier(teamId:string) {
    if(this.paused || this.phase!=="qualification" || this.qualificationPurpose!=="first" || !this.finalCandidateIds.includes(teamId))return;
    this.checkpoint("valgte vinner av hovedrunden");
    this.teams.find(t=>t.id===teamId)!.qualifiedForFinal=true;this.startPlayoff(teamId);
  }

  private startPlayoff(firstQualifierId:string) {
    const contenders=this.teams.filter(t=>t.id!==firstQualifierId).map(t=>t.id);
    if(contenders.length===1){this.teams.find(t=>t.id===contenders[0])!.qualifiedForFinal=true;this.startFinal();return;}
    const unused=this.playoffPool().filter(q=>q.status==="unused");
    const reserved=unused.filter(q=>this.reservedPlayoffQuestionIds.includes(q.id)).sort(()=>Math.random()-.5);
    const extras=unused.filter(q=>!this.reservedPlayoffQuestionIds.includes(q.id)).sort(()=>Math.random()-.5);
    const picks=[...reserved,...extras].slice(0,5);
    for(const q of picks)q.status="used";
    const baseline=Math.min(...contenders.map(id=>this.teams.find(t=>t.id===id)!.score));
    const mainScores=Object.fromEntries(contenders.map(id=>[id,this.teams.find(t=>t.id===id)!.score]));
    const headStarts=Object.fromEntries(contenders.map(id=>[id,Math.min(2,Math.floor(Math.max(0,mainScores[id]-baseline)/(this.targetScore/4)))]));
    this.playoffState={stage:"elimination",safeTeamIds:[],eliminatedTeamIds:[],firstQualifierId,contenders,mainScores,headStarts,questionIds:picks.map(q=>q.id),currentIndex:0,scores:Object.fromEntries(contenders.map(id=>[id,0])),roundPhase:picks.length?"ready":"resolved",suddenDeath:false};
    this.phase="playoff";this.qualificationPurpose="second";this.finalCandidateIds=[];
    this.activeQuestion=picks[0]??null;this.activeNodeId=null;this.controllingTeamId=null;this.buzzOrder=[];this.lockedOutTeamIds=[];this.friendAnswers={};this.resetClock();
    this.announce("qualified",[firstQualifierId],"Første finaleplass er sikret!");
    if(contenders.length===2){this.beginDuel(contenders,false);return;}
    this.log(`Kvalifisering om andreplassen: ${picks.length} av fem spørsmål tilgjengelig. Alle starter på null riktige svar, med inntil to bonuspoeng fra hovedrunden.`);
  }

  private resolvePlayoffQuestion() {
    this.stopClock();this.completedQuestion=this.activeQuestion;this.activeQuestion=null;
    this.playoffState!.roundPhase="resolved";this.buzzOrder=[];this.lockedOutTeamIds=[];
  }

  advancePlayoff() {
    const round=this.playoffState;
    if(this.paused || this.phase!=="playoff" || !round || round.roundPhase!=="resolved")return;
    this.checkpoint("gikk videre i kvalifiseringen");
    const next=round.currentIndex+1;
    if(next<round.questionIds.length){round.currentIndex=next;this.activeQuestion=this.questionPool.find(q=>q.id===round.questionIds[next])??null;}
    else {
      const duel=round.stage?.startsWith("duel");
      let tied:string[];
      if(duel){
        const high=Math.max(...round.contenders.map(id=>round.scores[id]));
        tied=round.contenders.filter(id=>round.scores[id]===high);
        if(tied.length===1){this.teams.find(t=>t.id===tied[0])!.qualifiedForFinal=true;this.startFinal();return;}
      } else {
        const safe=round.safeTeamIds??[];
        const total=(id:string)=>round.scores[id]+(round.headStarts?.[id]??0);
        const ranked=[...round.contenders].sort((a,b)=>total(b)-total(a));
        const cutoff=total(ranked[Math.min(2-safe.length,ranked.length)-1]);
        const above=ranked.filter(id=>total(id)>cutoff);
        tied=ranked.filter(id=>total(id)===cutoff);
        round.safeTeamIds=[...safe,...above];
        round.eliminatedTeamIds=[...new Set([...(round.eliminatedTeamIds??[]),...ranked.filter(id=>total(id)<cutoff)])];
        if(tied.length<=2-round.safeTeamIds.length){this.beginDuel([...round.safeTeamIds,...tied]);return;}
      }
      round.contenders=tied;round.stage=duel?"duel_tiebreak":"elimination_tiebreak";round.suddenDeath=true;
      const unused=this.playoffPool().filter(q=>q.status==="unused");
      if(!unused.length){
        this.phase="qualification";this.qualificationPurpose=duel?"second":"elimination";
        this.finalCandidateIds=duel?[round.firstQualifierId,...tied]:[...(round.safeTeamIds??[]),...tied];this.activeQuestion=null;
        this.log("Lik score og ingen nye spørsmål. Verten avgjør et muntlig omspill mellom de likestilte lagene.");return;
      }
      const q=unused[Math.floor(Math.random()*unused.length)];q.status="used";
      round.questionIds.push(q.id);round.currentIndex=next;this.activeQuestion=q;
      this.log(duel?"Uavgjort duell: ett spørsmål av gangen til ett lag leder.":"Omspill om duellplassene. Lag som allerede er videre, sitter over.");
    }
    round.roundPhase="ready";this.revealedQuestion=null;this.completedQuestion=null;this.completedAnswers=[];this.friendAnswers={};this.buzzOrder=[];this.lockedOutTeamIds=[];this.resetClock();
  }

  private beginDuel(ids:string[], playedElimination=true) {
    const round=this.playoffState!;
    if(playedElimination)round.eliminationResult={questionIds:[...round.questionIds],scores:{...round.scores},headStarts:{...round.headStarts}};
    // With two contenders, release the unplayed elimination reservations.
    if(!playedElimination)for(const id of round.questionIds){const q=this.questionPool.find(q=>q.id===id);if(q)q.status="unused";}
    const unused=this.questionPool.filter(q=>q.status==="unused"&&!this.reservedFinalQuestionIds.includes(q.id));
    const picks=[...unused.filter(q=>this.reservedDuelQuestionIds.includes(q.id)),...unused.filter(q=>!this.reservedDuelQuestionIds.includes(q.id)).sort(()=>Math.random()-.5)].slice(0,3);
    for(const q of picks)q.status="used";
    round.eliminatedTeamIds=this.teams.filter(t=>t.id!==round.firstQualifierId&&!ids.includes(t.id)).map(t=>t.id);
    round.stage="duel";round.contenders=ids;round.safeTeamIds=[];round.scores=Object.fromEntries(ids.map(id=>[id,0]));round.headStarts={};
    round.questionIds=picks.map(q=>q.id);round.currentIndex=0;round.suddenDeath=false;round.roundPhase=picks.length?"ready":"resolved";
    this.phase="playoff";this.activeQuestion=picks[0]??null;this.finalCandidateIds=[];this.qualificationPurpose="second";
    this.completedQuestion=null;this.completedAnswers=[];this.revealedQuestion=null;this.friendAnswers={};this.buzzOrder=[];this.lockedOutTeamIds=[];this.resetClock();
    this.log("Duell om andre finaleplass: tre spørsmål, begge lag starter på null. Uavgjort gir omspill.");
  }

  selectDuelists(ids:string[]) {
    if(this.paused||this.phase!=="qualification"||this.qualificationPurpose!=="elimination"||ids.length!==2||new Set(ids).size!==2)return;
    if(ids.some(id=>!this.finalCandidateIds.includes(id))||(this.playoffState?.safeTeamIds??[]).some(id=>!ids.includes(id)))return;
    this.checkpoint("valgte duellag");this.beginDuel(ids);
  }

  selectFinalists(ids: string[]) {
    if (this.paused || this.phase !== "qualification" || this.qualificationPurpose!=="second" || ids.length !== 2 || new Set(ids).size !== 2) return;
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
    const reserve = pool.filter(q=>this.reservedFinalQuestionIds.includes(q.id)).sort(()=>Math.random()-.5);
    const extras = pool.filter(q=>!this.reservedFinalQuestionIds.includes(q.id)).sort(()=>Math.random()-.5);
    const picks = [...reserve,...extras].slice(0,FINAL_QUESTION_COUNT);
    for (const question of picks) question.status = "used";
    this.finalState = {finalists, questionIds:picks.map(q=>q.id), currentIndex:0, scores:Object.fromEntries(finalists.map(id=>[id,0])), roundPhase:picks.length ? "ready" : "resolved", winnerIds:[], suddenDeath:false, resultNote:null};
    this.activeQuestion = picks[0] ?? null;
    this.activeNodeId = null; this.controllingTeamId = null;
    this.buzzOrder = []; this.lockedOutTeamIds = []; this.friendAnswers = {}; this.revealedQuestion = null;
    this.phase = "final";
    this.announce("final",finalists,"Finalen begynner!");
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
    this.announce("winner",final.winnerIds,final.winnerIds.length>1 ? "Delt seier!" : "Vi har en vinner!");
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
    final.roundPhase = "ready"; this.revealedQuestion = null; this.completedQuestion = null; this.completedAnswers = [];
    this.buzzOrder = []; this.lockedOutTeamIds = []; this.friendAnswers = {};
  }

  pause() {
    this.tick();this.freezeClock();this.freezeBuzzWindow();
    this.paused = true;
  }
  resume() {
    if(!this.paused)return;
    this.paused = false;
    if(this.questionPhase()==="buzzing")this.buzzWindowStartedAt=Date.now();
    if(this.clock.kind)this.armClock(this.clock.kind,this.clock.remainingMs);
  }

  adjustScore(teamId: string, delta: number) {
    const team = this.teams.find((t) => t.id === teamId);
    if (this.phase === "ended" || (this.playoffState && !this.finalState) || !team || !Number.isSafeInteger(delta) || Math.abs(delta) > 100000) return;
    this.checkpoint("justerte poeng");
    this.award(team, delta);
    this.log(`Verten justerte poengene til ${team.name} med ${delta > 0 ? "+" : ""}${delta}.`);
  }

  // ---------- Snapshots ----------

  toHostState(): HostGameState {
    return {
      roomCode: this.roomCode,
      isTestRoom: this.isTestRoom,
      eventMode: this.eventMode,
      feedback: this.feedback,
      lobby: this.lobby,
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
      playoffState: this.playoffState,
      qualificationPurpose: this.qualificationPurpose,
      statistics: summarizeStats(this.questionHistory,this.teams),
      eventLog: this.eventLog,
      questionPoolRemaining: this.routePool().filter((q) => q.status === "unused").length,
      questionPoolTotal: this.questionPool.length,
      friendAnswers: this.friendAnswers,
      startedAt: this.startedAt,
      questionsPlayed: this.map.nodes.filter(n=>n.status === "completed").length + (this.playoffState ? (this.playoffState.eliminationResult?.questionIds.length??0) + this.playoffState.currentIndex + (this.playoffState.roundPhase === "resolved" ? 1 : 0) : 0) + (this.finalState ? this.finalState.currentIndex + (this.finalState.roundPhase === "resolved" ? 1 : 0) : 0),
      imageRevealStage: this.imageRevealStage,
      canRevealQuestion: this.completedQuestion !== null,
      canDismissQuestionCard: this.revealedQuestion !== null,
      canUndo: this.undoHistory.length > 0,
      undoLabel: this.undoHistory.at(-1)?.label ?? null,
      canReplaceQuestion: !!this.activeQuestion && (this.phase === "final" ? this.questionPool : this.phase === "playoff" ? this.playoffPool() : this.routePool()).some(q=>q.status==="unused"),
      finalCandidateIds: this.finalCandidateIds,
      legalNextNodeIds: this.phase === "route_choice" ? legalNextNodeIds(this.map) : [],
    };
  }

  toPublicState(): PublicGameState {
    const node = this.map.nodes.find((n) => n.id === this.activeNodeId);
    return {
      roomCode: this.roomCode,
      isTestRoom: this.isTestRoom,
      eventMode: this.eventMode,
      feedback: this.feedback,
      lobby: this.lobby,
      phase: this.phase,
      paused: this.paused,
      questionClock: this.clockSnapshot(),
      targetScore: this.targetScore,
      teams: this.teams,
      map: this.map,
      activeNodeId: this.activeNodeId,
      activeQuestionPublic: this.activeQuestion && (node?.tier || this.phase === "final" || this.phase === "playoff")
        ? { id:this.activeQuestion.id, category:this.activeQuestion.category, tier:this.activeQuestion.tier, points:this.phase === "playoff" ? 1 : questionPoints(this.activeQuestion), prompt:this.activeQuestion.prompt, mode:this.activeQuestion.mode ?? "buzzer", choices:this.activeQuestion.choices, progressiveImage:this.activeQuestion.progressiveImage, media:this.activeQuestion.media }
        : null,
      buzzOrder: this.buzzOrder.map((b) => ({ teamId: b.teamId })),
      lockedOutTeamIds: this.lockedOutTeamIds,
      currentResponderId: this.currentResponderId(),
      controllingTeamId: this.controllingTeamId,
      finalState: this.finalState,
      playoffState: this.playoffState,
      qualificationPurpose: this.qualificationPurpose,
      finalCandidateIds: this.finalCandidateIds,
      legalNextNodeIds: this.phase === "route_choice" ? legalNextNodeIds(this.map) : [],
      friendAnswersSubmitted: Object.keys(this.friendAnswers),
      revealedQuestion: this.revealedQuestion,
      imageRevealStage: this.imageRevealStage,
      statistics: this.phase==="ended"?summarizeStats(this.questionHistory,this.teams):null,
      questionCardDismissed: this.questionCardDismissed,
    };
  }
}
