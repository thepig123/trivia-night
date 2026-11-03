import { useEffect, useState } from "react";
import { useGameSocket } from "../lib/ws";
import TeamController from "../components/TeamController";

export default function TeamFlow() {
  const { connected, publicState, lastError, roomCode, teamId, send, testControllers } = useGameSocket("team");
  const [roomInput, setRoomInput] = useState("");
  const [teamName, setTeamName] = useState("");
  const [playerOne, setPlayerOne] = useState("");
  const [playerTwo, setPlayerTwo] = useState("");
  const [teamPhoto, setTeamPhoto] = useState<string | undefined>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    setJoined(!!teamId);
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

  return <TeamController roomCode={roomCode!} teamId={teamId!} publicState={publicState} send={send} connected={connected} lastError={lastError} testControllers={testControllers} />;
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
