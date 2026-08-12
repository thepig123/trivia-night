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

test("teams self-register with two players and rooms cap at five teams", () => {
  const game = new GameEngine("LOBBY");
  const team = game.registerTeam("Night Owls", ["Alice", "Bob"]);
  assert.equal(team?.name, "Night Owls");
  assert.deepEqual(team?.players, ["Alice", "Bob"]);
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
