import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import GameClock from "../components/GameClock";
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

  const questionPhase = publicState.phase === "final" ? publicState.finalState?.roundPhase : publicState.phase;
  const showQuestionCard = ["reading", "buzzing", "adjudicating"].includes(questionPhase ?? "") && publicState.activeQuestionPublic;
  const showQuestionContent = questionPhase !== "adjudicating";

  return (
    <main className="tv-screen">
      {!connected && <div role="status" className="error-banner">Mistet forbindelsen. Kobler til igjen…</div>}
      {lastError && <div role="alert" className="error-banner">{lastError}</div>}
      <header className="tv-header">
        <h1>TRIVIA NIGHT</h1>
        {publicState.phase === "lobby" && <span>ROM {publicState.roomCode}</span>}
      </header>

      <GameClock clock={publicState.questionClock} paused={publicState.paused}/>
      <div className="tv-stage">
        {publicState.phase === "ended" ? <section className="tv-results"><h2>🏆 {publicState.finalState!.winnerIds.length>1?"Delt seier":"Vinner"}</h2><h1>{publicState.finalState!.winnerIds.map(id=>publicState.teams.find(t=>t.id===id)?.name).join(" og ")}</h1><p>{publicState.finalState!.resultNote}</p></section> : publicState.phase === "qualification" ? <section className="tv-results"><h2>Omspill om finaleplassen</h2><p>Verten avgjør hvem som går videre.</p></section> : publicState.phase === "final" ? <div className="tv-final-title">{publicState.finalState?.suddenDeath?"OMSPILL":"FINALE"}</div> : <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} rowsAhead={6} />}
        {publicState.revealedQuestion && <section className="tv-question" aria-label="Fasit"><div className="tv-question__content"><p>{publicState.revealedQuestion.prompt}</p><p><b>{publicState.revealedQuestion.answer}</b></p>{publicState.revealedQuestion.media?.type === "image" && <img className="tv-question__image" src={publicState.revealedQuestion.media.url} alt="Fasitbilde"/>}{publicState.revealedQuestion.media?.type === "audio" && <audio controls src={publicState.revealedQuestion.media.url}/>}</div></section>}
        {!publicState.revealedQuestion && showQuestionCard && (
          <section className={`tv-question ${showQuestionContent ? "" : "tv-question--blank"}`} aria-label="Aktivt spørsmål">
            <div style={{visibility:showQuestionContent?"visible":"hidden"}}><QuestionContent key={publicState.activeNodeId} question={publicState.activeQuestionPublic!} paused={publicState.paused || !showQuestionContent} /></div>
          </section>
        )}
      </div>

      <section className="tv-scoreboard" aria-label="Lag og poeng">
        {publicState.teams.map((team) => (
          <TeamBanner
            key={team.id}
            team={publicState.finalState?.finalists.includes(team.id) ? {...team,score:publicState.finalState.scores[team.id]} : team}
            targetScore={publicState.targetScore}
            isResponder={publicState.currentResponderId === team.id}
            isLocked={publicState.lockedOutTeamIds.includes(team.id)}
          />
        ))}
      </section>
    </main>
  );
}

function QuestionContent({ question, paused }: { question: PublicQuestion; paused: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    for (const media of [audio.current, video.current]) {
      if (!media) continue;
      if (paused) media.pause(); else void media.play().catch(() => { /* Browser may require the TV operator to press Play. */ });
    }
  }, [paused, question.media?.url]);
  const media = question.media;
  return (
    <div className="tv-question__content">
      {question.prompt && <p>{question.prompt}</p>}
      {media?.type === "audio" && media.url && <audio ref={audio} className="tv-question__audio" src={media.url} autoPlay controls />}
      {media?.type === "image" && media.url && <img className={`tv-question__image tv-question__image--${media.effect ?? "none"}`} src={media.url} alt="Visuell ledetråd" />}
      {media?.type === "video" && media.url && <video ref={video} className="tv-question__video" src={media.url} autoPlay controls />}
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
