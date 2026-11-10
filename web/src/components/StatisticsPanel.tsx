import React from "react";
import type {CategoryStats, GameStats, Team} from "../types";
export const buzzTime=(ms:number|null)=>ms===null?"–":`${(ms/1000).toLocaleString("nb-NO",{minimumFractionDigits:2,maximumFractionDigits:2})} s`;
const percent=(value:number|null)=>value===null?"–":`${Math.round(value*100)} %`;
function CategoryTable({categories}:{categories:CategoryStats[]}) {
  return <table><thead><tr><th>Kategori</th><th>Vurderte svar</th><th>Riktig</th><th>Feil</th><th>Treff</th></tr></thead><tbody>{categories.map(row=><tr key={row.category}><td>{row.category}</td><td>{row.attempts}</td><td>{row.correct}</td><td>{row.wrong}</td><td>{percent(row.accuracy)}</td></tr>)}</tbody></table>;
}
function csvCell(value:unknown) {const text=String(value??"");return '"'+(/^[\t\r\n ]*[=+@-]/.test(text)?"'":"")+text.replace(/"/g,'""')+'"';}
export function statisticsCsv(statistics:GameStats,teams:Team[]):string {
  const rows:unknown[][]=[["Lag","Riktige","Feil","Treffprosent","Gyldige buzz","Første buzz","Snitt buzz ms","Raskeste buzz ms","Tregeste buzz ms","Hovedrunde riktige","Kvalifisering riktige","Finale riktige"]];
  for(const row of statistics.teams)rows.push([teams.find(t=>t.id===row.teamId)?.name??row.teamId,row.correct,row.wrong,row.accuracy===null?"":Math.round(row.accuracy*100),row.buzzCount,row.firstBuzzes,row.averageBuzzMs,row.fastestBuzzMs,row.slowestBuzzMs,row.mainCorrect,row.playoffCorrect,row.finalCorrect]);
  rows.push([], ["Kategori","Vurderte svar","Riktige","Feil","Treffprosent"]);
  for(const row of statistics.categories)rows.push([row.category,row.attempts,row.correct,row.wrong,row.accuracy===null?"":Math.round(row.accuracy*100)]);
  return "\uFEFF"+rows.map(row=>row.map(csvCell).join(";")).join("\r\n");
}
export default function StatisticsPanel({statistics,teams}:{statistics:GameStats;teams:Team[]}) {
  const exportCsv=()=>{const url=URL.createObjectURL(new Blob([statisticsCsv(statistics,teams)],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="quiz-med-gutta-statistikk.csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <details className="card statistics-panel"><summary>Statistikk for kvelden · {statistics.completedQuestions} avsluttede spørsmål</summary>
    <p>{statistics.skippedQuestions} spørsmål hoppet over. Korrigeringer med Angre oppdaterer tallene; byttede spørsmål holdes utenfor.</p>
    <div className="statistics-panel__table"><table><thead><tr><th>Lag</th><th>Riktig / feil</th><th>Treff</th><th>Buzz</th><th>Første buzz</th><th>Snitt</th><th>Raskest</th><th>Tregest</th></tr></thead><tbody>{statistics.teams.map(row=><tr key={row.teamId}><td>{teams.find(t=>t.id===row.teamId)?.name}</td><td>{row.correct} / {row.wrong}</td><td>{percent(row.accuracy)}</td><td>{row.buzzCount}</td><td>{row.firstBuzzes}</td><td>{buzzTime(row.averageBuzzMs)}</td><td>{buzzTime(row.fastestBuzzMs)}</td><td>{buzzTime(row.slowestBuzzMs)}</td></tr>)}</tbody></table></div>
    <p><small>Buzztid måles på serveren fra svar åpnes, uten pauser og vertens vurderingstid. Rebound-buzz er med. Ugyldige/for tidlige trykk teller ikke. Treffprosent bruker bare vurderte svar, ikke ubesvarte spørsmål.</small></p>
    <div className="statistics-highlights"><div><small>HØYEST TREFF I KATEGORI</small><strong>{statistics.easiestCategory?.category??"For få svar ennå"}</strong></div><div><small>LAVEST TREFF I KATEGORI</small><strong>{statistics.hardestCategory?.category??"For få svar ennå"}</strong></div></div>
    <p><small>Kategorier rangeres først etter tre vurderte svar. Dette beskriver kveldens svar, ikke en fasit på hvor vanskelig en kategori er.</small></p>
    <div className="statistics-panel__table"><CategoryTable categories={statistics.categories}/></div>
    {statistics.teams.map(row=><details key={row.teamId}><summary>{teams.find(t=>t.id===row.teamId)?.name} · kategorier og runder</summary><p>{row.mainCorrect} riktige i hovedrunden · {row.playoffCorrect} i kvalifiseringen · {row.finalCorrect} i finalen. {row.questionsSeen} avsluttede spørsmål tilgjengelige for laget.</p><CategoryTable categories={row.categories}/></details>)}
    <button className="btn ghost" onClick={exportCsv}>Last ned statistikk · CSV</button>
  </details>;
}
export function StatisticsHighlights({statistics,teams}:{statistics:GameStats;teams:Team[]}) {
  const name=(id:string)=>teams.find(t=>t.id===id)?.name??"Ukjent lag";
  return <div className="statistics-highlights"><div><small>RASKERE ENN SIN EGEN SKYGGE</small><strong>{statistics.fastestBuzz?name(statistics.fastestBuzz.teamId):"Ingen buzz registrert"}</strong>{statistics.fastestBuzz&&<span>{buzzTime(statistics.fastestBuzz.milliseconds)}</span>}</div><div><small>FLEST RIKTIGE SVAR</small><strong>{statistics.mostCorrectTeamIds.map(name).join(" · ")||"Ingen riktige ennå"}</strong></div><div><small>KVELDENS VANSKELIGSTE KATEGORI</small><strong>{statistics.hardestCategory?.category??"For få vurderte svar"}</strong>{statistics.hardestCategory&&<span>{Math.round(statistics.hardestCategory.accuracy!*100)} % · {statistics.hardestCategory.attempts} svar</span>}</div></div>;
}
