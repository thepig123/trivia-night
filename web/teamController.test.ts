import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TeamController from "./src/components/TeamController.js";
import { GameEngine } from "../server/src/gameState.js";
import type { Question } from "../server/src/types.js";
const questions: Question[] = Array.from({length:24}, (_,i) => ({id:`P${i}`, category:"History", tier:"T5", prompt:`Question ${i}`, answer:"A", acceptedAlternatives:[], status:"unused", mode:"buzzer"}));

function routeGame() {
  const game = new GameEngine("PHONE", questions);
  const team = game.addTeam("Alpha");
  game.addTeam("Beta");
  game.activateCurrentNode();
  game.startReading(); game.openBuzzers(); game.registerBuzz(team.id); game.markCorrect(team.id);
  return {game, team};
}
function render(game: GameEngine, teamId: string, connected = true) {
  return renderToStaticMarkup(createElement(TeamController, {
    roomCode: game.roomCode, teamId, publicState: game.toPublicState(),
    connected, lastError: null, testControllers: [], send: () => {},
  }));
}

test("end-round undo keeps route choices visible while paused and enables them on resume", () => {
  const {game, team} = routeGame();
  const paths = game.toPublicState().legalNextNodeIds;
  game.finishRoutePhase();
  game.undo();
  assert.equal(game.phase, "route_choice");
  assert.equal(game.paused, true);
  const paused = render(game, team.id);
  assert.match(paused, /Velg rute/);
  assert.match(paused, /Spillet er satt på pause/);
  assert.doesNotMatch(paused, /DERES TUR!|buzzer-wrap|choose route/);
  game.resume();
  const resumed = render(game, team.id);
  assert.match(resumed, /choose route/);
  assert.doesNotMatch(resumed, /Spillet er satt på pause|DERES TUR!/);
  game.chooseRoute(team.id, paths[0]);
  assert.equal(game.phase, "map");
  assert.ok(game.activeQuestion);
});

test("waiting teams see who chooses the route, not a stale responder buzzer", () => {
  const {game} = routeGame();
  const html = render(game, game.teams[1].id);
  assert.match(html, /Alpha velger veien videre/);
  assert.doesNotMatch(html, /DERES TUR!|buzzer-wrap/);
});

test("disconnected route controller keeps its map but cannot select a route", () => {
  const {game, team} = routeGame();
  const html = render(game, team.id, false);
  assert.match(html, /Velg rute/);
  assert.match(html, /Mistet forbindelsen/);
  assert.doesNotMatch(html, /choose route|DERES TUR!/);
});

test("pausing an adjudication shows PAUSE instead of the active answering highlight", () => {
  const game = new GameEngine("PAUSE", questions);
  const team = game.addTeam("Alpha");
  game.activateCurrentNode(); game.startReading(); game.openBuzzers(); game.registerBuzz(team.id);
  game.pause();
  const html = render(game, team.id);
  assert.match(html, /PAUSE/);
  assert.doesNotMatch(html, /DERES TUR!/);
  game.resume();
  assert.match(render(game, team.id), /DERES TUR!/);
});

test("closest rounds render a numeric form with no buzzer and lock after submission",()=>{
  const pool=questions.map(q=>({...q,mode:"closest" as const,answer:"100"}));
  const game=new GameEngine("GUESS",pool);const team=game.addTeam("Alpha");game.activateCurrentNode();game.startReading();game.openBuzzers();
  const form=render(game,team.id);assert.match(form,/Deres tall/);assert.match(form,/Lås svaret/);assert.doesNotMatch(form,/buzzer-wrap/);
  game.submitFriendAnswer(team.id,"99");const submitted=render(game,team.id);assert.match(submitted,/Svar levert og låst/);assert.match(submitted,/disabled/);
});

import HostFocus from "./src/components/HostFocus.js";
import PackOverview from "./src/components/PackOverview.js";
import {newQuestion} from "./src/lib/bankModel.js";
test("host next-action panel guides reading, opening, adjudication and pause",()=>{
  const game=new GameEngine("FOCUS",questions);const team=game.addTeam("Alpha");game.addTeam("Beta");game.activateCurrentNode();
  const host=()=>renderToStaticMarkup(createElement(HostFocus,{state:game.toHostState(),connected:true,send:()=>{}}));
  assert.match(host(),/Les neste spørsmål/);game.startReading();assert.match(host(),/Åpne svar/);
  game.openBuzzers();game.registerBuzz(team.id);assert.match(host(),/Alpha svarer/);assert.match(host(),/Riktig/);
  game.pause();assert.match(host(),/Fortsett spillet/);
});
test("pack overview renders curated finals and thin-pool warnings",()=>{
  const q={...newQuestion(),id:"A",prompt:"Q",answer:"A",selection:"PICK" as const,readiness:"ready" as const};
  const pack={id:"P",name:"Evening",questionIds:["A"],finalQuestionIds:["A"]};
  const html=renderToStaticMarkup(createElement(PackOverview,{bank:{version:1,revision:1,questions:[q],packs:[pack],activePackId:"P"},pack}));
  assert.match(html,/reservert til finalen/);assert.match(html,/Ingen klare spørsmål til hovedrunden/);assert.match(html,/minst fem/);
});

test("playoff phones show a separate tally, hide the route and make first finalist a spectator",()=>{
  const game=new GameEngine("PHONE",Array.from({length:20},(_,i)=>({...questions[i%questions.length],id:`PLAYPHONE${i}`})));
  const a=game.addTeam("Alpha"),b=game.addTeam("Beta"),c=game.addTeam("Gamma"),d=game.addTeam("Delta");
  a.score=10000;b.score=9000;c.score=100;game.setTargetScore(10000);
  assert.equal(game.phase,"playoff");
  game.startReading();game.openBuzzers();
  const first=render(game,a.id);assert.match(first,/FINALIST/);assert.doesNotMatch(first,/buzzer-wrap|choose route/);
  const contender=render(game,c.id);assert.match(contender,/RIKTIGE I KVALIFISERINGEN/);assert.match(contender,/Kvalifisering om andreplassen/);assert.doesNotMatch(contender,/route-map|final-progress/);
  assert.equal(game.registerBuzz(c.id),true);game.markCorrect(c.id);
  assert.match(render(game,c.id),/1 riktige/);
  game.playoffState!.contenders=[b.id,c.id];game.playoffState!.suddenDeath=true;
  const eliminated=render(game,d.id);assert.match(eliminated,/UTE AV OMSPILLET/);assert.doesNotMatch(eliminated,/buzzer-wrap/);
});
