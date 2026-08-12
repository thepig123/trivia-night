import assert from "node:assert/strict";
import test from "node:test";
import { GameEngine } from "./gameState.js";
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

test("route is fully previewable with category and tier metadata", () => {
  const game = new GameEngine("MAP01");
  assert.equal(game.map.nodes.length, 1 + game.map.steps * 3);
  for (const node of game.map.nodes.filter((candidate) => candidate.id !== "START")) {
    assert.ok(node.category);
    assert.ok(node.tier);
  }

  game.activateCurrentNode();
  const activeNode = game.map.nodes.find((node) => node.id === game.activeNodeId);
  assert.equal(game.activeQuestion?.category, activeNode?.category);
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

test("provisional Final advances and ends cleanly", () => {
  const game = new GameEngine("TEST3");
  const first = game.addTeam("First");
  const second = game.addTeam("Second");
  first.qualifiedForFinal = true;
  second.qualifiedForFinal = true;

  // Reaching the route limit invokes the same Final setup path.
  game.map.currentStep = game.map.steps;
  game.activateCurrentNode();
  // Use the public transition by qualifying a fresh game instead; startFinal
  // itself is deliberately private, so exercise it through a correct answer.
  const qualifying = new GameEngine("TEST4");
  const a = qualifying.addTeam("A");
  const b = qualifying.addTeam("B");
  a.qualifiedForFinal = true;
  qualifying.activateCurrentNode();
  const node = qualifying.map.nodes.find((candidate) => candidate.id === qualifying.activeNodeId)!;
  b.score = qualifying.targetScore - TIER_POINTS[node.tier!];
  qualifying.startReading();
  qualifying.openBuzzers();
  qualifying.registerBuzz(b.id);
  qualifying.markCorrect(b.id);

  const count = qualifying.finalState!.questionIds.length;
  for (let i = 0; i < count; i++) qualifying.advanceFinal();
  assert.equal(qualifying.phase, "ended");
  assert.equal(qualifying.activeQuestion, null);
});
