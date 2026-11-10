import React from "react";
import PlayoffSummary from "./PlayoffSummary";
import NumericAnswerPanel from "./NumericAnswerPanel";
import RouteMap, { TierLegend } from "./RouteMap";

export default function TeamController({ roomCode, teamId, publicState, send, connected, lastError, testControllers }: any) {
  const me = publicState?.teams.find((t: any) => t.id === teamId);
  const inPlayoff = publicState?.phase === "playoff" || (publicState?.phase === "qualification" && !!publicState?.playoffState);
  const isContender = publicState?.playoffState?.contenders.includes(teamId);
  const inFinal = !!publicState?.finalState;
  const isFinalist = publicState?.finalState?.finalists.includes(teamId);
  const phase = publicState?.phase === "final" ? publicState.finalState.roundPhase : publicState?.phase === "playoff" ? publicState.playoffState.roundPhase : publicState?.phase;
  const iBuzzed = publicState?.buzzOrder?.some((b: any) => b.teamId === teamId);
  const iAmLocked = publicState?.lockedOutTeamIds?.includes(teamId);
  const iAmFirst = phase === "adjudicating" && publicState?.currentResponderId === teamId;
  const canBuzz = connected && !publicState?.paused && phase === "buzzing" && (!inFinal || isFinalist) && (!inPlayoff || isContender) && (inFinal || !me?.qualifiedForFinal) && publicState?.activeQuestionPublic?.mode !== "closest" && !iBuzzed && !iAmLocked;
  const isControlling = phase === "route_choice" && publicState?.controllingTeamId === teamId;
  const isFriendRound = ["friend_group", "private_choice"].includes(publicState?.activeQuestionPublic?.mode);
  const friendSubmitted = publicState?.friendAnswersSubmitted?.includes(teamId);
  const qualified = me?.qualifiedForFinal && !inFinal;

  if(publicState && !me) return <div className="screen"><h2>Laget er fjernet fra lobbyen</h2><p>Du kan melde deg på igjen før spillet starter.</p><button className="btn teal" onClick={()=>{sessionStorage.removeItem("trivia-team-session");window.location.reload();}}>Til påmelding</button></div>;

  let buzzerClass = "buzzer";
  let buzzerLabel = "BUZZ";
  if (!connected || publicState?.paused) {
    buzzerClass += " locked";
    buzzerLabel = publicState?.paused ? "PAUSE" : "KOBLER TIL…";
  } else if (iAmFirst) {
    buzzerClass += " first";
    buzzerLabel = "DERES TUR!";
  } else if (iAmLocked || (iBuzzed && !iAmFirst) || phase !== "buzzing") {
    buzzerClass += " locked";
    if (iAmLocked) buzzerLabel = "UTELÅST";
    else if (iBuzzed) buzzerLabel = "SVART";
    else buzzerLabel = "VENT";
  }

  return (
    <div className="screen">
      {!connected && <div role="status" className="error-banner">Mistet forbindelsen. Kobler til igjen…</div>}
      {publicState?.paused && <div role="status" className="error-banner">Spillet er satt på pause. Venter på at verten fortsetter spillet.</div>}
      {lastError && <div role="alert" className="error-banner">{lastError}</div>}
      {publicState?.isTestRoom && testControllers?.length>0 && <label className="field">Styr testlag<select value={teamId} onChange={e=>{const session=testControllers.find((s:any)=>s.teamId===e.target.value);if(session)send({type:"team:resume",roomCode:session.roomCode,teamId:session.teamId,sessionToken:session.sessionToken});}}>{testControllers.map((s:any)=><option key={s.teamId} value={s.teamId}>{s.teamName}</option>)}</select></label>}
      <div style={{ width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>ROM {roomCode}</div>
          <h2 style={{ color: me?.color }}>{me?.name}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>{inPlayoff && !me?.qualifiedForFinal ? "RIKTIGE I KVALIFISERINGEN" : "POENG"}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: "var(--yellow)" }}>
            {(inPlayoff && !me?.qualifiedForFinal ? publicState.playoffState.scores[teamId] : isFinalist ? publicState.finalState.scores[teamId] : me?.score) ?? 0}
          </div>
        </div>
      </div>

      {inPlayoff && <PlayoffSummary state={publicState}/>}
      {publicState?.phase === "ended" ? <div className="qualified-card"><strong>{publicState.finalState.winnerIds.includes(teamId) ? "🏆 GRATULERER!" : "SPILLET ER FERDIG"}</strong><span>{publicState.finalState.winnerIds.map((id:string)=>publicState.teams.find((t:any)=>t.id===id)?.name).join(" og ")} vant.</span></div> : inFinal && !isFinalist ? <div className="qualified-card"><strong>FINALE</strong><span>Følg finalen på TV.</span></div> : inPlayoff && !isContender && !qualified ? <div className="qualified-card"><strong>UTE AV OMSPILLET</strong><span>Følg kampen om andreplassen på TV.</span></div> : qualified ? <div className="qualified-card"><strong>FINALIST</strong><span>Finaleplassen er sikret. Følg kampen mellom de andre lagene.</span></div> : isControlling ? (
        <div className="map-choice-wrap">
          <h3>Velg rute</h3>
          <p>{publicState.paused ? "Rutevalget fortsetter når verten opphever pausen." : !connected ? "Kobler til igjen før dere kan velge rute…" : "Velg mellom de lysende kategoriene."}</p>
          <RouteMap
            map={publicState.map}
            legalNodeIds={publicState.legalNextNodeIds}
            interactive={connected && !publicState.paused}
            onChoose={(nodeId) => send({ type: "team:choose_route", roomCode, teamId, nodeId })}
          />
          <TierLegend compact />
        </div>
      ) : publicState?.activeQuestionPublic?.mode === "closest" && phase === "buzzing" ? (
        <NumericAnswerPanel key={publicState.activeQuestionPublic.id} disabled={!connected || publicState.paused} submitted={!!friendSubmitted} onSubmit={answer=>send({type:"team:submit_friend_answer",roomCode,teamId,answer})}/>
      ) : isFriendRound && phase === "buzzing" ? (
        <div className="friend-answer-panel">
          <h3>Velg svar</h3>
          {publicState.activeQuestionPublic.choices?.map((choice: string) => <button className="btn ghost" key={choice} disabled={friendSubmitted || !connected || publicState.paused} onClick={() => send({ type: "team:submit_friend_answer", roomCode, teamId, answer: choice })}>{choice}</button>)}
          {friendSubmitted && <p>Svaret er låst. Venter på avsløringen…</p>}
        </div>
      ) : (
        <>
          {!inPlayoff && publicState?.map && <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} />}
          {phase === "route_choice" ? <div className="qualified-card"><strong>NESTE RUTE VELGES</strong><span>{publicState.teams.find((t: any) => t.id === publicState.controllingTeamId)?.name ?? "Verten"} velger veien videre.</span></div> : <div className="buzzer-wrap">
            <button
              className={buzzerClass}
              disabled={!canBuzz}
              onClick={() => send({ type: "team:buzz", roomCode, teamId })}
            >
              {buzzerLabel}
            </button>
          </div>}
        </>
      )}

      <div style={{ opacity: 0.55, fontSize: "0.8rem", marginTop: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {publicState?.paused ? "Spillet er satt på pause" : phaseLabel(phase)}
      </div>
      {me && !qualified && !inPlayoff && <div className="final-progress"><div><span>Veien til finalen</span><b>{Math.max(0, publicState.targetScore - me.score).toLocaleString()} poeng igjen</b></div><progress value={Math.max(0,me.score)} max={publicState.targetScore} /></div>}
    </div>
  );
}

function phaseLabel(phase: string | undefined) {
  switch (phase) {
    case "ready":
      return "Finalespørsmålet er klart";
    case "resolved":
      return "Venter på neste finalespørsmål";
    case "qualification":
      return "Verten avgjør finaleplassen";
    case "lobby":
      return "Venter på at verten skal starte";
    case "map":
      return "Gjør dere klare — neste spørsmål kommer";
    case "reading":
      return "Verten leser spørsmålet";
    case "buzzing":
      return "Buzzerne er åpne!";
    case "dead_question":
      return "Spørsmålet er avsluttet. Venter på verten.";
    case "adjudicating":
      return "Verten vurderer svaret";
    case "route_choice":
      return "Neste rute velges";
    case "final":
      return "Finale!";
    case "ended":
      return "Spillet er ferdig";
    default:
      return "";
  }
}
