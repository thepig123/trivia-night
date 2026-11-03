import React from "react";
import { packSummary, FORMAT_LABELS, READY_LABELS, type QuestionBank, type QuestionPack } from "../lib/bankModel";
export default function PackOverview({bank,pack}:{bank:QuestionBank;pack:QuestionPack}) {
  const summary=packSummary(bank,pack);
  return <section className="card pack-overview"><h2>Kveldssjekk · {pack.name}</h2><div className="pack-overview__stats"><strong>{summary.route.length}<small>klare til hovedrunden</small></strong><strong>{summary.final.length}<small>reservert til finalen</small></strong><strong>{summary.blocked.length}<small>ikke spillbare i pakken</small></strong><strong>{summary.missingAssets.length}<small>mangler medier</small></strong></div>
    <p>Finalepotten er reservert til finalen. Fem spørsmål trekkes derfra; ved færre enn fem suppleres det fra resten. Uten egne valg reserverer spillet automatisk en liten finalepott.</p>
    {summary.final.length>0 && summary.final.length<5 && <p className="bank-validation">Velg gjerne minst fem klare finalespørsmål. Nå må finalen suppleres.</p>}
    {summary.route.length===0 && <p className="error-banner">Ingen klare spørsmål til hovedrunden. Legg til PICK + Klar utenfor finalepotten.</p>}
    <div className="pack-overview__tables"><table><caption>Kategorier · hovedrunde</caption><thead><tr><th>Kategori</th><th>Klare / inkludert</th></tr></thead><tbody>{summary.categories.map(row=><tr key={row.category}><td>{row.category}</td><td>{row.ready} / {row.total}{row.ready<3 ? " · tynt utvalg" : ""}</td></tr>)}</tbody></table><table><caption>Vanskelighetsgrader · uten Gutta</caption><thead><tr><th>Nivå</th><th>Klare</th></tr></thead><tbody>{summary.tiers.map(row=><tr key={row.tier}><td>{row.tier}</td><td>{row.count}{row.count<3 ? " · tynt utvalg" : ""}</td></tr>)}</tbody></table><table><caption>Formater · hele pakken</caption><thead><tr><th>Format</th><th>Klare</th></tr></thead><tbody>{summary.formats.map(row=><tr key={row.format}><td>{FORMAT_LABELS[row.format]}</td><td>{row.count}</td></tr>)}</tbody></table></div>
    <details><summary>Vis spørsmål som trenger arbeid ({summary.blocked.length})</summary>{summary.blocked.map(q=><p key={q.id}><b>{q.id}</b> · {q.category} · {READY_LABELS[q.readiness]} / {q.selection}</p>)}</details>
    <p><small>«Tynt utvalg» betyr færre enn tre klare spørsmål. Dette er en anbefaling, ikke en sperre. Gutta kan dukke opp på alle nivåer.</small></p>
  </section>;
}
