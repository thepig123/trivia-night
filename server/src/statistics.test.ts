import test from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "./gameState.js";
import type {Question} from "./types.js";

const pool:Question[]=Array.from({length:30},(_,i)=>({id:`STAT${i}`,category:"Music",tier:"T5",prompt:`Question ${i}`,answer:"A",acceptedAlternatives:[],status:"unused",mode:"buzzer"}));
function active(){const game=new GameEngine("STATS",pool);const a=game.addTeam("A"),b=game.addTeam("B"),c=game.addTeam("C");game.activateCurrentNode();return {game,a,b,c};}

test("buzz averages, extremes and conversion exclude pause and adjudication time but include valid rebounds",()=>{
  const originalNow=Date.now;let now=100000;Date.now=()=>now;
  try {
    const {game,a,b}=active();game.startReading();game.openBuzzers();assert.equal(game.registerBuzz("invalid"),false);
    now+=500;game.pause();now+=10000;assert.equal(game.registerBuzz(a.id),false);game.resume();
    now+=500;assert.equal(game.registerBuzz(a.id),true);assert.equal(game.registerBuzz(a.id),false);assert.equal(game.registerBuzz(b.id),false);
    now+=5000;game.markWrong(a.id);now+=400;assert.equal(game.registerBuzz(b.id),true);game.markCorrect(b.id);
    let stats=game.toHostState().statistics;const firstA=stats.teams.find(t=>t.teamId===a.id)!,firstB=stats.teams.find(t=>t.teamId===b.id)!;
    assert.equal(firstA.averageBuzzMs,1000);assert.equal(firstB.averageBuzzMs,1400);assert.equal(firstA.wrong,1);assert.equal(firstB.correct,1);assert.equal(firstB.firstBuzzes,0);
    const next=game.toHostState().legalNextNodeIds[0];game.chooseRoute(b.id,next);game.startReading();game.openBuzzers();now+=2000;game.registerBuzz(a.id);game.markCorrect(a.id);
    stats=game.toHostState().statistics;const row=stats.teams.find(t=>t.teamId===a.id)!;
    assert.equal(row.averageBuzzMs,1500);assert.equal(row.fastestBuzzMs,1000);assert.equal(row.slowestBuzzMs,2000);assert.equal(row.buzzCount,2);assert.equal(row.firstBuzzes,2);assert.equal(row.correct,1);assert.equal(row.wrong,1);assert.equal(row.accuracy,.5);
    assert.equal(stats.completedQuestions,2);assert.equal(stats.categories[0].attempts,3);assert.equal(stats.hardestCategory?.category,"Music");
    assert.equal(game.toPublicState().statistics,null); // detailed statistics stay private during play
  }finally{Date.now=originalNow;}
});

test("Undo corrects verdict statistics without duplicating buzzes, and replacing a question voids its metrics",()=>{
  const {game,a,b}=active();game.startReading();game.openBuzzers();game.registerBuzz(a.id);game.markCorrect(a.id);
  assert.equal(game.toHostState().statistics.teams[0].correct,1);
  game.undo();let stats=game.toHostState().statistics;assert.equal(stats.teams[0].correct,0);assert.equal(stats.teams[0].buzzCount,1);assert.equal(stats.completedQuestions,0);
  game.resume();game.markWrong(a.id);assert.equal(game.toHostState().statistics.teams[0].wrong,1);
  assert.equal(game.replaceQuestion(),true);stats=game.toHostState().statistics;assert.equal(stats.teams[0].wrong,0);assert.equal(stats.teams[0].buzzCount,0);assert.equal(stats.trackedQuestions,0);
  game.undo();assert.equal(game.toHostState().statistics.teams[0].wrong,1);game.resume();game.registerBuzz(b.id);game.markCorrect(b.id);
  stats=game.toHostState().statistics;assert.equal(stats.teams[0].wrong,1);assert.equal(stats.teams[1].correct,1);assert.equal(stats.completedQuestions,1);
});

test("private answer statistics appear after reveal, count nonresponders honestly and never invent buzz times",()=>{
  const {game,a,b,c}=active();game.activeQuestion!.mode="private_choice";game.activeQuestion!.choices=["A","B"];
  game.startReading();game.openBuzzers();game.submitFriendAnswer(a.id,"A");game.submitFriendAnswer(b.id,"B");
  assert.equal(game.toHostState().statistics.teams[0].correct,0);game.revealFriendAnswers();
  const stats=game.toHostState().statistics;assert.equal(stats.teams[0].correct,1);assert.equal(stats.teams[1].wrong,1);assert.equal(stats.teams[2].accuracy,null);assert.equal(stats.teams[2].questionsSeen,1);
  assert.ok(stats.teams.every(t=>t.buzzCount===0&&t.averageBuzzMs===null));assert.equal(stats.hardestCategory,null);assert.equal(stats.easiestCategory,null);
});

test("recovery preserves accumulated buzz-window time and excludes restart downtime",()=>{
  const originalNow=Date.now;let now=50000;Date.now=()=>now;
  try {
    const {game,a}=active();game.eventMode=true;game.startReading();game.openBuzzers();now+=300;
    const restored=GameEngine.restore(game.exportState());now+=50000;restored.setConnected(a.id,true);restored.resume();now+=400;
    assert.equal(restored.registerBuzz(a.id),true);restored.markCorrect(a.id);
    assert.equal(restored.toHostState().statistics.teams[0].fastestBuzzMs,700);assert.equal(restored.toHostState().statistics.teams[0].correct,1);
  }finally{Date.now=originalNow;}
});

test("skipped questions and category accuracy have clear sample counts",()=>{
  const {game,a}=active();game.startReading();game.skipQuestion();
  assert.equal(game.toHostState().statistics.skippedQuestions,1);assert.equal(game.toHostState().statistics.teams[0].accuracy,null);
  game.startReading();game.openBuzzers();game.registerBuzz(a.id);game.markCorrect(a.id);
  const stats=game.toHostState().statistics;assert.equal(stats.completedQuestions,2);assert.equal(stats.hardestCategory,null);assert.equal(stats.categories[0].attempts,1);
});

test("lobby settings persist, validate shareable URLs and lock after play starts",()=>{
  const {game}=active();game.phase="lobby";
  assert.equal(game.configureLobby("quiz med gutta","https://quiz.vercel.app","/media/lobby.mp3"),true);
  assert.equal(game.configureLobby("Oops","javascript:alert(1)",""),false);assert.equal(game.configureLobby("Oops","https://user:secret@example.com",""),false);
  assert.equal(GameEngine.restore(game.exportState()).lobby.joinUrl,"https://quiz.vercel.app");
  game.phase="map";game.startReading();assert.equal(game.configureLobby("Oops","https://other.example",""),false);assert.equal(game.lobby.title,"quiz med gutta");
});

test("category difficulty reflects judged attempts with minimum sample sizes",()=>{
  const {game,a,b,c}=active();
  const round=(category:string,wrongIds:string[],winnerId:string)=>{
    game.activeQuestion!.category=category;game.startReading();game.openBuzzers();
    for(const id of wrongIds){game.registerBuzz(id);game.markWrong(id);}
    game.registerBuzz(winnerId);game.markCorrect(winnerId);
    game.chooseRoute(winnerId,game.toHostState().legalNextNodeIds[0]);
  };
  round("Hard",[a.id],b.id);round("Hard",[a.id,b.id],c.id);
  round("Easy",[],a.id);round("Easy",[],b.id);round("Easy",[],c.id);
  const stats=game.toHostState().statistics;
  assert.equal(stats.hardestCategory?.category,"Hard");assert.equal(stats.hardestCategory?.attempts,5);assert.equal(stats.hardestCategory?.accuracy,.4);
  assert.equal(stats.easiestCategory?.category,"Easy");assert.equal(stats.easiestCategory?.accuracy,1);
});
