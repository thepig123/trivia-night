import { useEffect, useState } from "react";
import { useGameSocket } from "../lib/ws";
import RouteMap, { TierLegend } from "../components/RouteMap";

export default function TeamFlow() {
  const { connected, publicState, lastError, roomCode, teamId, send } = useGameSocket("team");
  const [roomInput, setRoomInput] = useState("");
  const [teamName, setTeamName] = useState("");
  const [playerOne, setPlayerOne] = useState("");
  const [playerTwo, setPlayerTwo] = useState("");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (teamId) setJoined(true);
  }, [teamId]);

  if (!joined) {
    return (
      <div className="screen" style={{ justifyContent: "center" }}>
        <h1 className="brand" style={{ fontSize: "2.2rem" }}>
          Join the game
        </h1>
        <p className="brand-sub">{connected ? "Connected to server" : "Connecting…"}</p>
        <div className="panel">
          {lastError && <div className="error-banner">{lastError}</div>}
          <div className="field">
            <label>Room code</label>
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              placeholder="ABCDE"
              maxLength={6}
              autoCapitalize="characters"
            />
          </div>
          <div className="field"><label>Team name</label><input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="The Buzzer Beaters" maxLength={24} /></div>
          <div className="player-fields">
            <div className="field"><label>Player 1</label><input value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} placeholder="Name" maxLength={24} /></div>
            <div className="field"><label>Player 2</label><input value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} placeholder="Name" maxLength={24} /></div>
          </div>
          <button className="btn teal" disabled={!connected || !roomInput.trim() || !teamName.trim() || !playerOne.trim() || !playerTwo.trim()} onClick={() => send({ type: "team:join", roomCode: roomInput.trim(), teamName: teamName.trim(), players: [playerOne.trim(), playerTwo.trim()] })}>
            Create team and join
          </button>
        </div>
      </div>
    );
  }

  return <TeamController roomCode={roomCode!} teamId={teamId!} publicState={publicState} send={send} />;
}

function TeamController({ roomCode, teamId, publicState, send }: any) {
  const me = publicState?.teams.find((t: any) => t.id === teamId);
  const phase = publicState?.phase;
  const iBuzzed = publicState?.buzzOrder?.some((b: any) => b.teamId === teamId);
  const iAmLocked = publicState?.lockedOutTeamIds?.includes(teamId);
  const iAmFirst = publicState?.currentResponderId === teamId;
  const canBuzz = !publicState?.paused && phase === "buzzing" && !iBuzzed && !iAmLocked;
  const isControlling = !publicState?.paused && phase === "route_choice" && publicState?.controllingTeamId === teamId;
  const isFriendRound = publicState?.activeQuestionPublic?.mode === "friend_group";
  const friendSubmitted = publicState?.friendAnswersSubmitted?.includes(teamId);
  const qualified = me?.qualifiedForFinal;

  let buzzerClass = "buzzer";
  let buzzerLabel = "BUZZ";
  if (iAmFirst) {
    buzzerClass += " first";
    buzzerLabel = "YOU'RE UP!";
  } else if (iAmLocked || (iBuzzed && !iAmFirst) || phase !== "buzzing") {
    buzzerClass += " locked";
    if (iAmLocked) buzzerLabel = "LOCKED OUT";
    else if (iBuzzed) buzzerLabel = "BUZZED";
    else buzzerLabel = "WAIT";
  }

  return (
    <div className="screen">
      <div style={{ width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>ROOM {roomCode}</div>
          <h2 style={{ color: me?.color }}>{me?.name}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>SCORE</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: "var(--yellow)" }}>
            {me?.score ?? 0}
          </div>
        </div>
      </div>

      {qualified ? <div className="qualified-card"><strong>FINALIST</strong><span>Your place is secured. Watch the remaining teams race.</span></div> : isControlling ? (
        <div className="map-choice-wrap">
          <h3>Choose your path</h3>
          <p>The glowing encounters are yours to claim.</p>
          <RouteMap
            map={publicState.map}
            legalNodeIds={publicState.legalNextNodeIds}
            interactive
            onChoose={(nodeId) => send({ type: "team:choose_route", roomCode, teamId, nodeId })}
          />
          <TierLegend compact />
        </div>
      ) : isFriendRound && phase === "buzzing" ? (
        <div className="friend-answer-panel">
          <h3>Choose your answer</h3>
          {publicState.activeQuestionPublic.choices?.map((choice: string) => <button className="btn ghost" key={choice} disabled={friendSubmitted} onClick={() => send({ type: "team:submit_friend_answer", roomCode, teamId, answer: choice })}>{choice}</button>)}
          {friendSubmitted && <p>Answer locked in. Waiting for the reveal…</p>}
        </div>
      ) : (
        <>
          {publicState?.map && <RouteMap map={publicState.map} legalNodeIds={publicState.legalNextNodeIds} />}
          <div className="buzzer-wrap">
            <button
              className={buzzerClass}
              disabled={!canBuzz}
              onClick={() => send({ type: "team:buzz", roomCode, teamId })}
            >
              {buzzerLabel}
            </button>
          </div>
        </>
      )}

      <div style={{ opacity: 0.55, fontSize: "0.8rem", marginTop: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {publicState?.paused ? "Game paused" : phaseLabel(phase)}
      </div>
      {me && !qualified && <div className="final-progress"><div><span>Road to the Final</span><b>{Math.max(0, publicState.targetScore - me.score).toLocaleString()} points remaining</b></div><progress value={me.score} max={publicState.targetScore} /></div>}
    </div>
  );
}

function phaseLabel(phase: string | undefined) {
  switch (phase) {
    case "lobby":
      return "Waiting for the host to start";
    case "map":
      return "Get ready — question coming up";
    case "reading":
      return "Host is reading the question";
    case "buzzing":
      return "Buzzers are open!";
    case "adjudicating":
      return "Host is judging the answer";
    case "route_choice":
      return "Choosing the next path";
    case "final":
      return "Final round!";
    case "ended":
      return "Game over";
    default:
      return "";
  }
}
