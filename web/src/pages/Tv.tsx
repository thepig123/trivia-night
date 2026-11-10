import {StatisticsHighlights} from "../components/StatisticsPanel";
import WelcomeLobby from "../components/WelcomeLobby";
import PauseOverlay from "../components/PauseOverlay";
import { useState, useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { useAnswerCue } from "../lib/answerCue";
import PlayoffSummary from "../components/PlayoffSummary";
import RouteMap from "../components/RouteMap";
import { useGameSocket } from "../lib/ws";
import type { PublicGameState, Team } from "../types";

type PublicQuestion = NonNullable<PublicGameState["activeQuestionPublic"]>;

export default function Tv() {
  const { connected, publicState, lastError, send } = useGameSocket("tv");
  const stage=useRef<HTMLDivElement>(null),resumeMedia=useRef<Set<HTMLMediaElement>>(new Set());
  useEffect(()=>{
    if(publicState?.paused){for(const element of stage.current?.querySelectorAll<HTMLMediaElement>("audio,video")??[]){if(!element.paused)resumeMedia.current.add(element);element.pause();}}
    else {for(const element of resumeMedia.current)if(element.isConnected)void element.play().catch(()=>{});resumeMedia.current.clear();}
  },[publicState?.paused]);
  const [roomInput, setRoomInput] = useState("");
  const cue=useAnswerCue(publicState?.questionClock.warningId,publicState?.feedback);

  const [visibleFeedback,setVisibleFeedback]=useState<string|null>(null);
  useEffect(()=>{const feedback=publicState?.feedback;if(!feedback || Date.now()-feedback.createdAt>4000){setVisibleFeedback(null);return;}setVisibleFeedback(feedback.id);const timer=window.setTimeout(()=>setVisibleFeedback(null),Math.max(0,4000-(Date.now()-feedback.createdAt)));return ()=>window.clearTimeout(timer);},[publicState?.feedback?.id]);

  if (!publicState) {
    return (
      <main className="tv-connect">
        <h1 className="brand">quiz med gutta</h1>
        <p className="brand-sub">TV / Felles spillskjerm</p>
        <div className="panel">
          {lastError && <div className="error-banner">{lastError}</div>}
          <div className="field">
            <label>Romkode</label>
            <input value={roomInput} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} maxLength={6} placeholder="ABCDE" />
          </div>
          <button className="btn teal" disabled={!connected || !roomInput.trim()} onClick={() => {void cue.enable();send({ type: "tv:hello", roomCode: roomInput.trim() });}}>
            Koble til spillet
          </button>
        </div>
      </main>
    );
  }

  const questionPhase = publicState.phase === "final" ? publicState.finalState?.roundPhase : publicState.phase === "playoff" ? publicState.playoffState?.roundPhase : publicState.phase;
  const showQuestionCard = ["reading", "buzzing", "adjudicating", "dead_question"].includes(questionPhase ?? "") && publicState.activeQuestionPublic;

  return (
    <main className={`tv-screen ${publicState.phase==="lobby"?"tv-screen--lobby":""}`}>
      <PauseOverlay paused={publicState.paused}/>
      {!connected && <div role="status" className="error-banner">Mistet forbindelsen. Kobler til igjen…</div>}
      {lastError && <div role="alert" className="error-banner">{lastError}</div>}
      <header className="tv-header">
        <h1>{publicState.lobby.title}</h1>
        {!cue.enabled && <button className="btn ghost" style={{width:"auto"}} onClick={()=>void cue.enable()}>Aktiver lydsignal</button>}
        {cue.enabled && <label className="tv-volume">Lyd <input aria-label="Volum for spillsignaler" type="range" min="0" max="1" step="0.05" value={cue.volume} onChange={e=>cue.setVolume(Number(e.target.value))}/><span>{Math.round(cue.volume*100)}%</span></label>}
        {publicState.phase === "lobby" && <span>ROM {publicState.roomCode}</span>}
      </header>

      <div className="tv-stage" ref={stage}>
        {publicState.phase === "lobby" ? <WelcomeLobby state={publicState} origin={window.location.origin}/> : publicState.phase === "ended" ? <section className="tv-results tv-results--winner"><h2>🏆 {publicState.finalState!.winnerIds.length>1?"Delt seier":"Vinner"}</h2><h1>{publicState.finalState!.winnerIds.map(id=>publicState.teams.find(t=>t.id===id)?.name).join(" og ")}</h1><p>{publicState.finalState!.resultNote}</p><div className="tv-final-scores">{publicState.finalState!.finalists.map(id=><div key={id}><span>{publicState.teams.find(t=>t.id===id)?.name}</span><strong>{publicState.finalState!.scores[id].toLocaleString("nb-NO")} finale-poeng</strong></div>)}</div>{publicState.statistics&&<StatisticsHighlights statistics={publicState.statistics} teams={publicState.teams}/>}</section> : publicState.phase === "playoff" ? <PlayoffSummary state={publicState}/> : publicState.phase === "qualification" ? <section className="tv-results"><h2>Omspill om finaleplassen</h2><p>Verten avgjør hvem som går videre.</p></section> : publicState.phase === "final" ? <div className="tv-final-title">{publicState.finalState?.suddenDeath?"OMSPILL":"FINALE"}</div> : <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} rowsAhead={6} />}
        {publicState.revealedQuestion && <section className="tv-question" aria-label="Fasit"><div className="tv-question__content"><p>{publicState.revealedQuestion.prompt}</p><p><b>{publicState.revealedQuestion.answer}</b></p>{publicState.revealedQuestion.results?.length ? <table className="tv-answer-results"><thead><tr><th>Lag</th><th>Svar</th><th>Resultat</th></tr></thead><tbody>{publicState.revealedQuestion.results.map(row=><tr key={row.teamId} className={row.correct ? "tv-answer-results--correct" : ""}><td>{publicState.teams.find(t=>t.id===row.teamId)?.name}</td><td>{row.answer}</td><td>{row.correct ? "✓" : "–"}{row.distance!==undefined ? ` · ${row.distance.toLocaleString("nb-NO",{maximumFractionDigits:6})} unna` : ""}</td></tr>)}</tbody></table> : null}{publicState.revealedQuestion.media?.type === "image" && <img className="tv-question__image" src={publicState.revealedQuestion.media.url} alt="Fasitbilde"/>}{publicState.revealedQuestion.media?.type === "audio" && <audio controls src={publicState.revealedQuestion.media.url}/>}</div></section>}
        {!publicState.revealedQuestion && !publicState.questionCardDismissed && showQuestionCard && (
          <section className="tv-question" aria-label="Aktivt spørsmål">
            <div><QuestionContent key={publicState.activeNodeId} question={publicState.activeQuestionPublic!} imageRevealStage={publicState.imageRevealStage} paused={publicState.paused || questionPhase === "adjudicating"} /></div>
          </section>
        )}
      </div>

      {visibleFeedback && publicState.feedback?.id===visibleFeedback && <aside role="status" className={`tv-feedback tv-feedback--${publicState.feedback.kind}`}><h2>{publicState.feedback.label}</h2><p>{publicState.feedback.teamIds.map(id=>publicState.teams.find(t=>t.id===id)?.name).join(" · ")}</p>{publicState.feedback.points!==undefined && <strong>{publicState.feedback.points>0?"+":""}{publicState.feedback.points} poeng{publicState.feedback.teamIds.length>1 ? " hver" : ""}</strong>}</aside>}
      {publicState.phase!=="lobby" && <section className="tv-scoreboard" aria-label="Lag og poeng">
        {publicState.teams.map((team) => (
          <TeamBanner
            key={team.id}
            team={publicState.finalState?.finalists.includes(team.id) ? {...team,score:publicState.finalState.scores[team.id]} : team}
            targetScore={publicState.targetScore}
            scoreText={publicState.phase === "playoff" ? publicState.teams.find(t=>t.id===team.id)?.qualifiedForFinal ? "✓" : String((publicState.playoffState?.scores[team.id]??0)+(publicState.playoffState?.headStarts?.[team.id]??0)) : undefined}
            statusText={publicState.phase === "playoff" ? team.qualifiedForFinal ? "FØRSTE FINALIST" : publicState.playoffState?.contenders.includes(team.id) ? `KVALIFISERING · +${publicState.playoffState?.headStarts?.[team.id]??0} FORSPRANG` : "UTE AV OMSPILLET" : undefined}
            isResponder={publicState.currentResponderId === team.id}
            isLocked={publicState.lockedOutTeamIds.includes(team.id)}
          />
        ))}
      </section>}
    </main>
  );
}

function QuestionContent({ question, paused, imageRevealStage }: { question: PublicQuestion; paused: boolean; imageRevealStage:number }) {
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
      {media?.type === "image" && media.url && <img className={`tv-question__image tv-question__image--${media.effect ?? "none"}`} style={question.progressiveImage ? {filter:`blur(${[18,10,4,0][imageRevealStage]??0}px)`,transition:"filter .6s ease"} : undefined} src={media.url} alt="Visuell ledetråd" />}
      {media?.type === "video" && media.url && <video ref={video} className="tv-question__video" src={media.url} autoPlay controls />}
      {media && !media.url && <div className="tv-question__placeholder">MEDIEPLASSHOLDER</div>}
    </div>
  );
}

function TeamBanner({ team, targetScore, isResponder, isLocked, scoreText, statusText }: { team: Team; targetScore: number; isResponder: boolean; isLocked: boolean; scoreText?:string; statusText?:string }) {
  const status = team.qualifiedForFinal ? "FINALIST" : isResponder ? "SVARER" : isLocked ? "UTELÅST" : `${Math.max(0, targetScore - team.score).toLocaleString("nb-NO")} TIL FINALEN`;
  return (
    <article className={`tv-team ${isResponder ? "tv-team--active" : ""} ${isLocked ? "tv-team--locked" : ""} ${team.photoDataUrl ? "tv-team--photo" : ""}`} style={{ "--team-color": team.color, "--team-photo": team.photoDataUrl ? `url(${team.photoDataUrl})` : "none" } as CSSProperties}>
      <h2>{team.name}</h2>
      <strong>{scoreText??team.score.toLocaleString("nb-NO")}</strong>
      <span>{isResponder ? "SVARER" : statusText??status}</span>
    </article>
  );
}
