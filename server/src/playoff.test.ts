import test from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "./gameState.js";
import type {Question, Tier} from "./types.js";

function playoffGame(mainScores=[2100,100,50],target=10000) {
  const pool:Question[]=Array.from({length:32},(_,i)=>({id:`PLAY${i}`,category:i===2?"Gutta":"General",tier:(["T5","T4","T3","T2","T1"] as Tier[])[i%5],prompt:`Question ${i}`,answer:"A",acceptedAlternatives:[],status:"unused",mode:"buzzer"}));
  const playoffIds=pool.slice(0,5).map(q=>q.id),finalIds=pool.slice(5,10).map(q=>q.id);
  const game=new GameEngine("PLAY1",pool,finalIds,playoffIds);
  const first=game.addTeam("Main winner"),b=game.addTeam("High main score"),c=game.addTeam("Low main score"),d=game.addTeam("Other team");
  game.targetScore=target;
  game.activateCurrentNode();
  const points=game.toPublicState().activeQuestionPublic!.points;
  first.score=game.targetScore-points;b.score=mainScores[0];c.score=mainScores[1];d.score=mainScores[2];
  game.startReading();game.openBuzzers();game.registerBuzz(first.id);game.markCorrect(first.id);
  return {game,first,b,c,d,playoffIds,finalIds};
}
function answer(game:GameEngine,teamId:string) {
  game.startReading();game.openBuzzers();assert.equal(game.registerBuzz(teamId),true);game.markCorrect(teamId);
}

test("first target hit freezes the route and starts exactly five reserved, equal-weight playoff questions",()=>{
  const {game,first,b,c,d,playoffIds,finalIds}=playoffGame();
  assert.equal(game.phase,"playoff");assert.equal(game.finalState,null);assert.equal(first.qualifiedForFinal,true);
  assert.deepEqual(new Set(game.playoffState!.questionIds),new Set(playoffIds));
  assert.deepEqual(game.playoffState!.scores,{[b.id]:0,[c.id]:0,[d.id]:0});
  assert.equal(game.toPublicState().activeQuestionPublic?.points,1);
  assert.ok(finalIds.every(id=>game.questionPool.find(q=>q.id===id)!.status==="unused"));
  const map=JSON.stringify(game.map);game.chooseRoute(first.id,game.map.nodes.find(n=>n.status==="available")!.id);assert.equal(JSON.stringify(game.map),map);
  game.startReading();game.openBuzzers();assert.equal(game.registerBuzz(first.id),false);
  game.adjustScore(c.id,10000);assert.equal(c.score,100);assert.equal(game.playoffState!.scores[c.id],0);
});

test("all five questions are played and correct answers decide when gaps earn no head start",()=>{
  const {game,first,b,c,d,finalIds}=playoffGame();
  for(let i=0;i<5;i++){
    const winner=i<3?c:b;
    assert.equal(game.toPublicState().activeQuestionPublic?.points,1);
    answer(game,winner.id);
    assert.equal(game.phase,"playoff"); // do not clinch early, even at three of five
    assert.equal(game.playoffState!.currentIndex,i);
    game.advancePlayoff();
    if(i<4)assert.equal(game.phase,"playoff");
  }
  assert.equal(game.playoffState!.stage,"duel");assert.equal(game.phase,"playoff");
  assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,c.id]));
  assert.deepEqual(Object.values(game.playoffState!.scores),[0,0]);
  assert.equal(game.playoffState!.eliminationResult!.scores[c.id],3);
  for(let i=0;i<3;i++){answer(game,c.id);assert.equal(game.phase,"playoff");game.advancePlayoff();}
  assert.equal(game.phase,"final");assert.deepEqual(new Set(game.finalState!.finalists),new Set([first.id,c.id]));
  assert.deepEqual([first.score,b.score,c.score,d.score],[10000,2100,100,50]);
  assert.deepEqual(Object.values(game.finalState!.scores),[0,0]);assert.deepEqual(new Set(game.finalState!.questionIds),new Set(finalIds));
});

test("wrong playoff answers lock out the team but never deduct points, and skip counts as an unanswered slot",()=>{
  const {game,b,c}=playoffGame();answer(game,b.id);game.advancePlayoff();game.startReading();game.openBuzzers();game.registerBuzz(b.id);game.markWrong(b.id);
  assert.equal(game.playoffState!.scores[b.id],1);assert.equal(b.score,2100);assert.ok(game.lockedOutTeamIds.includes(b.id));
  assert.equal(game.registerBuzz(b.id),false);assert.equal(game.registerBuzz(c.id),true);game.markCorrect(c.id);
  game.advancePlayoff();game.skipQuestion();assert.equal(game.playoffState!.currentIndex,2);game.advancePlayoff();assert.equal(game.playoffState!.currentIndex,3);
});

test("bottom-place ties preserve a safe team's seat and protect duel/final reserves",()=>{
  const {game,first,b,c,d,finalIds}=playoffGame();
  for(const winner of [b,b,b,c,d]){answer(game,winner.id);game.advancePlayoff();}
  assert.equal(game.playoffState!.stage,"elimination_tiebreak");
  assert.deepEqual(game.playoffState!.safeTeamIds,[b.id]);
  assert.deepEqual(new Set(game.playoffState!.contenders),new Set([c.id,d.id]));
  assert.ok([...finalIds,...game.reservedDuelQuestionIds].every(id=>game.questionPool.find(q=>q.id===id)!.status==="unused"));
  game.startReading();game.openBuzzers();assert.equal(game.registerBuzz(first.id),false);assert.equal(game.registerBuzz(b.id),false);
  game.registerBuzz(c.id);game.markCorrect(c.id);game.advancePlayoff();
  assert.equal(game.playoffState!.stage,"duel");assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,c.id]));
  assert.deepEqual(Object.values(game.playoffState!.scores),[0,0]);assert.deepEqual(game.playoffState!.headStarts,{});
});

test("all-team tie locks each earned seat before resolving the remaining cutoff",()=>{
  const {game,b,c,d}=playoffGame();
  for(let i=0;i<5;i++){game.skipQuestion();game.advancePlayoff();}
  answer(game,b.id);game.advancePlayoff();
  assert.deepEqual(game.playoffState!.safeTeamIds,[b.id]);assert.deepEqual(new Set(game.playoffState!.contenders),new Set([c.id,d.id]));
  answer(game,d.id);game.advancePlayoff();assert.equal(game.playoffState!.stage,"duel");
  assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,d.id]));
});

test("exhausted elimination ties require host decision and cannot remove a safe team",()=>{
  const {game,b,c,d}=playoffGame();
  for(const winner of [b,b,b,c,d]){answer(game,winner.id);if(game.playoffState!.currentIndex<4)game.advancePlayoff();}
  for(const q of game.questionPool)if(![...game.reservedFinalQuestionIds,...game.reservedDuelQuestionIds].includes(q.id))q.status="used";
  game.advancePlayoff();assert.equal(game.phase,"qualification");assert.equal(game.qualificationPurpose,"elimination");
  game.selectDuelists([c.id,d.id]);assert.equal(game.phase,"qualification");
  game.selectDuelists([b.id,c.id]);assert.equal(game.phase,"playoff");assert.equal(game.playoffState!.stage,"duel");assert.equal(game.playoffState!.questionIds.length,3);
});

test("a tied three-question duel uses sudden death, then oral fallback if exhausted",()=>{
  const {game,first,b,c}=playoffGame();
  for(const winner of [b,b,b,c,c]){answer(game,winner.id);game.advancePlayoff();}
  for(const winner of [b,c,null]){if(winner)answer(game,winner.id);else game.skipQuestion();game.advancePlayoff();}
  assert.equal(game.playoffState!.stage,"duel_tiebreak");assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,c.id]));
  game.skipQuestion();for(const q of game.questionPool)if(!game.reservedFinalQuestionIds.includes(q.id))q.status="used";
  game.advancePlayoff();assert.equal(game.phase,"qualification");assert.equal(game.qualificationPurpose,"second");
  game.selectFinalists([b.id,c.id]);assert.equal(game.phase,"qualification");
  game.selectFinalists([first.id,c.id]);assert.equal(game.phase,"final");
});

test("playoff private choice and nearest-number rounds award one each and reject the first qualifier",()=>{
  for(const mode of ["private_choice","closest"] as const){
    const {game,first,b,c,d}=playoffGame();const q=game.activeQuestion!;q.mode=mode;q.answer=mode==="closest"?"100":"A";q.choices=["A","B"];
    game.startReading();game.openBuzzers();game.submitFriendAnswer(first.id,q.answer);assert.equal(game.friendAnswers[first.id],undefined);
    game.submitFriendAnswer(b.id,mode==="closest"?"90":"A");game.submitFriendAnswer(c.id,mode==="closest"?"110":"A");game.submitFriendAnswer(d.id,mode==="closest"?"200":"B");
    assert.equal(game.toPublicState().revealedQuestion,null);game.revealFriendAnswers();
    assert.equal(game.playoffState!.scores[b.id],1);assert.equal(game.playoffState!.scores[c.id],1);assert.equal(game.playoffState!.scores[d.id],0);
    assert.equal(game.toPublicState().feedback?.points,1);assert.equal(game.toPublicState().revealedQuestion?.results?.length,3);
    assert.equal(game.playoffState!.roundPhase,"resolved");assert.equal(b.score,2100);
  }
});

test("playoff score undo, replacement, pause and restart recovery preserve the five-question flow",()=>{
  const {game,first,b}=playoffGame();const original=game.activeQuestion!.id;
  assert.equal(game.replaceQuestion(),true);assert.notEqual(game.activeQuestion!.id,original);assert.equal(game.playoffState!.questionIds.length,5);assert.equal(game.playoffState!.currentIndex,0);
  assert.ok(!game.reservedFinalQuestionIds.includes(game.activeQuestion!.id));
  answer(game,b.id);assert.equal(game.playoffState!.scores[b.id],1);
  const restored=GameEngine.restore(game.exportState());assert.equal(restored.phase,"playoff");assert.equal(restored.paused,true);assert.deepEqual(restored.playoffState,game.playoffState);assert.equal(restored.teams.find(t=>t.id===first.id)!.qualifiedForFinal,true);
  restored.advancePlayoff();assert.equal(restored.playoffState!.currentIndex,0);restored.resume();restored.advancePlayoff();assert.equal(restored.playoffState!.currentIndex,1);
  game.undo();assert.equal(game.playoffState!.scores[b.id],0);assert.equal(game.playoffState!.roundPhase,"adjudicating");assert.equal(game.paused,true);
  game.resume();game.markCorrect(b.id);assert.equal(game.playoffState!.scores[b.id],1);assert.equal(game.playoffState!.currentIndex,0);
});

test("simultaneous main-game leaders require a first-place tiebreak before the separate playoff",()=>{
  const {game}=playoffGame(); // create a separate fresh main game from its fixture pool
  const fresh=new GameEngine("MAINT",game.questionPool.map(q=>({...q,status:"unused"})),[],[]);
  const a=fresh.addTeam("A"),b=fresh.addTeam("B"),c=fresh.addTeam("C");
  fresh.activateCurrentNode();const q=fresh.activeQuestion!;q.mode="private_choice";q.answer="A";q.choices=["A","B"];
  const points=fresh.toPublicState().activeQuestionPublic!.points;a.score=fresh.targetScore-points;b.score=a.score;
  fresh.startReading();fresh.openBuzzers();fresh.submitFriendAnswer(a.id,"A");fresh.submitFriendAnswer(b.id,"A");fresh.revealFriendAnswers();
  assert.equal(fresh.phase,"qualification");assert.equal(fresh.qualificationPurpose,"first");assert.equal(fresh.teams.some(t=>t.qualifiedForFinal),false);
  fresh.selectFirstQualifier(c.id);assert.equal(fresh.phase,"qualification");fresh.selectFirstQualifier(b.id);assert.equal(fresh.phase,"playoff");assert.equal(b.qualifiedForFinal,true);assert.equal(a.qualifiedForFinal,false);
});

test("automatic playoff reservation keeps five available until the first target is reached",()=>{
  const {game:source}=playoffGame();
  const game=new GameEngine("AUTOQ",source.questionPool.map(q=>({...q,status:"unused"})),source.reservedFinalQuestionIds);
  const a=game.addTeam("A");game.addTeam("B");game.addTeam("C");game.addTeam("D");
  const held=[...game.reservedPlayoffQuestionIds];assert.equal(held.length,5);
  game.activateCurrentNode();for(let i=0;i<3;i++){assert.ok(!held.includes(game.activeQuestion!.id));game.skipQuestion();}
  a.score=10000;game.setTargetScore(10000);
  assert.equal(game.phase,"playoff");assert.deepEqual(new Set(game.playoffState!.questionIds),new Set(held));
});

test("gap-based head starts recognise main scores in quarter-target steps, capped at two",()=>{
  const {game,b,c,d}=playoffGame([9000,6500,4000]);
  assert.deepEqual(game.playoffState!.headStarts,{[b.id]:2,[c.id]:1,[d.id]:0});
  assert.deepEqual(game.playoffState!.scores,{[b.id]:0,[c.id]:0,[d.id]:0});
  assert.deepEqual(game.playoffState!.mainScores,{[b.id]:9000,[c.id]:6500,[d.id]:4000});
  game.adjustScore(d.id,5000);game.setTargetScore(2000);
  assert.equal(d.score,4000);assert.equal(game.targetScore,10000);assert.equal(game.playoffState!.headStarts![d.id],0);
  const scaled=playoffGame([3000,2000,1000],4000);
  assert.deepEqual(Object.values(scaled.game.playoffState!.headStarts!),[2,1,0]);
  const justBelow=playoffGame([6499,4000,4000]);assert.deepEqual(Object.values(justBelow.game.playoffState!.headStarts!),[0,0,0]);
});
test("head starts affect advancement but never count as correct answers or grand-final points",()=>{
  const {game,first,b,c,d}=playoffGame([9000,6500,4000]);
  for(const winner of [d,d,d,b,b]){answer(game,winner.id);game.advancePlayoff();}
  assert.equal(game.playoffState!.stage,"duel");assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,d.id]));
  assert.equal(game.playoffState!.eliminationResult!.scores[b.id],2);assert.equal(game.playoffState!.eliminationResult!.scores[d.id],3);
  assert.equal(game.toHostState().statistics.teams.find(t=>t.teamId===b.id)!.playoffCorrect,2);
  assert.equal(game.toHostState().statistics.teams.find(t=>t.teamId===d.id)!.playoffCorrect,3);
  assert.deepEqual(Object.values(game.playoffState!.scores),[0,0]);
  for(let i=0;i<3;i++){answer(game,b.id);game.advancePlayoff();}
  assert.deepEqual(new Set(game.finalState!.finalists),new Set([first.id,b.id]));
});
test("main-game bonuses do not carry over into the duel",()=>{
  const {game,b,c,d}=playoffGame([9000,6500,4000]);
  for(const winner of [d,d,d,b,c]){answer(game,winner.id);game.advancePlayoff();}
  assert.equal(game.playoffState!.stage,"duel");assert.equal(game.playoffState!.suddenDeath,false);
  assert.deepEqual(new Set(game.playoffState!.contenders),new Set([b.id,d.id]));
  for(const winner of [d,b,d]){answer(game,winner.id);game.advancePlayoff();}
  assert.equal(game.phase,"final");assert.ok(game.finalState!.finalists.includes(d.id));
});

test("undo and recovery across the duel transition preserve elimination scores, bonus and stats",()=>{
  const {game,b,c}=playoffGame();
  for(const winner of [b,b,b,c,c]){answer(game,winner.id);if(game.playoffState!.currentIndex<4)game.advancePlayoff();}
  const before=JSON.parse(JSON.stringify(game.playoffState));const count=game.toHostState().questionsPlayed;
  game.advancePlayoff();assert.equal(game.playoffState!.stage,"duel");assert.equal(game.toHostState().questionsPlayed,count);
  game.undo();assert.deepEqual(game.playoffState,before);game.resume();game.advancePlayoff();
  const restored=GameEngine.restore(game.exportState());assert.deepEqual(restored.playoffState,game.playoffState);restored.resume();restored.setConnected(c.id,true);
  answer(restored,c.id);assert.equal(restored.playoffState!.scores[c.id],1);
  assert.equal(restored.toHostState().statistics.teams.find(t=>t.teamId===c.id)!.playoffCorrect,3);
});

test("two remaining teams go straight to a three-question duel without bonuses",()=>{
  const source=playoffGame();const game=new GameEngine("SMALL",source.game.questionPool.map(q=>({...q,status:"unused"})));
  const first=game.addTeam("First"),b=game.addTeam("Second"),c=game.addTeam("Third");first.score=10000;b.score=9000;c.score=100;
  game.setTargetScore(10000);assert.equal(game.playoffState!.stage,"duel");assert.equal(game.playoffState!.questionIds.length,3);
  assert.deepEqual(game.playoffState!.headStarts,{});assert.equal(game.playoffState!.eliminationResult,undefined);
  assert.equal(game.toHostState().questionsPlayed,0);
});
