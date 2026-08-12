import { useEffect, useState } from "react";
import { useGameSocket } from "../lib/ws";
import { TierLegend } from "../components/RouteMap";

export default function Host() {
  const { connected, hostState, roomCode, send } = useGameSocket("host");
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (roomCode) setCreated(true);
  }, [roomCode]);

  if (!created || !hostState) {
    return (
      <div className="screen" style={{ justifyContent: "center" }}>
        <h1 className="brand" style={{ fontSize: "2.2rem" }}>
          Host console
        </h1>
        <p className="brand-sub">{connected ? "Connected to server" : "Connecting…"}</p>
        <div className="panel">
          <button className="btn violet" disabled={!connected} onClick={() => send({ type: "host:create_room" })}>
            Create new room
          </button>
        </div>
      </div>
    );
  }

  return <AdminPanel state={hostState} roomCode={roomCode!} send={send} />;
}

function AdminPanel({ state, roomCode, send }: any) {
  const rc = (type: string, extra: object = {}) => send({ type, roomCode, ...extra });
  const activeNode = state.map.nodes.find((n: any) => n.id === state.activeNodeId);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div>
          <div style={{ fontSize: "0.7rem", opacity: 0.6, textAlign: "center" }}>ROOM CODE</div>
          <div className="room-code">{roomCode}</div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Teams</h3>
          {state.teams.length === 0 && <div style={{ opacity: 0.5, fontSize: "0.85rem" }}>No teams have joined yet.</div>}
          {state.teams.map((t: any) => (
            <div className="team-row" key={t.id}>
              {state.phase === "lobby" ? <div className="host-team-editor">
                <input defaultValue={t.name} onBlur={(event) => rc("host:update_team", { teamId: t.id, name: event.target.value, players: t.players })} />
                <div><input placeholder="Player 1" defaultValue={t.players?.[0]} onBlur={(event) => rc("host:update_team", { teamId: t.id, name: t.name, players: [event.target.value, t.players?.[1] ?? ""] })} /><input placeholder="Player 2" defaultValue={t.players?.[1]} onBlur={(event) => rc("host:update_team", { teamId: t.id, name: t.name, players: [t.players?.[0] ?? "", event.target.value] })} /></div>
              </div> : <span>
                <span className="team-dot" style={{ background: t.color }} />
                {t.name} {!t.connected && "⚠️"}
                {t.qualifiedForFinal && " 🏆"}
              </span>}
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <b>{t.score}</b>
                <button className="btn ghost" style={{ width: "auto", padding: "2px 8px" }} onClick={() => rc("host:adjust_score", { teamId: t.id, delta: -100 })}>
                  -
                </button>
                <button className="btn ghost" style={{ width: "auto", padding: "2px 8px" }} onClick={() => rc("host:adjust_score", { teamId: t.id, delta: 100 })}>
                  +
                </button>
                {state.phase === "lobby" && state.teams.length > 3 && <button className="btn ghost" style={{ width: "auto", padding: "2px 8px" }} onClick={() => rc("host:remove_team", { teamId: t.id })}>×</button>}
              </span>
            </div>
          ))}
          {state.phase === "lobby" && state.teams.length < 5 && <button className="btn ghost" onClick={() => rc("host:add_team")}>+ Add team</button>}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Progress</h3>
          <div style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            Climb stage: {state.map.currentStep}
            <br />
            Target score: {state.targetScore.toLocaleString()}
            <br />
            Questions left: {state.questionPoolRemaining} / {state.questionPoolTotal}
          </div>
        </div>

        <TierLegend />

        <div className="target-control">
          <span>Final target</span><strong>{state.targetScore.toLocaleString()}</strong>
          <div><button onClick={() => rc("host:set_target", { targetScore: state.targetScore - 500 })}>−500</button><button onClick={() => rc("host:set_target", { targetScore: state.targetScore + 500 })}>+500</button></div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Event log</h3>
          <ul className="log-list">
            {[...state.eventLog].reverse().map((e: any) => (
              <li key={e.id}>{e.message}</li>
            ))}
          </ul>
        </div>

        <button className="btn ghost" onClick={() => rc(state.paused ? "host:resume" : "host:pause")}>
          {state.paused ? "Resume game" : "Pause game"}
        </button>
      </aside>

      <main className="admin-main">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Phase: <span style={{ color: "var(--teal)" }}>{state.phase}</span>
          </h2>
          {state.paused && <span className="chip" style={{ background: "var(--coral)" }}>PAUSED</span>}
        </div>

        {state.phase === "final" && state.finalState ? (
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
                      {activeNode?.tier} · {tierPoints(activeNode?.tier)} pts
                    </span>
                  </div>
                  <p style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 16 }}>{state.activeQuestion.prompt}</p>
                  <div style={{ fontSize: "0.95rem", opacity: 0.9 }}>
                    <b>Answer:</b> {state.activeQuestion.answer}
                  </div>
                  {state.activeQuestion.acceptedAlternatives?.length > 0 && (
                    <div style={{ fontSize: "0.85rem", opacity: 0.7, marginTop: 4 }}>
                      Accept also: {state.activeQuestion.acceptedAlternatives.join(", ")}
                    </div>
                  )}
                  {state.activeQuestion.hostNote && (
                    <div style={{ fontSize: "0.85rem", opacity: 0.7, marginTop: 4 }}>Note: {state.activeQuestion.hostNote}</div>
                  )}
                </>
              ) : (
                <p style={{ opacity: 0.6 }}>
                  {state.phase === "lobby"
                    ? "Waiting for teams to join. Start the game when ready."
                    : state.phase === "route_choice"
                    ? "Waiting for the controlling team to pick the next path…"
                    : "No active question."}
                </p>
              )}
            </div>

            <div className="control-row">
              {state.phase === "map" && (
                <button className="btn teal" onClick={() => rc("host:start_reading")}>
                  Start reading
                </button>
              )}
              {state.phase === "lobby" && (
                <button className="btn teal" onClick={() => rc("host:start_reading")}>
                  Reveal first question
                </button>
              )}
              {(state.phase === "reading" || state.phase === "map") && (
                <button className="btn pink" onClick={() => rc("host:open_buzzers")}>
                  Open buzzers
                </button>
              )}
              {state.phase === "buzzing" && state.activeQuestion?.mode === "friend_group" && <button className="btn teal" onClick={() => rc("host:reveal_friend_answers")}>Reveal answers ({Object.keys(state.friendAnswers).length}/{state.teams.filter((t: any) => !t.qualifiedForFinal).length})</button>}
              <button className="btn ghost" onClick={() => rc("host:skip_question")}>
                Skip question
              </button>
            </div>

            {state.phase === "adjudicating" && (
              <div className="card">
                <h3 style={{ marginBottom: 10, fontSize: "1rem" }}>Buzz order</h3>
                {state.buzzOrder.map((b: any, i: number) => {
                  const team = state.teams.find((t: any) => t.id === b.teamId);
                  const isCurrent = b.teamId === state.currentResponderId;
                  const isLocked = state.lockedOutTeamIds.includes(b.teamId);
                  return (
                    <div key={b.teamId} className="team-row">
                      <span>
                        <span className="team-dot" style={{ background: team?.color }} />
                        {i + 1}. {team?.name} {isLocked && "(locked out)"}
                      </span>
                      {isCurrent && (
                        <span style={{ display: "flex", gap: 8 }}>
                          <button className="btn teal" style={{ width: "auto" }} onClick={() => rc("host:mark_correct", { teamId: b.teamId })}>
                            Correct
                          </button>
                          <button className="btn coral" style={{ width: "auto" }} onClick={() => rc("host:mark_wrong", { teamId: b.teamId })}>
                            Wrong
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

function FinalPanel({ state, roomCode, send }: any) {
  const finalists = state.finalState.finalists.map((id: string) => state.teams.find((t: any) => t.id === id));
  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>🏆 Final Round</h3>
      <p style={{ opacity: 0.75, fontSize: "0.9rem", marginBottom: 12 }}>
        {finalists.map((f: any) => f?.name).join(" vs ")} — question {state.finalState.currentIndex + 1} of{" "}
        {state.finalState.questionIds.length}
      </p>
      {state.activeQuestion && (
        <div className="question-box">
          <p style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 16 }}>{state.activeQuestion.prompt}</p>
          <div><b>Answer:</b> {state.activeQuestion.answer}</div>
        </div>
      )}
      <p style={{ opacity: 0.6, fontSize: "0.85rem", marginBottom: 12 }}>
        Final scoring and victory rules are still intentionally undecided; this control safely advances the provisional question set.
      </p>
      <button className="btn teal" onClick={() => send({ type: "host:advance_final", roomCode })}>
        {state.finalState.currentIndex + 1 >= state.finalState.questionIds.length ? "End provisional Final" : "Next Final question"}
      </button>
    </div>
  );
}

const TIER_POINTS: Record<string, number> = { T1: 1000, T2: 800, T3: 600, T4: 400, T5: 200 };
function tierPoints(tier?: string) {
  return tier ? TIER_POINTS[tier] : "";
}
