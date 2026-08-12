import { useEffect, useState } from "react";
import { useGameSocket } from "../lib/ws";
import RouteMap, { TierLegend } from "../components/RouteMap";

export default function TeamFlow() {
  const { connected, publicState, lastError, roomCode, teamId, send } = useGameSocket("team");
  const [roomInput, setRoomInput] = useState("");
  const [teamName, setTeamName] = useState("");
  const [playerOne, setPlayerOne] = useState("");
  const [playerTwo, setPlayerTwo] = useState("");
  const [teamPhoto, setTeamPhoto] = useState<string | undefined>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (teamId) setJoined(true);
  }, [teamId]);

  if (!joined) {
    return (
      <div className="screen" style={{ justifyContent: "center" }}>
        <h1 className="brand" style={{ fontSize: "2.2rem" }}>
          Bli med i spillet
        </h1>
        <p className="brand-sub">{connected ? "Tilkoblet serveren" : "Kobler til…"}</p>
        <div className="panel">
          {lastError && <div className="error-banner">{lastError}</div>}
          <div className="field">
            <label>Romkode</label>
            <input
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
              placeholder="ABCDE"
              maxLength={6}
              autoCapitalize="characters"
            />
          </div>
          <div className="field"><label>Lagets navn</label><input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Quizkameratene" maxLength={24} /></div>
          <div className="player-fields">
            <div className="field"><label>Spiller 1</label><input value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} placeholder="Navn" maxLength={24} /></div>
            <div className="field"><label>Spiller 2</label><input value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} placeholder="Navn" maxLength={24} /></div>
          </div>
          <div className="field team-photo-field">
            <label>Lagbilde (valgfritt og helst litt teit)</label>
            <small>Bildet beskjæres automatisk til bannerformat. Forhåndsvisningen viser utsnittet som brukes.</small>
            <input type="file" accept="image/*" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setPhotoBusy(true);
              try { setTeamPhoto(await compressTeamPhoto(file)); } finally { setPhotoBusy(false); }
            }} />
            {teamPhoto && <img src={teamPhoto} alt="Forhåndsvisning av lagbildet" />}
          </div>
          <button className="btn teal" disabled={!connected || photoBusy || !roomInput.trim() || !teamName.trim() || !playerOne.trim() || !playerTwo.trim()} onClick={() => send({ type: "team:join", roomCode: roomInput.trim(), teamName: teamName.trim(), players: [playerOne.trim(), playerTwo.trim()], photoDataUrl: teamPhoto })}>
            Opprett lag og bli med
          </button>
        </div>
      </div>
    );
  }

  return <TeamController roomCode={roomCode!} teamId={teamId!} publicState={publicState} send={send} />;
}

async function compressTeamPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const widthTarget = 960;
  const heightTarget = 360;
  const canvas = document.createElement("canvas");
  canvas.width = widthTarget; canvas.height = heightTarget;
  const context = canvas.getContext("2d")!;
  const scale = Math.max(widthTarget / bitmap.width, heightTarget / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  context.drawImage(bitmap, (widthTarget - width) / 2, (heightTarget - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.68);
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
    buzzerLabel = "DERES TUR!";
  } else if (iAmLocked || (iBuzzed && !iAmFirst) || phase !== "buzzing") {
    buzzerClass += " locked";
    if (iAmLocked) buzzerLabel = "UTELÅST";
    else if (iBuzzed) buzzerLabel = "SVART";
    else buzzerLabel = "VENT";
  }

  return (
    <div className="screen">
      <div style={{ width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>ROM {roomCode}</div>
          <h2 style={{ color: me?.color }}>{me?.name}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>POENG</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: "var(--yellow)" }}>
            {me?.score ?? 0}
          </div>
        </div>
      </div>

      {qualified ? <div className="qualified-card"><strong>FINALIST</strong><span>Finaleplassen er sikret. Følg kampen mellom de andre lagene.</span></div> : isControlling ? (
        <div className="map-choice-wrap">
          <h3>Velg rute</h3>
          <p>Velg mellom de lysende kategoriene.</p>
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
          <h3>Velg svar</h3>
          {publicState.activeQuestionPublic.choices?.map((choice: string) => <button className="btn ghost" key={choice} disabled={friendSubmitted} onClick={() => send({ type: "team:submit_friend_answer", roomCode, teamId, answer: choice })}>{choice}</button>)}
          {friendSubmitted && <p>Svaret er låst. Venter på avsløringen…</p>}
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
        {publicState?.paused ? "Spillet er satt på pause" : phaseLabel(phase)}
      </div>
      {me && !qualified && <div className="final-progress"><div><span>Veien til finalen</span><b>{Math.max(0, publicState.targetScore - me.score).toLocaleString()} poeng igjen</b></div><progress value={me.score} max={publicState.targetScore} /></div>}
    </div>
  );
}

function phaseLabel(phase: string | undefined) {
  switch (phase) {
    case "lobby":
      return "Venter på at verten skal starte";
    case "map":
      return "Gjør dere klare — neste spørsmål kommer";
    case "reading":
      return "Verten leser spørsmålet";
    case "buzzing":
      return "Buzzerne er åpne!";
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
