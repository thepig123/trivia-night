import { useState } from "react";
import type { CSSProperties } from "react";
import RouteMap from "../components/RouteMap";
import { useGameSocket } from "../lib/ws";
import type { Team } from "../types";

export default function Tv() {
  const { connected, publicState, lastError, send } = useGameSocket("tv");
  const [roomInput, setRoomInput] = useState("");

  if (!publicState) {
    return (
      <main className="tv-connect">
        <h1 className="brand">TRIVIA NIGHT</h1>
        <p className="brand-sub">TV / Felles spillskjerm</p>
        <div className="panel">
          {lastError && <div className="error-banner">{lastError}</div>}
          <div className="field">
            <label>Romkode</label>
            <input value={roomInput} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} maxLength={6} placeholder="ABCDE" />
          </div>
          <button className="btn teal" disabled={!connected || !roomInput.trim()} onClick={() => send({ type: "tv:hello", roomCode: roomInput.trim() })}>
            Koble til spillet
          </button>
        </div>
      </main>
    );
  }

  const showQuestion = ["reading", "buzzing"].includes(publicState.phase) && publicState.activeQuestionPublic;

  return (
    <main className="tv-screen">
      <header className="tv-header">
        <h1>TRIVIA NIGHT</h1>
        {publicState.phase === "lobby" && <span>ROM {publicState.roomCode}</span>}
      </header>

      <div className="tv-stage">
        <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} rowsAhead={6} />
        {showQuestion && (
          <section className="tv-question" aria-label="Aktivt spørsmål">
            <p>{publicState.activeQuestionPublic!.prompt}</p>
          </section>
        )}
      </div>

      <section className="tv-scoreboard" aria-label="Lag og poeng">
        {publicState.teams.map((team) => (
          <TeamBanner
            key={team.id}
            team={team}
            targetScore={publicState.targetScore}
            isResponder={publicState.currentResponderId === team.id}
            isLocked={publicState.lockedOutTeamIds.includes(team.id)}
          />
        ))}
      </section>
    </main>
  );
}

function TeamBanner({ team, targetScore, isResponder, isLocked }: { team: Team; targetScore: number; isResponder: boolean; isLocked: boolean }) {
  const status = team.qualifiedForFinal ? "FINALIST" : isResponder ? "SVARER" : isLocked ? "UTELÅST" : `${Math.max(0, targetScore - team.score).toLocaleString("nb-NO")} TIL FINALEN`;
  return (
    <article className={`tv-team ${isResponder ? "tv-team--active" : ""} ${isLocked ? "tv-team--locked" : ""}`} style={{ "--team-color": team.color } as CSSProperties}>
      <h2>{team.name}</h2>
      <strong>{team.score.toLocaleString("nb-NO")}</strong>
      <span>{status}</span>
    </article>
  );
}
