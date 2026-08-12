import { nanoid } from "nanoid";
import type { MapNode, RouteMap, Tier } from "./types.js";

const TOTAL_STEPS = 15; // matches the completed Godot prototype (doc: "scrollable 15-step map")

/**
 * Tier pacing: easier questions low on the map, harder near the top.
 * This is a design assumption (doc section 12 leaves this open) — tune
 * TIER_BANDS to change the curve. Each band is [min inclusive, max inclusive]
 * step range mapped to a weighted tier pool.
 */
const TIER_BANDS: { max: number; pool: Tier[] }[] = [
  { max: 4, pool: ["T5", "T5", "T4"] },
  { max: 8, pool: ["T4", "T3", "T3"] },
  { max: 11, pool: ["T3", "T2", "T2"] },
  { max: TOTAL_STEPS, pool: ["T2", "T1", "T1"] },
];

function tierForStep(step: number): Tier {
  const band = TIER_BANDS.find((b) => step <= b.max) ?? TIER_BANDS[TIER_BANDS.length - 1];
  return band.pool[Math.floor(Math.random() * band.pool.length)];
}

function makeChoiceTriple(step: number): MapNode[] {
  return [0, 1, 2].map((slot) => ({
    id: nanoid(8),
    step,
    slot,
    tier: tierForStep(step),
    status: "available",
    questionId: null,
  }));
}

export function generateRouteMap(): RouteMap {
  const start: MapNode = {
    id: "START",
    step: 0,
    slot: 0,
    tier: null,
    status: "selected",
    questionId: null,
  };
  const firstChoices = makeChoiceTriple(1);
  return {
    steps: TOTAL_STEPS,
    nodes: [start, ...firstChoices],
    selectedPath: ["START"],
    currentStep: 0,
  };
}

/** Legal next nodes = the three unresolved choices at currentStep + 1. */
export function legalNextNodeIds(map: RouteMap): string[] {
  const nextStep = map.currentStep + 1;
  return map.nodes.filter((n) => n.step === nextStep && n.status === "available").map((n) => n.id);
}

/**
 * Resolve a route choice: mark the chosen node selected, siblings rejected,
 * advance currentStep, and (unless the map is finished) generate the next
 * triple of choices above it.
 */
export function chooseRoute(map: RouteMap, nodeId: string): RouteMap {
  const chosen = map.nodes.find((n) => n.id === nodeId);
  if (!chosen || chosen.status !== "available") return map;

  const siblings = map.nodes.filter((n) => n.step === chosen.step && n.id !== chosen.id);
  const updatedNodes = map.nodes.map((n) => {
    if (n.id === chosen.id) return { ...n, status: "selected" as const };
    if (siblings.some((s) => s.id === n.id)) return { ...n, status: "rejected" as const };
    return n;
  });

  const newStep = chosen.step;
  const selectedPath = [...map.selectedPath, chosen.id];

  let nextNodes = updatedNodes;
  if (newStep < map.steps) {
    nextNodes = [...updatedNodes, ...makeChoiceTriple(newStep + 1)];
  }

  return {
    ...map,
    nodes: nextNodes,
    selectedPath,
    currentStep: newStep,
  };
}

export function markNodeCompleted(map: RouteMap, nodeId: string): RouteMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => (n.id === nodeId ? { ...n, status: "completed" as const } : n)),
  };
}
