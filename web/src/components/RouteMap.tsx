import type { MapNode, RouteMap as RouteMapState, Tier } from "../types";
import { TIER_POINTS } from "../types";

const TIER_GLYPHS: Record<Tier, string> = {
  T1: "♛",
  T2: "⚔",
  T3: "◆",
  T4: "⬟",
  T5: "✦",
};

interface RouteMapProps {
  map: RouteMapState;
  legalNodeIds?: string[];
  interactive?: boolean;
  onChoose?: (nodeId: string) => void;
  rowsAhead?: number;
}

export default function RouteMap({ map, legalNodeIds = [], interactive = false, onChoose, rowsAhead = 3 }: RouteMapProps) {
  const firstStep = Math.max(0, map.currentStep - 1);
  const lastStep = Math.min(map.steps, map.currentStep + rowsAhead);
  const visibleSteps = Array.from({ length: lastStep - firstStep + 1 }, (_, index) => lastStep - index);
  const visibleNodes = map.nodes.filter((node) => node.step >= firstStep && node.step <= lastStep);
  const rowY = (step: number) => 35 + (lastStep - step) * 88;
  const nodeX = (slot: number) => slot * 100 + 50;

  return (
    <section className="route-map" aria-label="Route map">
      <div className="route-map__mist" />
      <div className="route-map__summit">FINAL</div>
      <svg className="route-map__connections" viewBox={`0 0 300 ${visibleSteps.length * 88}`} preserveAspectRatio="none" aria-hidden="true">
        {visibleNodes.flatMap((node) => node.nextNodeIds.map((targetId) => {
          const target = visibleNodes.find((candidate) => candidate.id === targetId);
          if (!target) return null;
          const chosen = map.selectedPath.includes(node.id) && map.selectedPath.includes(target.id);
          return <line key={`${node.id}-${targetId}`} x1={nodeX(node.slot)} y1={rowY(node.step)} x2={nodeX(target.slot)} y2={rowY(target.step)} className={chosen ? "route-line route-line--chosen" : "route-line"} />;
        }))}
      </svg>
      <div className="route-map__rows">
        {visibleSteps.map((step) => {
          const nodes = map.nodes.filter((node) => node.step === step);
          return (
            <div className="route-map__row" key={step}>
              {nodes.map((node) => (
                <MapNodeButton
                  key={node.id}
                  node={node}
                  legal={legalNodeIds.includes(node.id)}
                  interactive={interactive}
                  onChoose={onChoose}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MapNodeButton({
  node,
  legal,
  interactive,
  onChoose,
}: {
  node: MapNode;
  legal: boolean;
  interactive: boolean;
  onChoose?: (nodeId: string) => void;
}) {
  if (node.id === "START") {
    return <div className="map-node map-node--start">START</div>;
  }

  const tier = node.tier!;
  const enabled = interactive && legal;
  return (
    <button
      type="button"
      className={`map-node map-node--${node.status} map-node--${tier.toLowerCase()} ${legal ? "map-node--legal" : ""}`}
      disabled={!enabled}
      onClick={() => enabled && onChoose?.(node.id)}
      aria-label={`${node.category}, ${tier}, ${TIER_POINTS[tier]} points${enabled ? ", choose route" : ""}`}
    >
      <span className="map-node__category">{node.category}</span>
      <span className="map-node__tier"><b>{TIER_GLYPHS[tier]}</b> {tier}</span>
    </button>
  );
}

export function TierLegend({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`tier-legend ${compact ? "tier-legend--compact" : ""}`} aria-label="Tier values">
      <h3>Poengtabell</h3>
      {(Object.keys(TIER_POINTS) as Tier[]).map((tier) => (
        <div className={`tier-legend__row tier-legend__row--${tier.toLowerCase()}`} key={tier}>
          <span className="tier-legend__icon" aria-hidden="true">{TIER_GLYPHS[tier]}</span>
          <strong>{tier}</strong>
          <span>{TIER_POINTS[tier]}</span>
        </div>
      ))}
    </aside>
  );
}
