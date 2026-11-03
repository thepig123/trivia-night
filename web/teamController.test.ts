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
