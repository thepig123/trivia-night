import { nanoid } from "nanoid";
import type { MapNode, RouteMap, Tier } from "./types.js";

const LOOKAHEAD_ROWS = 5;
const CATEGORIES = ["Vitenskap", "Historie", "Geografi", "Popkultur", "Sport", "Gutta"] as const;

function shuffled<T>(values: readonly T[]): T[] { return [...values].sort(() => Math.random() - 0.5); }
function tiersForStep(step: number): Tier[] {
  if (step <= 4) return shuffled<Tier>(["T5", "T4", "T3"]);
  if (step <= 9) return shuffled<Tier>(["T4", "T3", "T2"]);
  return shuffled<Tier>(["T3", "T2", "T1"]);
}
function makeRow(step: number): MapNode[] {
  const tiers = tiersForStep(step);
  const categories = shuffled(CATEGORIES).slice(0, 3);
  return [0, 1, 2].map((slot) => ({ id: nanoid(8), step, slot, tier: tiers[slot], category: categories[slot], status: "locked", questionId: null, nextNodeIds: [] }));
}
function connectRows(nodes: MapNode[], fromStep: number, toStep: number) {
  const from = nodes.filter((node) => node.step === fromStep);
  const to = nodes.filter((node) => node.step === toStep);
  for (const node of from) {
    // Some routes become committed runs, but never for more than three
    // encounters: rows 2–4 in each five-row cycle have one exit, then the
    // fifth row branches and reconnects the lanes.
    const cycle = toStep % 5;
    const isCommittedRow = cycle >= 2 && cycle <= 4;
    const targets = fromStep === 0
      ? new Set([0, 1, 2])
      : isCommittedRow
        ? new Set([node.slot])
        : new Set([node.slot, node.slot === 2 ? 1 : node.slot + 1]);
    node.nextNodeIds = to.filter((candidate) => targets.has(candidate.slot)).map((candidate) => candidate.id);
  }
}
function appendRows(map: RouteMap, throughStep: number): RouteMap {
  const nodes = map.nodes.map((node) => ({ ...node, nextNodeIds: [...node.nextNodeIds] }));
  for (let step = map.steps + 1; step <= throughStep; step++) { nodes.push(...makeRow(step)); connectRows(nodes, step - 1, step); }
  return { ...map, nodes, steps: throughStep };
}
function currentNode(map: RouteMap) { return map.nodes.find((node) => node.id === map.selectedPath.at(-1)); }
function unlockNext(map: RouteMap): RouteMap {
  const legal = new Set(currentNode(map)?.nextNodeIds ?? []);
  return { ...map, nodes: map.nodes.map((node) => legal.has(node.id) ? { ...node, status: "available" as const } : node) };
}
export function generateRouteMap(): RouteMap {
  const start: MapNode = { id: "START", step: 0, slot: 1, tier: null, category: null, status: "selected", questionId: null, nextNodeIds: [] };
  return unlockNext(appendRows({ steps: 0, nodes: [start], selectedPath: ["START"], currentStep: 0 }, LOOKAHEAD_ROWS));
}
export function legalNextNodeIds(map: RouteMap): string[] {
  return (currentNode(map)?.nextNodeIds ?? []).filter((id) => map.nodes.some((node) => node.id === id && node.status === "available"));
}
export function chooseRoute(map: RouteMap, nodeId: string): RouteMap {
  if (!legalNextNodeIds(map).includes(nodeId)) return map;
  const chosen = map.nodes.find((node) => node.id === nodeId)!;
  let next: RouteMap = { ...map, nodes: map.nodes.map((node) => node.id === chosen.id ? { ...node, status: "selected" as const } : node.step === chosen.step && node.status === "available" ? { ...node, status: "rejected" as const } : node), selectedPath: [...map.selectedPath, chosen.id], currentStep: chosen.step };
  if (next.steps - next.currentStep < LOOKAHEAD_ROWS) next = appendRows(next, next.currentStep + LOOKAHEAD_ROWS);
  return unlockNext(next);
}
export function markNodeCompleted(map: RouteMap, nodeId: string): RouteMap {
  return { ...map, nodes: map.nodes.map((node) => node.id === nodeId ? { ...node, status: "completed" as const } : node) };
}
