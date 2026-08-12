import { useEffect, useState } from "react";
import { useGameSocket } from "../lib/ws";

export default function TeamFlow() {
  const { connected, publicState, lastError, roomCode, teamId, send } = useGameSocket();
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState("");
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
          <div className="field">
            <label>Team name</label>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="The Buzzer Beaters"
              maxLength={24}
            />
          </div>
          <button
            className="btn teal"
            disabled={!connected || !roomInput.trim() || !nameInput.trim()}
            onClick={() => send({ type: "team:join", roomCode: roomInput.trim(), teamName: nameInput.trim() })}
          >
            Join room
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
  const canBuzz = phase === "buzzing" && !iBuzzed && !iAmLocked;
  const isControlling = phase === "route_choice" && publicState?.controllingTeamId === teamId;

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

      {isControlling ? (
        <div className="panel" style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 12, textAlign: "center" }}>Your team chooses the next path!</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {publicState.legalNextNodeIds.map((nodeId: string, i: number) => (
              <button
                key={nodeId}
                className="btn violet"
                onClick={() => send({ type: "team:choose_route", roomCode, teamId, nodeId })}
              >
                Path {i + 1}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="buzzer-wrap">
          <button
            className={buzzerClass}
            disabled={!canBuzz}
            onClick={() => send({ type: "team:buzz", roomCode, teamId })}
          >
            {buzzerLabel}
          </button>
        </div>
      )}

      <div style={{ opacity: 0.55, fontSize: "0.8rem", marginTop: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {phaseLabel(phase)}
      </div>
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
