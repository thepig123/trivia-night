import { useState } from "react";
import type { CSSProperties } from "react";
import RouteMap from "../components/RouteMap";
import { useGameSocket } from "../lib/ws";
import type { PublicGameState, Team } from "../types";

type PublicQuestion = NonNullable<PublicGameState["activeQuestionPublic"]>;

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

  const showQuestionCard = ["reading", "buzzing", "adjudicating"].includes(publicState.phase) && publicState.activeQuestionPublic;
  const showQuestionContent = publicState.phase !== "adjudicating";

  return (
    <main className="tv-screen">
      <header className="tv-header">
        <h1>TRIVIA NIGHT</h1>
        {publicState.phase === "lobby" && <span>ROM {publicState.roomCode}</span>}
      </header>

      <div className="tv-stage">
        <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} rowsAhead={6} />
        {showQuestionCard && (
          <section className={`tv-question ${showQuestionContent ? "" : "tv-question--blank"}`} aria-label="Aktivt spørsmål">
            {showQuestionContent && <QuestionContent question={publicState.activeQuestionPublic!} />}
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

function QuestionContent({ question }: { question: PublicQuestion }) {
  const media = question.media;
  return (
    <div className="tv-question__content">
      {question.prompt && <p>{question.prompt}</p>}
      {media?.type === "audio" && media.url && <audio className="tv-question__audio" src={media.url} autoPlay controls />}
      {media?.type === "image" && media.url && <img className={`tv-question__image tv-question__image--${media.effect ?? "none"}`} src={media.url} alt="Visuell ledetråd" />}
      {media?.type === "video" && media.url && <video className="tv-question__video" src={media.url} autoPlay controls />}
      {media && !media.url && <div className="tv-question__placeholder">MEDIEPLASSHOLDER</div>}
    </div>
  );
}

function TeamBanner({ team, targetScore, isResponder, isLocked }: { team: Team; targetScore: number; isResponder: boolean; isLocked: boolean }) {
  const status = team.qualifiedForFinal ? "FINALIST" : isResponder ? "SVARER" : isLocked ? "UTELÅST" : `${Math.max(0, targetScore - team.score).toLocaleString("nb-NO")} TIL FINALEN`;
  return (
    <article className={`tv-team ${isResponder ? "tv-team--active" : ""} ${isLocked ? "tv-team--locked" : ""} ${team.photoDataUrl ? "tv-team--photo" : ""}`} style={{ "--team-color": team.color, "--team-photo": team.photoDataUrl ? `url(${team.photoDataUrl})` : "none" } as CSSProperties}>
      <h2>{team.name}</h2>
      <strong>{team.score.toLocaleString("nb-NO")}</strong>
      <span>{status}</span>
    </article>
  );
}
