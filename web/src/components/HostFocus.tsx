import React, { useEffect, useState } from "react";
import type { HostGameState, ClientMessage } from "../types";

export default function HostFocus({state, connected, send}: {state:HostGameState; connected:boolean; send:(message:ClientMessage)=>void}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(timer);},[]);
  const rc=(type:ClientMessage["type"], extra:object={})=>send({type,roomCode:state.roomCode,...extra} as ClientMessage);
  const phase=state.phase === "final" ? state.finalState!.roundPhase : state.phase === "playoff" ? state.playoffState!.roundPhase : state.phase;
  const responder=state.teams.find(t=>t.id===state.currentResponderId);
  const controller=state.teams.find(t=>t.id===state.controllingTeamId);
  const privateRound=["private_choice","friend_group","closest"].includes(state.activeQuestion?.mode ?? "");
  const disabled=!connected || state.paused;
  const minutes=state.startedAt ? Math.floor((now-state.startedAt)/60000) : 0;
  return <section className="card host-focus" aria-label="Neste handling">
    <div className="host-focus__meta"><span>{state.eventMode ? "SPILLKVELD" : "ØVING"}</span><span>{minutes} min siden start · {state.questionsPlayed} avsluttede spørsmål{state.questionsPlayed>0 && state.startedAt ? ` · ca. ${Math.round((now-state.startedAt!)/1000/state.questionsPlayed)} sek/spørsmål inkl. pauser` : ""}</span></div>
    <h2>{!connected ? "Venter på forbindelse" : state.paused ? "Spillet er satt på pause" : phase === "route_choice" ? `${controller?.name ?? "Verten"} velger rute` : phase === "adjudicating" ? `${responder?.name ?? "Laget"} svarer` : phase === "buzzing" ? privateRound ? "Venter på lagenes svar" : "Buzzerne er åpne" : phase === "ended" ? "Kvelden er avgjort!" : phase === "qualification" ? "Velg finalistene nedenfor" : phase === "reading" ? "Les spørsmålet – åpne svar når dere er klare" : phase === "resolved" ? state.phase === "playoff" ? "Kvalifisering · neste spørsmål / avgjør andreplassen" : "Klar for neste finalespørsmål" : "Klar for neste spørsmål"}</h2>
    <div className="control-row">
      {state.paused ? <button className="btn teal" disabled={!connected} onClick={()=>rc("host:resume")}>Fortsett spillet</button> : <>
        {["lobby","map","ready"].includes(phase) && <button className="btn teal" disabled={disabled || (phase==="lobby" && state.teams.filter(t=>t.connected).length<2)} onClick={()=>rc("host:start_reading")}>{phase==="lobby" ? "Start første spørsmål" : "Les neste spørsmål"}</button>}
        {phase==="reading" && <button className="btn teal" disabled={disabled} onClick={()=>rc("host:open_buzzers")}>Åpne svar</button>}
        {phase==="adjudicating" && responder && <><button className="btn teal" disabled={disabled} onClick={()=>rc("host:mark_correct",{teamId:responder.id})}>Riktig</button><button className="btn coral" disabled={disabled} onClick={()=>rc("host:mark_wrong",{teamId:responder.id})}>Feil</button></>}
        {phase==="buzzing" && privateRound && <button className="btn teal" disabled={disabled} onClick={()=>rc("host:reveal_friend_answers")}>Avslør svar · {Object.keys(state.friendAnswers).length} levert</button>}
        {phase==="dead_question" && <button className="btn teal" disabled={disabled} onClick={()=>rc(state.canDismissQuestionCard ? "host:skip_question" : "host:reveal_question")}>{state.canDismissQuestionCard ? "Gå videre" : "Vis fasit"}</button>}
        {phase==="resolved" && state.phase==="playoff" && <button className="btn teal" disabled={disabled} onClick={()=>rc("host:advance_playoff")}>Neste / avgjør kvalifiseringen</button>}
        {phase==="resolved" && state.phase==="final" && <button className="btn teal" disabled={disabled} onClick={()=>rc("host:advance_final")}>Neste / avgjør finalen</button>}
      </>}
      {!state.paused && state.phase!=="ended" && <button className="btn ghost" disabled={!connected} onClick={()=>rc("host:pause")}>Pause</button>}
      {state.activeQuestion?.progressiveImage && ["reading","buzzing"].includes(phase) && <button className="btn ghost" disabled={disabled || state.imageRevealStage>=3} onClick={()=>rc("host:advance_image")}>Avslør mer av bildet · {state.imageRevealStage+1}/4</button>}
      {state.canRevealQuestion && phase!=="dead_question" && <button className="btn ghost" disabled={!connected} onClick={()=>rc(state.canDismissQuestionCard ? "host:dismiss_question_card" : "host:reveal_question")}>{state.canDismissQuestionCard ? state.phase==="playoff" ? "Vis kvalifisering" : state.phase==="final" ? "Vis finale" : "Vis kart" : "Vis fasit"}</button>}
    </div>
    {phase==="lobby" && state.teams.filter(t=>t.connected).length<2 && <p>Minst to tilkoblede lag må være klare før start.</p>}
  </section>;
}
