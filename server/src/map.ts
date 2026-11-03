import { nanoid } from "nanoid";
import { isGutta } from "./types.js";
import type { MapNode, RouteMap, Tier, Question } from "./types.js";

const LOOKAHEAD_ROWS = 5;

function shuffled<T>(values: readonly T[]): T[] { return [...values].sort(() => Math.random() - 0.5); }
function tiersForStep(step: number): Tier[] {
  if (step <= 4) return shuffled<Tier>(["T5", "T4", "T3"]);
  if (step <= 9) return shuffled<Tier>(["T4", "T3", "T2"]);
  return shuffled<Tier>(["T3", "T2", "T1"]);
}
// Category previews never reserve a question. Gutta has no difficulty gate
// (always 500 points), and gets 1.5x the weight of another eligible category.
export function routeOptions(tier: Tier, pool: Question[]): {tier: Tier; category: string} {
  const unused = pool.filter(q => q.status === "unused");
  const matching = unused.filter(q => q.tier === tier || isGutta(q.category));
  const eligible = matching.length ? matching : unused;
  const categories = [...new Set(eligible.map(q => q.category))];
  let roll = Math.random() * categories.reduce((sum, category) => sum + (isGutta(category) ? 1.5 : 1), 0);
  const category = categories.find(category => (roll -= isGutta(category) ? 1.5 : 1) < 0);
  if (!category) return {tier, category: "Ingen flere spørsmål"};
  const actualTier = isGutta(category) || eligible.some(q => q.category === category && q.tier === tier)
    ? tier : eligible.find(q => q.category === category)!.tier;
  return {tier: actualTier, category};
}

export function refreshRouteOptions(map: RouteMap, pool: Question[]): RouteMap {
  return {...map, nodes: map.nodes.map(node => {
    if (!node.tier || node.questionId || !["locked", "available"].includes(node.status)) return node;
    const playable = pool.some(q => q.status === "unused" && q.category === node.category && (isGutta(node.category) || q.tier === node.tier));
    return playable ? node : {...node, ...routeOptions(node.tier, pool)};
  })};
}

function makeRow(step: number, pool: Question[] = []): MapNode[] {
  const tiers = tiersForStep(step);
  const options = (tier: Tier) => routeOptions(tier, pool);
  if (step === 1) {
    return [{ id: nanoid(8), step, slot: 1, ...options(tiers[1]), status: "locked", questionId: null, nextNodeIds: [] }];
  }
  return [0, 1, 2].map((slot) => ({ id: nanoid(8), step, slot, ...options(tiers[slot]), status: "locked", questionId: null, nextNodeIds: [] }));
}
function connectRows(nodes: MapNode[], fromStep: number, toStep: number) {
  const from = nodes.filter((node) => node.step === fromStep);
  const to = nodes.filter((node) => node.step === toStep);
  for (const node of from) {
    // A single committed encounter every four rows; every following row
    // branches again, so no path can chain forced encounters.
    const isCommittedRow = toStep % 4 === 3;
    const targets = fromStep === 0
      ? new Set([1])
      : fromStep === 1
        ? new Set([0, 1, 2])
      : isCommittedRow
        ? new Set([node.slot])
        : new Set([node.slot, node.slot === 2 ? 1 : node.slot + 1]);
    node.nextNodeIds = to.filter((candidate) => targets.has(candidate.slot)).map((candidate) => candidate.id);
  }
}
function appendRows(map: RouteMap, throughStep: number, pool?: Question[]): RouteMap {
  const nodes = map.nodes.map((node) => ({ ...node, nextNodeIds: [...node.nextNodeIds] }));
  for (let step = map.steps + 1; step <= throughStep; step++) { nodes.push(...makeRow(step, pool)); connectRows(nodes, step - 1, step); }
  return { ...map, nodes, steps: throughStep };
}
function currentNode(map: RouteMap) { return map.nodes.find((node) => node.id === map.selectedPath.at(-1)); }
function unlockNext(map: RouteMap): RouteMap {
  const legal = new Set(currentNode(map)?.nextNodeIds ?? []);
  return { ...map, nodes: map.nodes.map((node) => legal.has(node.id) ? { ...node, status: "available" as const } : node) };
}
export function generateRouteMap(pool?: Question[]): RouteMap {
  const start: MapNode = { id: "START", step: 0, slot: 1, tier: null, category: null, status: "selected", questionId: null, nextNodeIds: [] };
  return unlockNext(appendRows({ steps: 0, nodes: [start], selectedPath: ["START"], currentStep: 0 }, LOOKAHEAD_ROWS, pool));
}
export function legalNextNodeIds(map: RouteMap): string[] {
  return (currentNode(map)?.nextNodeIds ?? []).filter((id) => map.nodes.some((node) => node.id === id && node.status === "available"));
}
export function chooseRoute(map: RouteMap, nodeId: string, pool?: Question[]): RouteMap {
  if (!legalNextNodeIds(map).includes(nodeId)) return map;
  const chosen = map.nodes.find((node) => node.id === nodeId)!;
  let next: RouteMap = { ...map, nodes: map.nodes.map((node) => node.id === chosen.id ? { ...node, status: "selected" as const } : node.step === chosen.step && node.status === "available" ? { ...node, status: "rejected" as const } : node), selectedPath: [...map.selectedPath, chosen.id], currentStep: chosen.step };
  if (next.steps - next.currentStep < LOOKAHEAD_ROWS) next = appendRows(next, next.currentStep + LOOKAHEAD_ROWS, pool);
  return unlockNext(next);
}
export function markNodeCompleted(map: RouteMap, nodeId: string): RouteMap {
  return { ...map, nodes: map.nodes.map((node) => node.id === nodeId ? { ...node, status: "completed" as const } : node) };
}
