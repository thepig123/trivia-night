import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine as BaseGameEngine } from "./gameState.js";
import questions from "./data/questions.json" with { type: "json" };
import type { Question } from "./types.js";
// Ordinary-round fixtures must not randomly draw a private-answer example.
class GameEngine extends BaseGameEngine {
  constructor(code: string) { super(code, questions.filter(q => q.mode !== "friend_group") as Question[]); }
}
import { TIER_POINTS } from "./types.js";

function activeGame() {
  const game = new GameEngine("TEST1");
  const team = game.addTeam("Alpha");
  game.activateCurrentNode();
  assert.equal(game.phase, "map");
  assert.ok(game.activeNodeId);
  return { game, team };
}

test("pause blocks phase changes and buzzes until resumed", () => {
  const { game, team } = activeGame();
  game.pause();
  game.startReading();
  assert.equal(game.phase, "map");
  assert.equal(game.registerBuzz(team.id), false);

  game.resume();
  game.startReading();
  game.openBuzzers();
  assert.equal(game.registerBuzz(team.id), true);
  assert.equal(game.phase, "adjudicating");
});

test("teams self-register with two players and rooms cap at five teams", () => {
  const game = new GameEngine("LOBBY");
  const photo = "data:image/jpeg;base64,c2lsbHk=";
  const team = game.registerTeam("Night Owls", ["Alice", "Bob"], photo);
  assert.equal(team?.name, "Night Owls");
  assert.deepEqual(team?.players, ["Alice", "Bob"]);
  assert.equal(team?.photoDataUrl, photo);
  for (let index = 2; index <= 5; index++) assert.ok(game.registerTeam(`Team ${index}`, [`P${index}A`, `P${index}B`]));
  assert.equal(game.registerTeam("Too many", ["Nine", "Ten"]), null);
});

test("public state exposes the prompt but never the answer", () => {
  const game = new GameEngine("PROMPT");
  game.activateCurrentNode();
  const publicQuestion = game.toPublicState().activeQuestionPublic;
  assert.equal(publicQuestion?.prompt, game.activeQuestion?.prompt);
  assert.equal("answer" in (publicQuestion as object), false);
  game.startReading(); game.openBuzzers();
  assert.equal(game.toPublicState().activeQuestionPublic?.prompt, game.activeQuestion?.prompt);
});

test("route is fully previewable with category and tier metadata", () => {
  const game = new GameEngine("MAP01");
  assert.equal(game.map.nodes.length, 2 + (game.map.steps - 1) * 3);
  for (const node of game.map.nodes.filter((candidate) => candidate.id !== "START")) {
    assert.ok(node.category);
    assert.ok(node.tier);
  }

  game.activateCurrentNode();
  const activeNode = game.map.nodes.find((node) => node.id === game.activeNodeId);
  assert.equal(game.activeQuestion?.category, activeNode?.category);
});

test("map extends indefinitely and each row has a shuffled tier spread", () => {
  const game = new GameEngine("MAP02");
  for (let round = 0; round < 12; round++) {
    const legal = game.map.nodes.filter((node) => node.status === "available");
    const row = game.map.nodes.filter((node) => node.step === legal[0].step);
    if (row[0].step > 1) assert.equal(new Set(row.map((node) => node.tier)).size, 3);
    game.map = chooseTestRoute(game, legal[0].id);
  }
  assert.ok(game.map.steps >= 17);
});

test("the opening encounter is one random starting node, not a route choice", () => {
  const game = new GameEngine("OPENING");
  const opening = game.map.nodes.filter((node) => node.step === 1);
  assert.equal(opening.length, 1);
  assert.equal(opening[0].slot, 1);
  assert.deepEqual(game.map.nodes.find((node) => node.id === "START")?.nextNodeIds, [opening[0].id]);
  const firstChoices = game.map.nodes.filter((node) => node.step === 2);
  assert.equal(firstChoices.length, 3);
  assert.deepEqual(new Set(opening[0].nextNodeIds), new Set(firstChoices.map((node) => node.id)));
});

test("a route never forces more than three single-choice encounters", () => {
  const game = new GameEngine("BRANCH");
  const team = game.addTeam("Pathfinders");
  let forcedRun = 0;
  for (let round = 0; round < 20; round++) {
    const legal = game.map.nodes.filter((node) => node.status === "available");
    forcedRun = legal.length === 1 ? forcedRun + 1 : 0;
    assert.ok(forcedRun <= 3);
    game.phase = "route_choice"; game.controllingTeamId = team.id;
    game.chooseRoute(team.id, legal[0].id);
  }
});

function chooseTestRoute(game: GameEngine, nodeId: string) {
  // Exercise public route selection with a temporary controller.
  const team = game.teams[0] ?? game.addTeam("Route team");
  game.phase = "route_choice";
  game.controllingTeamId = team.id;
  game.chooseRoute(team.id, nodeId);
  return game.map;
}

test("lowering the target immediately qualifies the highest scoring teams", () => {
  const game = new GameEngine("TARGET");
  const a = game.addTeam("A"); const b = game.addTeam("B"); const c = game.addTeam("C");
  a.score = 8000; b.score = 7500; c.score = 7000;
  game.setTargetScore(7500);
  assert.equal(a.qualifiedForFinal, true);
  assert.equal(b.qualifiedForFinal, true);
  assert.equal(c.qualifiedForFinal, false);
  assert.equal(game.phase, "final");
});

test("friend-group rounds score every correct team and give trailing winner route control", () => {
  const game = new GameEngine("FRIEND");
  const a = game.addTeam("A"); const b = game.addTeam("B"); const c = game.addTeam("C");
  a.score = 500; b.score = 100; c.score = 0;
  game.activateCurrentNode();
  game.activeQuestion!.mode = "friend_group";
  game.activeQuestion!.answer = "Martin";
  game.activeQuestion!.choices = ["Martin", "Mathias"];
  game.startReading(); game.openBuzzers();
  game.submitFriendAnswer(a.id, "Martin"); game.submitFriendAnswer(b.id, "Martin"); game.submitFriendAnswer(c.id, "Mathias");
  game.revealFriendAnswers();
  assert.ok(a.score > 500); assert.ok(b.score > 100); assert.equal(c.score, 0);
  assert.equal(game.controllingTeamId, b.id);
  assert.equal(game.phase, "route_choice");
});

test("skipping auto-selects a route and activates the next question", () => {
  const { game } = activeGame();
  const previousStep = game.map.currentStep;
  game.skipQuestion();

  assert.equal(game.map.currentStep, previousStep + 1);
  assert.equal(game.phase, "map");
  assert.ok(game.activeNodeId);
  assert.equal(game.controllingTeamId, null);
});

test("second qualifier remains in the Final instead of returning to route choice", () => {
  const game = new GameEngine("TEST2");
  const first = game.addTeam("First");
  const second = game.addTeam("Second");
  first.qualifiedForFinal = true;

  game.activateCurrentNode();
  const node = game.map.nodes.find((candidate) => candidate.id === game.activeNodeId);
  assert.ok(node?.tier);
  second.score = game.targetScore - TIER_POINTS[node.tier];

  game.startReading();
  game.openBuzzers();
  game.registerBuzz(second.id);
  game.markCorrect(second.id);

  assert.equal(second.qualifiedForFinal, true);
  assert.equal(game.phase, "final");
  assert.deepEqual(game.finalState?.finalists, [first.id, second.id]);
  assert.ok(game.activeQuestion);
});



test("exhausted tier falls back to available questions with truthful points", () => {
  const game = new GameEngine("EMPTYTIER");
  game.addTeam("A");
  const opening = game.map.nodes.find(node => node.step === 1)!;
  for (const q of game.questionPool) if (q.tier === opening.tier) q.status = "used";
  game.activateCurrentNode();
  assert.ok(game.activeQuestion);
  const node = game.map.nodes.find(node => node.id === game.activeNodeId)!;
  assert.equal(node.tier, game.activeQuestion.tier);
  assert.equal(node.category, game.activeQuestion.category);
  game.startReading(); game.openBuzzers();
  assert.equal(game.registerBuzz(game.teams[0].id), true);
});

test("empty question pool safely enters Final instead of stalling", () => {
  const game = new GameEngine("EMPTY");
  game.addTeam("A"); game.addTeam("B");
  for (const q of game.questionPool) q.status = "used";
  game.activateCurrentNode();
  assert.equal(game.phase, "final");
  assert.equal(game.activeQuestion, null);
  game.advanceFinal();
  assert.equal(game.phase, "ended");
});

test("friend answer includes the host even when the host is not playing", () => {
  const game = new GameEngine("HOST");
  const team = game.registerTeam("Boys", ["Mathias", "Lasse"])!;
  const opening = game.map.nodes.find(node => node.step === 1)!;
  game.questionPool = [{ id: "friend", category: "Gutta", tier: opening.tier!, prompt: "Hvem er vert?", answer: "Martin", acceptedAlternatives: [], choices: ["Rune"], status: "unused", mode: "friend_group" }];
  game.activateCurrentNode();
  assert.deepEqual(game.activeQuestion!.choices, ["Rune", "Mathias", "Lasse", "Martin"]);
  game.startReading(); game.openBuzzers();
  game.submitFriendAnswer(team.id, "Martin");
  game.revealFriendAnswers();
  assert.equal(team.score, TIER_POINTS[opening.tier!]);
});

test("host can rescue a disconnected route controller but cannot select illegal routes", () => {
  const {game,team}=activeGame();game.startReading();game.openBuzzers();game.registerBuzz(team.id);game.markCorrect(team.id);
  game.setConnected(team.id,false);
  game.chooseRouteByHost("illegal");assert.equal(game.phase,"route_choice");
  const node=game.toHostState().legalNextNodeIds[0];game.pause();game.chooseRouteByHost(node);assert.equal(game.phase,"route_choice");
  game.resume();game.chooseRouteByHost(node);assert.equal(game.phase,"map");assert.equal(game.controllingTeamId,null);assert.ok(game.activeQuestion);
});

test("wrong answers deduct the full value once and allow negative scores", () => {
  const {game,team}=activeGame();const other=game.addTeam("B");const points=TIER_POINTS[game.activeQuestion!.tier];
  game.startReading();game.openBuzzers();game.registerBuzz(team.id);game.markWrong(team.id);
  assert.equal(team.score,-points);assert.equal(game.phase,"buzzing");
  game.markWrong(team.id);assert.equal(team.score,-points);assert.equal(game.registerBuzz(team.id),false);
  game.registerBuzz(other.id);game.markWrong(other.id);assert.equal(game.phase,"dead_question");
  game.openBuzzers();assert.equal(game.phase,"dead_question");
  game.skipQuestion();assert.equal(game.phase,"map");
  game.adjustScore(team.id,-100);assert.equal(team.score,-points-100);
  game.adjustScore(team.id,NaN);assert.equal(team.score,-points-100);
});

test("target changes are rejected during an active question", () => {
  const {game}=activeGame();game.startReading();const before=game.targetScore;
  game.setTargetScore(2000);assert.equal(game.targetScore,before);
  game.pause();game.setTargetScore(2000);assert.equal(game.targetScore,before);
});

function finalGame(count=12) {
  const pool: Question[]=Array.from({length:count},(_,i)=>({id:`F${i}`,category:"Test",tier:"T5",prompt:`Spørsmål ${i}`,answer:"Ja",acceptedAlternatives:[],status:"unused",mode:"buzzer"}));
  const game=new BaseGameEngine("FINAL",pool);const a=game.addTeam("A"),b=game.addTeam("B"),c=game.addTeam("C");
  a.score=400;b.score=200;c.score=-200;
  game.finishRoutePhase();assert.equal(game.phase,"final");return {game,a,b,c};
}

test("five-question final awards separate scores, excludes spectators and declares a winner",()=>{
  const {game,a,b,c}=finalGame();const count=game.finalState!.questionIds.length;
  assert.equal(count,5);assert.equal(game.toPublicState().activeQuestionPublic?.prompt,game.activeQuestion?.prompt);
  game.advanceFinal();assert.equal(game.finalState!.currentIndex,0);
  for(let i=0;i<count;i++) {
    game.startReading();game.openBuzzers();assert.equal(game.registerBuzz(c.id),false);
    assert.equal(game.registerBuzz(a.id),true);
    if(i===1){game.markWrong(a.id);assert.equal(game.finalState!.roundPhase,"buzzing");game.registerBuzz(b.id);game.markCorrect(b.id);}
    else game.markCorrect(a.id);
    assert.equal(game.finalState!.roundPhase,"resolved");game.advanceFinal();
  }
  assert.equal(game.phase,"ended");assert.deepEqual(game.finalState!.winnerIds,[a.id]);
  assert.equal(game.finalState!.scores[a.id],600);assert.equal(game.finalState!.scores[b.id],200);
  assert.equal(a.score,400);assert.equal(b.score,200);
});

test("tied final draws sudden-death questions and a correct answer settles it",()=>{
  const {game,a}=finalGame();const count=game.finalState!.questionIds.length;
  for(let i=0;i<count;i++){game.skipQuestion();game.advanceFinal();}
  assert.equal(game.phase,"final");assert.equal(game.finalState!.suddenDeath,true);
  assert.equal(game.finalState!.questionIds.length,count+1);
  game.startReading();game.openBuzzers();game.registerBuzz(a.id);game.markCorrect(a.id);
  assert.equal(game.phase,"ended");assert.deepEqual(game.finalState!.winnerIds,[a.id]);
});

test("ties at the route cutoff require an explicit host decision",()=>{
  const game=new GameEngine("TIE");const a=game.addTeam("A"),b=game.addTeam("B"),c=game.addTeam("C");
  a.qualifiedForFinal=true;a.score=10000;b.score=400;c.score=400;
  game.finishRoutePhase();assert.equal(game.phase,"qualification");
  game.selectFinalists([b.id,c.id]);assert.equal(game.phase,"qualification");
  game.selectFinalists([a.id,c.id]);assert.equal(game.phase,"final");assert.deepEqual(game.finalState!.finalists,[a.id,c.id]);
});

test("route exhaustion preserves a reserved final set and an empty tied final ends explicitly shared",()=>{
  const {game,a,b}=finalGame();assert.ok(game.reservedFinalQuestionIds.length>0);
  const empty=new BaseGameEngine("EMPTYFINAL",[]);empty.addTeam("A");empty.addTeam("B");
  empty.finishRoutePhase();empty.advanceFinal();assert.equal(empty.phase,"ended");assert.equal(empty.finalState!.winnerIds.length,2);assert.match(empty.finalState!.resultNote!,/delt seier/);
});

test("private multiple choice also works for finalists and never accepts spectator answers",()=>{
  const {game,a,b,c}=finalGame();
  game.activeQuestion!.mode="private_choice";game.activeQuestion!.choices=["Ja","Nei"];
  game.startReading();game.openBuzzers();game.submitFriendAnswer(a.id,"Ja");game.submitFriendAnswer(b.id,"Nei");game.submitFriendAnswer(c.id,"Ja");
  assert.deepEqual(game.toPublicState().friendAnswersSubmitted,[a.id,b.id]);
  game.revealFriendAnswers();assert.equal(game.finalState!.scores[a.id],200);assert.equal(game.finalState!.scores[b.id],0);assert.equal(game.finalState!.roundPhase,"resolved");
  assert.equal(game.toPublicState().revealedQuestion?.answer,"Ja");
});

test("restored games keep scores, question usage and Final state but pause and clear presence",()=>{
  const {game,a}=finalGame();game.startReading();game.openBuzzers();game.registerBuzz(a.id);game.markCorrect(a.id);
  const restored=BaseGameEngine.restore(game.exportState());
  assert.equal(restored.paused,true);assert.ok(restored.teams.every(t=>!t.connected));
  assert.deepEqual(restored.finalState,game.finalState);assert.deepEqual(restored.reservedFinalQuestionIds,game.reservedFinalQuestionIds);
  restored.advanceFinal();assert.equal(restored.finalState!.currentIndex,0);
  restored.resume();restored.advanceFinal();assert.equal(restored.finalState!.currentIndex,1);
});

test("undo restores adjudication and scores, pauses the game and preserves live presence",()=>{
  const {game,team}=activeGame();const id=game.activeQuestion!.id;game.startReading();game.openBuzzers();game.registerBuzz(team.id);game.markCorrect(team.id);
  assert.ok(game.toHostState().canUndo);assert.equal(game.activeQuestion,null);
  game.setConnected(team.id,false);game.undo();
  const restored=game.teams.find(t=>t.id===team.id)!;
  assert.equal(restored.score,0);assert.equal(restored.connected,false);assert.equal(game.paused,true);assert.equal(game.phase,"adjudicating");assert.equal(game.activeQuestion!.id,id);
  game.resume();game.markWrong(team.id);assert.ok(restored.score<0);game.undo();assert.equal(game.teams[0].score,0);
});

test("replacement clears answers and buzzes without reusing the old question; undo restores it",()=>{
  const {game,team}=activeGame();game.startReading();game.openBuzzers();game.registerBuzz(team.id);const old=game.activeQuestion!.id;
  assert.equal(game.replaceQuestion(),true);assert.notEqual(game.activeQuestion!.id,old);assert.equal(game.phase,"map");assert.deepEqual(game.buzzOrder,[]);assert.equal(game.questionPool.find(q=>q.id===old)!.status,"used");
  game.undo();assert.equal(game.activeQuestion!.id,old);assert.equal(game.phase,"adjudicating");assert.equal(game.currentResponderId(),team.id);
});

test("server answer clock penalizes silence once, reopens with at least five seconds and freezes during a spoken answer",()=>{
  const {game,team}=activeGame();game.addTeam("B");game.startReading();game.openBuzzers();
  assert.equal(game.clock.kind,"question");game.registerBuzz(team.id);assert.equal(game.clock.kind,"answer");
  const due=game.clock.deadline!;assert.equal(game.tick(due-1),false);assert.equal(game.tick(due),true);
  assert.equal(team.score,-TIER_POINTS[game.activeQuestion!.tier]);assert.equal(game.phase,"buzzing");assert.ok(game.clock.remainingMs>=5000);
  const other=game.teams[1];game.registerBuzz(other.id);game.answerStarted();assert.equal(game.clock.kind,null);
  assert.equal(game.tick(Date.now()+60000),false);assert.equal(game.phase,"adjudicating");
});

test("pause and recovery preserve remaining clock time; a late correct command cannot beat expiry",()=>{
  const {game,team}=activeGame();game.startReading();game.openBuzzers();game.registerBuzz(team.id);
  game.pause();const remaining=game.clock.remainingMs;assert.equal(game.clock.deadline,null);assert.equal(game.tick(Date.now()+60000),false);
  const restored=BaseGameEngine.restore(game.exportState());assert.equal(restored.clock.remainingMs,remaining);assert.equal(restored.paused,true);restored.resume();assert.equal(restored.clock.kind,"answer");
  game.resume();game.clock.deadline=Date.now()-1;game.markCorrect(team.id);assert.ok(team.score<0);assert.equal(game.phase,"dead_question");
});

test("question deadline ends normal buzzing and auto-reveals private choices",()=>{
  const {game}=activeGame();game.startReading();game.openBuzzers();game.tick(game.clock.deadline!);assert.equal(game.phase,"dead_question");assert.equal(game.clock.kind,null);
  const privateGame=activeGame();privateGame.game.activeQuestion!.mode="private_choice";privateGame.game.activeQuestion!.choices=["Ja","Nei"];privateGame.game.activeQuestion!.answer="Ja";
  privateGame.game.startReading();privateGame.game.openBuzzers();privateGame.game.submitFriendAnswer(privateGame.team.id,"Ja");privateGame.game.tick(privateGame.game.clock.deadline!);
  assert.ok(privateGame.team.score>0);assert.equal(privateGame.game.revealedQuestion?.answer,"Ja");
});

test("a team strictly above a tied cutoff cannot lose its finalist slot to host selection",()=>{
  const game=new GameEngine("CUTOFF");const a=game.addTeam("A"),b=game.addTeam("B"),c=game.addTeam("C");a.score=600;b.score=400;c.score=400;
  game.finishRoutePhase();assert.equal(game.phase,"qualification");assert.equal(a.qualifiedForFinal,true);
  game.selectFinalists([b.id,c.id]);assert.equal(game.phase,"qualification");
  game.selectFinalists([a.id,b.id]);assert.equal(game.phase,"final");
});
