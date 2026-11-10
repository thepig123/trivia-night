import React from "react";
import type { PublicGameState, HostGameState } from "../types";
export default function PlayoffSummary({state}:{state:PublicGameState|HostGameState}) {
  const round=state.playoffState;
  if(!round)return null;
  const duel=round.stage?.startsWith("duel");
  const count=duel?3:5;
  const name=(id:string)=>state.teams.find(t=>t.id===id)?.name??"Ukjent lag";
  return <section className="playoff-summary" aria-label="Kvalifisering om andre finaleplass">
    <small>FØRSTE FINALIST: {name(round.firstQualifierId)}</small>
    <h2>{duel ? round.suddenDeath?"Omspill i duellen":"Duell om andre finaleplass" : round.suddenDeath?"Omspill om duellplassene":"Fem spørsmål · to går videre"}</h2>
    <p>{round.suddenDeath ? "Bare lagene som står likt spiller videre. Sikrede plasser beholdes." : `Spørsmål ${Math.min(round.currentIndex+1,round.questionIds.length)} av ${count} · Ett riktig svar = ett poeng. Alle ${count} spørsmål spilles.`}</p>
    {!round.suddenDeath && round.questionIds.length<count && <p role="status">Banken har bare {round.questionIds.length} av {count} spørsmål tilgjengelig. Ved likt resultat brukes omspill.</p>}
    {!duel && <p><small>Forsprang: ett poeng per {Math.round(state.targetScore/4).toLocaleString("nb-NO")} hovedpoeng over laveste gjenværende lag, maks +2. Forspranget er låst og gjelder bare denne runden.</small></p>}
    {duel && <p>Begge lag starter på null. Flest riktige etter tre spørsmål tar finaleplassen. Uavgjort gir omspill.</p>}
    <div className="playoff-summary__scores">{Object.entries(round.scores).map(([id,score])=><div key={id} className={round.contenders.includes(id)||round.safeTeamIds?.includes(id)?"":"playoff-summary--out"}><span>{name(id)}</span><strong>{score+(round.headStarts?.[id]??0)} poeng</strong><small>{score} riktige{!duel&&` + ${round.headStarts?.[id]??0} i forsprang`}</small>{round.safeTeamIds?.includes(id)?<small>Klar for duellen · sitter over omspillet</small>:!round.contenders.includes(id)&&<small>Ute av kvalifiseringen</small>}</div>)}</div>
    {round.eliminationResult&&<details><summary>Resultat fra femspørsmålsrunden</summary>{Object.entries(round.eliminationResult.scores).map(([id,score])=><p key={id}>{name(id)}: {score} riktige + {round.eliminationResult!.headStarts[id]??0} i forsprang{round.eliminatedTeamIds?.includes(id)?" · utslått":" · videre til duell"}</p>)}</details>}
  </section>;
}
