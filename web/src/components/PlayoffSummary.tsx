import React from "react";
import type { PublicGameState, HostGameState } from "../types";
export default function PlayoffSummary({state}:{state:PublicGameState|HostGameState}) {
  const round=state.playoffState;
  if(!round)return null;
  const name=(id:string)=>state.teams.find(t=>t.id===id)?.name??"Ukjent lag";
  return <section className="playoff-summary" aria-label="Kvalifisering om andre finaleplass">
    <small>FØRSTE FINALIST: {name(round.firstQualifierId)}</small>
    <h2>{round.suddenDeath ? "Omspill om andreplassen" : "Kvalifisering om andreplassen"}</h2>
    <p>{round.suddenDeath ? "Bare de delte lederne spiller videre." : `Spørsmål ${Math.min(round.currentIndex+1,round.questionIds.length)} av 5 · Ett riktig svar = ett poeng. Hovedpoengene teller ikke.`}</p>
    {!round.suddenDeath && round.questionIds.length<5 && <p role="status">Banken har bare {round.questionIds.length} av fem spørsmål tilgjengelig. Ved likt resultat brukes omspill.</p>}
    <div className="playoff-summary__scores">{Object.entries(round.scores).map(([id,score])=><div key={id} className={round.contenders.includes(id)?"":"playoff-summary--out"}><span>{name(id)}</span><strong>{score} riktige</strong>{round.suddenDeath&&!round.contenders.includes(id)&&<small>Ute av omspillet</small>}</div>)}</div>
  </section>;
}
