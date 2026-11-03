import HostFocus from "../components/HostFocus";
import { questionPoints, isGutta } from "../types";
import { useEffect, useState, useRef } from "react";
import { localTestingHost, testControllerUrl } from "../lib/testControllers";
import { useGameSocket } from "../lib/ws";
import { TierLegend } from "../components/RouteMap";

export default function Host() {
  const { connected, hostState, roomCode, send, lastError, testControllers, events } = useGameSocket("host");
  const pendingController=useRef<Window|null>(null);
  useEffect(()=>{
    if(testControllers.length && pendingController.current){pendingController.current.location.replace(testControllerUrl(testControllers,window.location.origin));pendingController.current=null;}
  },[testControllers]);
  useEffect(()=>{if(lastError && pendingController.current){pendingController.current.close();pendingController.current=null;}},[lastError]);
  const [created, setCreated] = useState(false);
  const [editorKey,setEditorKey]=useState(()=>sessionStorage.getItem("trivia-bank-key")??"");

  useEffect(() => {
    setCreated(!!roomCode);
  }, [roomCode]);

  if (!created || !hostState) {
    return (
      <div className="screen" style={{ justifyContent: "center" }}>
        <h1 className="brand" style={{ fontSize: "2.2rem" }}>
          Vertspanel
        </h1>
        <p className="brand-sub">{connected ? "Tilkoblet serveren" : "Kobler til…"}</p>
        {lastError && <div className="error-banner">{lastError}</div>}
        <div className="panel">
          <a className="btn ghost" href="/questions">Åpne spørsmålsbanken</a>
          <label className="field">Redaktørnøkkel<input type="password" value={editorKey} onChange={e=>setEditorKey(e.target.value)} autoComplete="off" placeholder="Fra serverterminalen"/></label>
          <button className="btn violet" disabled={!connected || !editorKey} onClick={() => {sessionStorage.setItem("trivia-bank-key",editorKey);send({ type: "host:create_room", adminKey:editorKey });}}>
            Opprett nytt øvingsrom
          </button>
          <button className="btn teal" disabled={!connected || !editorKey} onClick={()=>{sessionStorage.setItem("trivia-bank-key",editorKey);send({type:"host:create_room",adminKey:editorKey,eventMode:true});}}>Start spillkveld · automatisk lagring</button>
         <p>Øving starter på nytt ved serverstart. Spillkvelder lagres og kan gjenopprettes.</p>
         <button className="btn ghost" disabled={!connected || !editorKey} onClick={()=>send({type:"host:list_events",adminKey:editorKey})}>Finn lagrede spillkvelder</button>
         {events.map(event=><div className="card" key={event.roomCode}><b>{event.roomCode} · {event.phase}</b><p>{event.teams.join(" · ") || "Ingen lag ennå"}</p><button className="btn teal" disabled={!connected} onClick={()=>send({type:"host:recover_event",adminKey:editorKey,roomCode:event.roomCode})}>Gjenopprett i pause</button></div>)}
         {localTestingHost(window.location.hostname) && <button className="btn ghost" disabled={!connected||!editorKey} onClick={()=>{
            pendingController.current=window.open("about:blank","trivia-test-controller");
            sessionStorage.setItem("trivia-bank-key",editorKey);
            send({type:"host:create_room",adminKey:editorKey,testMode:true});
          }}>Opprett testrom · 4 lag + kontroller</button>}
        </div>
      </div>
    );
  }

  return <AdminPanel state={hostState} roomCode={roomCode!} send={send} connected={connected} lastError={lastError} testControllers={testControllers} />;
}

function AdminPanel({ state, roomCode, send, connected, lastError, testControllers }: any) {
  const rc = (type: string, extra: object = {}) => send({ type, roomCode, ...extra });
  const activeNode = state.map.nodes.find((n: any) => n.id === state.activeNodeId);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        {state.isTestRoom && <div className="card"><b>Lokalt testrom · 4 lag</b><p>Én kontroller kan bytte mellom alle testlagene.</p>{testControllers.length>0&&<a href={testControllerUrl(testControllers,window.location.origin)} target="trivia-test-controller">Åpne testkontroller ↗</a>}</div>}
        {state.eventMode && <div className="bank-notice">Spillkveld · automatisk lagring aktiv</div>}
        <a href="/questions" target="_blank" rel="noreferrer">Spørsmålsbank ↗</a>
        <div>
          <div style={{ fontSize: "0.7rem", opacity: 0.6, textAlign: "center" }}>ROMKODE</div>
          <div className="room-code">{roomCode}</div>
        </div>

        <div className="card team-overview">
          <div className="team-overview__heading"><h3>Lag</h3><span>{state.teams.length}/5</span></div>
          {state.teams.length === 0 && <div className="empty-teams">Venter på lag. Én spiller fra hvert lag blir med via <b>/join</b>.</div>}
          {state.teams.map((t: any) => (
            <div className="team-row" key={t.id} style={{flexWrap:"wrap"}}>
              <span className="team-overview__identity"><span className="team-dot" style={{ background: t.color }} /><span><b>{t.name}</b><small>{t.players?.filter(Boolean).join(" & ")}</small></span>{!t.connected && " ⚠️"}{t.qualifiedForFinal && " 🏆"}</span>
              <span className="team-overview__score">
                <b>{(state.finalState?.scores[t.id] ?? t.score).toLocaleString()}</b>
                <button className="btn ghost" style={{ width: "auto", padding: "2px 8px" }} onClick={() => rc("host:adjust_score", { teamId: t.id, delta: -100 })}>
                  -
                </button>
                <button className="btn ghost" style={{ width: "auto", padding: "2px 8px" }} onClick={() => rc("host:adjust_score", { teamId: t.id, delta: 100 })}>
                  +
                </button>
              </span>
              {state.phase === "lobby" && <TeamLobbyControls team={t} disabled={!connected} send={send} roomCode={roomCode}/>}
            </div>
          ))}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Fremdrift</h3>
          <div style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            Etappe: {state.map.currentStep}
            <br />
            Poengmål: {state.targetScore.toLocaleString()}
            <br />
            Spørsmål igjen: {state.questionPoolRemaining} / {state.questionPoolTotal}
          </div>
        </div>

        <TierLegend />

        <div className="target-control">
          <span>Poengmål for finale</span><strong>{state.targetScore.toLocaleString()}</strong>
          <div><button disabled={!connected || state.targetScore<=1000 || !["lobby","map","route_choice"].includes(state.phase)} onClick={() => rc("host:set_target", { targetScore: state.targetScore - 500 })}>−500</button><button disabled={!connected || state.targetScore>=20000 || !["lobby","map","route_choice"].includes(state.phase)} onClick={() => rc("host:set_target", { targetScore: state.targetScore + 500 })}>+500</button></div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Hendelseslogg</h3>
          <ul className="log-list">
            {[...state.eventLog].reverse().map((e: any) => (
              <li key={e.id}>{e.message}</li>
            ))}
          </ul>
        </div>

        {state.canUndo && <button className="btn ghost" disabled={!connected} onClick={()=>rc("host:undo")}>Angre: {state.undoLabel}</button>}
        {state.canReplaceQuestion && <button className="btn ghost" disabled={!connected} onClick={()=>rc("host:replace_question")}>Bytt aktivt spørsmål</button>}
        <button className="btn ghost" onClick={() => rc(state.paused ? "host:resume" : "host:pause")}>
          {state.paused ? "Fortsett spillet" : "Sett på pause"}
        </button>
      </aside>

      <main className="admin-main">
        {!connected && <div role="status" className="error-banner">Mistet forbindelsen. Venter på serveren…</div>}
        {lastError && <div role="alert" className="error-banner">{lastError}</div>}
        {state.paused && <div role="status" className="error-banner"><p>Spillet er satt på pause. Trykk Fortsett spillet for å åpne spillerkontrollene igjen.</p><button className="btn teal" disabled={!connected} onClick={() => rc("host:resume")}>Fortsett spillet</button></div>}
        <HostFocus state={state} connected={connected} send={send}/>
        {state.phase === "route_choice" && <div className="card"><h3>Verten kan velge rute</h3><p>Bruk dette hvis laget trenger hjelp eller har mistet forbindelsen.</p><div className="control-row">{state.legalNextNodeIds.map((id: string) => {const node=state.map.nodes.find((n: any)=>n.id===id);return <button key={id} disabled={!connected||state.paused} onClick={()=>rc("host:choose_route",{nodeId:id})}>{node.category} · {questionPoints(node)} poeng</button>;})}</div></div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Fase: <span style={{ color: "var(--teal)" }}>{state.phase}</span>
          </h2>
          {state.paused && <span className="chip" style={{ background: "var(--coral)" }}>PAUSE</span>}
        </div>

        {state.phase === "qualification" ? <QualificationPanel state={state} roomCode={roomCode} send={send}/> : state.finalState ? (
          <FinalPanel state={state} roomCode={roomCode} send={send} />
        ) : (
          <>
            <div className="question-box">
              {state.activeQuestion ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span className="chip" style={{ background: "var(--violet)" }}>
                      {state.activeQuestion.category}
                    </span>
                    <span className="chip" style={{ background: "var(--yellow)", color: "var(--ink)" }}>
                      {isGutta(state.activeQuestion.category) ? "Fast verdi" : activeNode?.tier} · {questionPoints(state.activeQuestion)} poeng
                    </span>
                  </div>
                  <p style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 16 }}>{state.activeQuestion.prompt}</p>
                  <div style={{ fontSize: "0.95rem", opacity: 0.9 }}>
                    <b>Svar:</b> {state.activeQuestion.answer}
                  </div>
                  {state.activeQuestion.acceptedAlternatives?.length > 0 && (
                    <div style={{ fontSize: "0.85rem", opacity: 0.7, marginTop: 4 }}>
                      Godta også: {state.activeQuestion.acceptedAlternatives.join(", ")}
                    </div>
                  )}
                  {state.activeQuestion.hostNote && (
                    <div style={{ fontSize: "0.85rem", opacity: 0.7, marginTop: 4 }}>Vertens notat: {state.activeQuestion.hostNote}</div>
                  )}
                </>
              ) : (
                <p style={{ opacity: 0.6 }}>
                  {state.phase === "lobby"
                    ? "Venter på lag. Start spillet når alle er klare."
                    : state.phase === "route_choice"
                    ? "Venter på at laget skal velge neste rute…"
                    : "Ingen aktive spørsmål."}
                </p>
              )}
            </div>

            {state.phase === "dead_question" && <p className="error-banner">Ingen lag kan svare. Vis fasit eller hopp over spørsmålet.</p>}
            <details className="card"><summary>Flere kontroller · hopp over / avslutt hovedrunde</summary><div className="control-row">
              {["map","route_choice"].includes(state.phase) && state.teams.length >= 2 && <button className="btn ghost" disabled={state.paused || !connected} onClick={()=>rc("host:finish_route")}>Avslutt hovedrunden og velg finalister</button>}
              {state.canRevealQuestion && <button className="btn teal" onClick={() => rc(state.canDismissQuestionCard ? "host:dismiss_question_card" : "host:reveal_question")}>
                {state.canDismissQuestionCard ? "Vis kart" : "Vis fasit"}
              </button>}
              {state.phase === "map" && (
                <button className="btn teal" onClick={() => rc("host:start_reading")}>
                  Les opp spørsmålet
                </button>
              )}
              {state.phase === "lobby" && (
                <button className="btn teal" onClick={() => rc("host:start_reading")}>
                  Vis første spørsmål
                </button>
              )}
              {(state.phase === "reading" || state.phase === "map") && (
                <button className="btn pink" onClick={() => rc("host:open_buzzers")}>
                  Åpne buzzere
                </button>
              )}
              {state.phase === "buzzing" && ["friend_group", "private_choice"].includes(state.activeQuestion?.mode) && <button className="btn teal" onClick={() => rc("host:reveal_friend_answers")}>Avslør svar ({Object.keys(state.friendAnswers).length}/{state.teams.filter((t: any) => !t.qualifiedForFinal).length})</button>}
              <button className="btn ghost" onClick={() => rc("host:skip_question")}>
                Hopp over spørsmål
              </button>
            </div></details>

            {state.phase === "adjudicating" && (
              <div className="card">
                <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Buzzerrekkefølge</h3>
                {state.buzzOrder.map((b: any, i: number) => {
                  const team = state.teams.find((t: any) => t.id === b.teamId);
                  const isCurrent = b.teamId === state.currentResponderId;
                  const isLocked = state.lockedOutTeamIds.includes(b.teamId);
                  return (
                    <div key={b.teamId} className="team-row">
                      <span>
                        <span className="team-dot" style={{ background: team?.color }} />
                        {i + 1}. {team?.name} {isLocked && "(utelåst)"}
                      </span>
                      {isCurrent && (
                        <span style={{ display: "flex", gap: 8 }}>
                          <button className="btn teal" style={{ width: "auto" }} onClick={() => rc("host:mark_correct", { teamId: b.teamId })}>
                            Riktig
                          </button>
                          <button className="btn coral" style={{ width: "auto" }} onClick={() => rc("host:mark_wrong", { teamId: b.teamId })}>
                            Feil
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TeamLobbyControls({team,disabled,send,roomCode}:any) {
  const [editing,setEditing]=useState(false);
  const [name,setName]=useState(team.name);
  const [players,setPlayers]=useState<string[]>(team.players);
  return <div style={{flexBasis:"100%",display:"flex",gap:6,flexWrap:"wrap"}}>{editing?<><label>Lagnavn<input maxLength={24} value={name} onChange={e=>setName(e.target.value)}/></label>{[0,1].map(index=><label key={index}>Spiller {index+1}<input maxLength={24} value={players[index]??""} onChange={e=>setPlayers(values=>[0,1].map(i=>i===index?e.target.value:values[i]))}/></label>)}<button disabled={disabled||!name.trim()||players.length!==2||players.some(p=>!p.trim())} onClick={()=>{send({type:"host:update_team",roomCode,teamId:team.id,name:name.trim(),players:players.map(p=>p.trim())});setEditing(false);}}>Lagre</button><button onClick={()=>setEditing(false)}>Avbryt</button></>:<><button disabled={disabled} onClick={()=>{setName(team.name);setPlayers(team.players);setEditing(true);}}>Rediger lag</button><button disabled={disabled} onClick={()=>send({type:"host:remove_team",roomCode,teamId:team.id})}>Fjern fra lobbyen</button></>}</div>;
}

function QualificationPanel({state,roomCode,send}: any) {
  const [selected,setSelected]=useState<string[]>(state.teams.filter((t:any)=>t.qualifiedForFinal).map((t:any)=>t.id));
  return <section className="card"><h2>Avgjør finaleplassen</h2><p>Det er likt ved finalegrensen. Gjennomfør et muntlig omspill, og velg de to finalistene. Allerede kvalifiserte lag beholder plassen.</p>{state.teams.filter((t:any)=>state.finalCandidateIds.includes(t.id)).map((t:any)=><label key={t.id} style={{display:"block",padding:12}}><input type="checkbox" checked={selected.includes(t.id)} disabled={t.qualifiedForFinal || state.paused} onChange={e=>setSelected(ids=>e.target.checked?[...ids,t.id]:ids.filter(id=>id!==t.id))}/> {t.name} · {t.score} poeng</label>)}<button className="btn teal" disabled={state.paused || selected.length!==2} onClick={()=>send({type:"host:select_finalists",roomCode,teamIds:selected})}>Start finalen med valgte lag</button></section>;
}

function FinalPanel({ state, roomCode, send }: any) {
  const final=state.finalState;
  const rc=(type:string,extra:object={})=>send({type,roomCode,...extra});
  const teamName=(id:string)=>state.teams.find((t:any)=>t.id===id)?.name??"Ukjent lag";
  if(state.phase==="ended") return <section className="card"><h2>🏆 {final.winnerIds.length>1?"Delt seier":"Vinner"}: {final.winnerIds.map(teamName).join(" og ")}</h2>{final.finalists.map((id:string)=><p key={id}>{teamName(id)}: <b>{final.scores[id]} finale-poeng</b></p>)}{final.resultNote&&<p>{final.resultNote}</p>}</section>;
  return <section className="card"><h2>🏆 {final.suddenDeath?"Omspill":"Finale"}</h2><p>{final.finalists.map(teamName).join(" mot ")} · Spørsmål {final.currentIndex+1} av {final.questionIds.length}</p><p>Separate finale-poeng. Riktig buzzer-svar gir spørsmålets verdi; feil trekker samme verdi. Privat flervalg gir poeng til alle riktige og ingen minus. Ved uavgjort trekkes nye omspillsspørsmål så lenge banken har flere.</p>
    <div className="control-row">{final.finalists.map((id:string)=><strong key={id}>{teamName(id)}: {final.scores[id]}</strong>)}</div>
    {state.activeQuestion&&<div className="question-box"><p>{state.activeQuestion.category} · {questionPoints(state.activeQuestion)} poeng</p><h3>{state.activeQuestion.prompt}</h3><p><b>Fasit:</b> {state.activeQuestion.answer}</p><p>{state.activeQuestion.hostNote}</p></div>}
    <div className="control-row">{final.roundPhase==="ready"&&<button className="btn teal" disabled={state.paused} onClick={()=>rc("host:start_reading")}>Les finalespørsmålet</button>}{final.roundPhase==="reading"&&<button className="btn pink" disabled={state.paused} onClick={()=>rc("host:open_buzzers")}>Åpne svar</button>}{final.roundPhase==="buzzing"&&["private_choice","friend_group"].includes(state.activeQuestion?.mode)&&<button className="btn teal" disabled={state.paused} onClick={()=>rc("host:reveal_friend_answers")}>Avslør private svar ({Object.keys(state.friendAnswers).length}/{final.finalists.length})</button>}{final.roundPhase==="adjudicating"&&state.currentResponderId&&<><p>{teamName(state.currentResponderId)} svarer</p><button className="btn teal" disabled={state.paused} onClick={()=>rc("host:mark_correct",{teamId:state.currentResponderId})}>Riktig</button><button className="btn coral" disabled={state.paused} onClick={()=>rc("host:mark_wrong",{teamId:state.currentResponderId})}>Feil</button></>}
    {final.roundPhase!=="resolved"&&<button className="btn ghost" disabled={state.paused} onClick={()=>rc("host:skip_question")}>Hopp over finalespørsmålet</button>}{state.canRevealQuestion&&<button className="btn ghost" onClick={()=>rc(state.canDismissQuestionCard ? "host:dismiss_question_card" : "host:reveal_question")}>{state.canDismissQuestionCard ? "Vis kart" : "Vis fasit"}</button>}{final.roundPhase==="resolved"&&<button className="btn teal" disabled={state.paused} onClick={()=>rc("host:advance_final")}>{final.currentIndex+1>=final.questionIds.length?"Avgjør finalen / trekk omspill":"Neste finalespørsmål"}</button>}</div>
  </section>;
}
