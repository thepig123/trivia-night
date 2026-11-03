import { isGutta, questionPoints } from "../types";
import { useEffect, useState } from "react";
import PackOverview from "../components/PackOverview";
import { FORMAT_LABELS, FORMATS, uniqueId, READY_LABELS, newQuestion, readyProblems, isPlayable, exportCsv, importQuestions, mergeQuestions } from "../lib/bankModel";
import type { BankQuestion, QuestionBank as Bank, Format, QuestionPack } from "../lib/bankModel";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}
export default function QuestionBank() {
  const [key,setKey] = useState(() => sessionStorage.getItem("trivia-bank-key") ?? "");
  const [bank,setBank] = useState<Bank | null>(null);
  const [error,setError] = useState(""); const [notice,setNotice] = useState(""); const [busy,setBusy] = useState(false);
  const [search,setSearch] = useState(""); const [category,setCategory] = useState(""); const [selection,setSelection] = useState(""); const [readiness,setReadiness] = useState(""); const [format,setFormat] = useState(""); const [onlyPack,setOnlyPack] = useState(false);
  const [draft,setDraft] = useState<BankQuestion | null>(null); const [originalId,setOriginalId] = useState<string | null>(null);
  const [incoming,setIncoming] = useState<BankQuestion[] | null>(null);
  const [importPacks,setImportPacks] = useState<QuestionPack[] | null>(null);
  const [importActive,setImportActive] = useState<string | null>(null);
  const [preview,setPreview] = useState<"tv"|"phone"|"host">("tv"); const [packName,setPackName]=useState("");
  async function request(path="", init: RequestInit = {}) {
    const response = await fetch(`/api/bank${path}`, {...init,headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`,...init.headers}});
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Forespørselen feilet."); return result;
  }
  async function load() {
    setBusy(true); setError("");
    try { const result = await request(); setBank(result); sessionStorage.setItem("trivia-bank-key",key); setDraft(null); setIncoming(null); }
    catch(e) {setError(String((e as Error).message));} finally {setBusy(false);}
  }
  useEffect(() => { if (key) void load(); }, []);
  useEffect(() => {
    const handler=(e: BeforeUnloadEvent)=>{if(draft || incoming){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",handler); return ()=>window.removeEventListener("beforeunload",handler);
  },[draft,incoming]);
  async function save(next: Bank, success="Lagret på serveren.") {
    setBusy(true);setError("");setNotice("");
    try {setBank(await request("",{method:"PUT",body:JSON.stringify(next)}));setNotice(success);return true;}
    catch(e){setError((e as Error).message);return false;} finally {setBusy(false);}
  }
  if (!bank) return <main className="bank-login panel"><a href="/host">← Vertspanel</a><h1>Spørsmålsbanken</h1><p>Redaktørnøkkelen vises i terminalen når serveren starter. Nøkkelen gir tilgang til fasit og redigering.</p><form onSubmit={e=>{e.preventDefault();void load();}}><label className="field">Redaktørnøkkel<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" required /></label><button className="btn teal" disabled={busy}>Åpne banken</button></form>{error && <p role="alert" className="error-banner">{error}</p>}</main>;
  const pack = bank.packs.find(p=>p.id===bank.activePackId)!;
  const members = new Set(pack.questionIds);
  const filtered = bank.questions.filter(q => (!category || q.category===category) && (!selection || q.selection===selection) && (!readiness || q.readiness===readiness) && (!format || q.format===format) && (!onlyPack || members.has(q.id)) && `${q.id} ${q.prompt} ${q.answer} ${q.notes}`.toLowerCase().includes(search.toLowerCase()));
  const readyToAdd=bank.questions.filter(q=>isPlayable(q)&&!members.has(q.id));
  const readyCount=bank.questions.filter(q=>members.has(q.id)&&isPlayable(q)).length;
  const patch=(value: Partial<BankQuestion>)=>setDraft(q=>q ? {...q,...value} : null);
  const importPlan = incoming ? mergeQuestions(bank.questions,incoming) : null;
  async function upload(file: File, reveal=false) {
    setBusy(true);setError("");
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("Mediefilen er for stor. Maks 15 MB.");
      const data = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const result = await request("/media",{method:"POST",body:JSON.stringify({mime:file.type,data})});
      patch(reveal ? {revealMedia:result} : {media:result});
    } catch(e){setError((e as Error).message);} finally {setBusy(false);}
  }
  async function commitDraft() {
    if (!draft) return;
    if (draft.id!==originalId && bank!.questions.some(q=>q.id===draft.id)) {setError("Denne ID-en finnes allerede.");return;}
    const question={...draft,progressiveImage:draft.format==="progressive_image",mode:draft.format==="closest" ? "closest" as const : draft.format==="private_choice" ? "private_choice" as const : "buzzer" as const,status:"unused" as const};
    const next={...bank!,questions: originalId ? bank!.questions.map(q=>q.id===originalId ? question : q) : [...bank!.questions,question]};
    if (await save(next)) {setDraft(null);setOriginalId(null);}
  }
  return <main className="bank-shell">
    <header className="bank-heading"><div><a href="/host">← Vertspanel</a><h1>Spørsmålsbanken</h1><p>Forbered innholdet her. Nye rom får en egen kopi av den aktive kveldspakken.</p></div><div className="bank-actions"><button disabled={busy||!!draft} onClick={()=>{setDraft(newQuestion());setOriginalId(null);}}>＋ Nytt spørsmål</button><button disabled={busy||!!draft} onClick={()=>void load()}>Last inn på nytt</button><button disabled={busy||!!draft||!!incoming} onClick={()=>{sessionStorage.removeItem("trivia-bank-key");setKey("");setBank(null);}}>Lås banken</button></div></header>
    {bank.questions.length===0 && <div className="bank-notice">Banken er tom. Importer den private spørsmålsbank-filen via CSV / JSON nedenfor, eller opprett et nytt spørsmål.</div>}
    {error && <div role="alert" className="error-banner">{error}</div>}{notice && <div role="status" className="bank-notice">{notice}</div>}
    <section className="bank-pack panel"><div><label>Aktiv kveldspakke<select value={bank.activePackId} disabled={busy||!!draft} onChange={e=>void save({...bank,activePackId:e.target.value},"Aktiv pakke endret for nye rom.")}>{bank.packs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><strong>{readyCount} spillbare / {pack.questionIds.length} i pakken</strong>
      <button disabled={busy||!!draft||!!incoming||readyToAdd.length===0} onClick={()=>void save({...bank,packs:bank.packs.map(p=>p.id===pack.id?{...p,questionIds:[...p.questionIds,...readyToAdd.map(q=>q.id)]}:p)},`${readyToAdd.length} spørsmål lagt til i «${pack.name}».`)}>Legg til alle PICK + Klar ({readyToAdd.length})</button>
      <small>{readyToAdd.length===0?"Alle spørsmål med PICK + Klar er allerede med i pakken.":"Legger til fra hele banken, uavhengig av søk og filtre. Eksisterende spørsmål beholdes."}</small><small>Bare PICK + Klar trekkes i spillet. Utkast, MAYBE og manglende medier blir holdt utenfor.</small></div><div className="bank-pack-create"><input aria-label="Navn på ny kveldspakke" placeholder="Navn på ny kveld" value={packName} onChange={e=>setPackName(e.target.value)}/><button disabled={busy||!packName.trim()||!!draft} onClick={async()=>{const id=uniqueId();if(await save({...bank,packs:[...bank.packs,{id,name:packName.trim(),questionIds:[]}],activePackId:id}))setPackName("");}}>Opprett tom pakke</button><button disabled={busy||!packName.trim()||!!draft} onClick={async()=>{const id=uniqueId();if(await save({...bank,packs:[...bank.packs,{id,name:packName.trim(),questionIds:[...pack.questionIds],finalQuestionIds:[...(pack.finalQuestionIds??[])]}],activePackId:id}))setPackName("");}}>Kopier aktiv pakke</button></div></section>
    <PackOverview bank={bank} pack={pack}/>
    <section className="bank-toolbar panel"><input placeholder="Søk etter ID, spørsmål, fasit eller notat…" aria-label="Søk i banken" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Kategori" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Alle kategorier</option>{[...new Set(bank.questions.map(q=>q.category))].sort().map(c=><option key={c}>{c}</option>)}</select><select aria-label="Utvalg" value={selection} onChange={e=>setSelection(e.target.value)}><option value="">Alle utvalg</option>{["PICK","MAYBE","REJECT","UNREVIEWED"].map(v=><option key={v}>{v}</option>)}</select><select aria-label="Klarstatus" value={readiness} onChange={e=>setReadiness(e.target.value)}><option value="">Alle statuser</option>{Object.entries(READY_LABELS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select><select aria-label="Format" value={format} onChange={e=>setFormat(e.target.value)}><option value="">Alle formater</option>{FORMATS.map(f=><option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}</select><label><input type="checkbox" checked={onlyPack} onChange={e=>setOnlyPack(e.target.checked)}/> Bare aktiv pakke</label></section>
    <section className="bank-actions bank-transfer"><button onClick={()=>download("trivia-bank.json",JSON.stringify(bank,null,2),"application/json")}>Eksporter full bank (JSON)</button><button onClick={()=>download("trivia-questions.csv",exportCsv(bank.questions),"text/csv;charset=utf-8")}>Eksporter alle spørsmål (CSV)</button><label className="bank-file">Importer CSV / JSON<input type="file" accept=".csv,.json" disabled={busy||!!draft} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setError("");try {const text = await file.text(); const json = file.name.toLowerCase().endsWith(".json"); const qs=importQuestions(text,json);mergeQuestions(bank.questions,qs);
      const full=json?JSON.parse(text):null;
      if(full?.packs && !Array.isArray(full.packs)) throw new Error("Ugyldige kveldspakker.");
      setImportPacks(full?.packs??null);setImportActive(full?.activePackId??null);setIncoming(qs);}catch(err){setError((err as Error).message);}e.target.value="";}}/></label><span>{filtered.length} / {bank.questions.length} spørsmål</span></section>
    {importPlan && <section className="panel bank-import"><h2>Se gjennom importen</h2><p>{importPlan.added.length} nye · {importPlan.changed.length} oppdateres · {importPlan.unchanged.length} uendret. ID bestemmer hvilke spørsmål som oppdateres. Ingen spørsmål slettes.</p><p>{importPacks ? `${importPacks.length} kveldspakker importeres også. Pakker med samme ID oppdateres; øvrige beholdes.` : "Eksisterende kveldspakker beholdes. Nye spørsmål legges ikke automatisk i en pakke."} Mediefiler følger ikke med CSV/JSON; ta vare på serverens runtime-mappe ved flytting.</p><details><summary>Vis berørte ID-er</summary><p>Nye: {importPlan.added.join(", ")||"Ingen"}</p><p>Oppdateres: {importPlan.changed.join(", ")||"Ingen"}</p></details><button disabled={busy} onClick={async()=>{const packs = new Map(bank.packs.map(p=>[p.id,p]));for(const p of importPacks??[]) packs.set(p.id,p);
      if(await save({...bank,questions:importPlan.questions,packs:[...packs.values()],activePackId:importActive??bank.activePackId},"Import lagret."))setIncoming(null);}}>Bruk import og lagre</button><button onClick={()=>setIncoming(null)}>Avbryt</button></section>}
    <div className={`bank-workspace ${draft ? "bank-workspace--editing" : ""}`}>
      <section className="bank-table-wrap"><table className="bank-table"><thead><tr><th>I pakken</th><th>ID / kategori</th><th>Spørsmål</th><th>Format / nivå</th><th>Utvalg / status</th><th>Handling</th></tr></thead><tbody>{filtered.map(q=><tr key={q.id} className={q.readiness==="archived"?"bank-archived":""}><td><input type="checkbox" aria-label={`Inkluder ${q.id} i pakken`} checked={members.has(q.id)} disabled={busy||!!draft} onChange={e=>void save({...bank,packs:bank.packs.map(p=>p.id===pack.id?{...p,questionIds:e.target.checked?[...p.questionIds,q.id]:p.questionIds.filter(id=>id!==q.id),finalQuestionIds:e.target.checked?p.finalQuestionIds:(p.finalQuestionIds??[]).filter(id=>id!==q.id)}:p)})}/></td><td><input type="checkbox" aria-label={`Reserver ${q.id} til finalen`} checked={(pack.finalQuestionIds??[]).includes(q.id)} disabled={busy||!!draft} onChange={e=>void save({...bank,packs:bank.packs.map(p=>p.id===pack.id?{...p,questionIds:[...new Set([...p.questionIds,q.id])],finalQuestionIds:e.target.checked?[...(p.finalQuestionIds??[]),q.id]:(p.finalQuestionIds??[]).filter(id=>id!==q.id)}:p)},"Finalepotten oppdatert for nye rom.")}/></td><td><b>{q.id}</b><small>{q.category}</small></td><td>{q.prompt}<small>{q.source==="demo"?"Eksempel – ikke ditt gjennomgåtte utvalg":q.subcategory}</small></td><td>{FORMAT_LABELS[q.format]}<small>{isGutta(q.category)?"Fast 500 poeng":q.tier}</small></td><td><span className={`bank-pill bank-pill--${q.selection.toLowerCase()}`}>{q.selection}</span><small>{READY_LABELS[q.readiness]}</small></td><td><button disabled={busy||!!draft} onClick={()=>{setDraft(structuredClone(q));setOriginalId(q.id);setError("");}}>Rediger</button><button disabled={busy||!!draft} onClick={()=>{setDraft({...structuredClone(q),id:`CUSTOM-${uniqueId()}`,selection:"UNREVIEWED",readiness:"draft",source:"custom"});setOriginalId(null);}}>Dupliser</button></td></tr>)}</tbody></table>{!filtered.length&&<p>Ingen spørsmål matcher filtrene.</p>}</section>
      {draft && <section className="bank-editor panel"><h2>{originalId?"Rediger spørsmål":"Nytt spørsmål"}</h2><p>Endringer er ikke lagret før du trykker Lagre.</p><div className="bank-fields"><label>ID<input value={draft.id} disabled={!!originalId} onChange={e=>patch({id:e.target.value})}/></label><label>Kategori<input list="categories" value={draft.category} onChange={e=>patch({category:e.target.value})}/><datalist id="categories">{[...new Set([...bank.questions.map(q=>q.category),"Gutta"])].map(c=><option key={c}>{c}</option>)}</datalist></label><label>Underkategori<input value={draft.subcategory??""} onChange={e=>patch({subcategory:e.target.value})}/></label>{isGutta(draft.category)?<p>Gutta: fast 500 poeng. Ingen vanskelighetsgrad trengs.</p>:<label>Nivå<select value={draft.tier} onChange={e=>patch({tier:e.target.value as BankQuestion["tier"]})}>{["T5","T4","T3","T2","T1"].map((t,i)=><option key={t} value={t}>{t} · {(i+1)*200} poeng</option>)}</select></label>}<label>Format<select value={draft.format} onChange={e=>patch({format:e.target.value as Format,readiness:"draft"})}>{FORMATS.map(f=><option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}</select></label><label>Utvalg<select value={draft.selection} onChange={e=>patch({selection:e.target.value as BankQuestion["selection"]})}>{["UNREVIEWED","PICK","MAYBE","REJECT"].map(v=><option key={v}>{v}</option>)}</select></label><label>Status<select value={draft.readiness} onChange={e=>patch({readiness:e.target.value as BankQuestion["readiness"]})}>{Object.entries(READY_LABELS).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div>
        <label>Spørsmål / ledetråd<textarea value={draft.prompt} onChange={e=>patch({prompt:e.target.value})}/></label><label>Fasit<input value={draft.answer} onChange={e=>patch({answer:e.target.value})}/></label><label>Godta også (ett svar per linje)<textarea value={draft.acceptedAlternatives.join("\n")} onChange={e=>patch({acceptedAlternatives:e.target.value.split("\n")})}/></label>
        {draft.format==="closest"&&<p>Alle lag leverer ett privat tall. Nærmest får poeng, lik avstand gir poeng til alle nærmeste. Tallfasit kan bruke komma eller punktum. Svarfrist: 30 sekunder.</p>}{draft.format==="progressive_image"&&<p>Last opp bildet. Verten avslører det i fire trinn med «Avslør mer av bildet». Poengverdien er fast.</p>}{draft.format==="private_choice"&&<label>Svaralternativer (ett per linje)<textarea value={(draft.choices??[]).join("\n")} onChange={e=>patch({choices:e.target.value.split("\n")})}/></label>}
        <label>Privat vertsnotat<textarea value={draft.hostNote??""} onChange={e=>patch({hostNote:e.target.value})}/></label>
        <fieldset><legend>Medier</legend><label>Bilde eller lyd (maks 15 MB)<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);}}/></label>{draft.media&&<><small>{draft.media.url}</small><button onClick={()=>patch({media:undefined})}>Fjern mediet fra spørsmålet</button></>}<label>Avsløringsbilde / lyd etter fasit<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f,true);}}/></label>{draft.revealMedia&&<><small>{draft.revealMedia.url}</small><button onClick={()=>patch({revealMedia:undefined})}>Fjern avsløringsmediet</button></>}</fieldset>
        <details><summary>Notater, kilde og opprinnelig format</summary><label>Dine notater<textarea value={draft.notes} onChange={e=>patch({notes:e.target.value})}/></label><label>Hva må lages av medier?<textarea value={draft.assetBrief} onChange={e=>patch({assetBrief:e.target.value})}/></label><label>Kilde<input value={draft.sourceUrl} onChange={e=>patch({sourceUrl:e.target.value})}/></label><p>Opprinnelig format: {draft.originalFormat||"Egendefinert"}</p></details>
        {readyProblems(draft).length>0&&<div className="bank-validation">{readyProblems(draft).map(p=><p key={p}>{p}</p>)}</div>}
        <div className="bank-actions"><button disabled={busy||(draft.readiness==="ready"&&readyProblems(draft).length>0)} onClick={()=>void commitDraft()}>Lagre spørsmål</button><button disabled={busy} onClick={()=>{setDraft(null);setOriginalId(null);}}>Avbryt endringer</button></div>
        <h3>Forhåndsvisning</h3><div className="bank-actions">{(["tv","phone","host"] as const).map(p=><button key={p} aria-pressed={preview===p} onClick={()=>setPreview(p)}>{p==="tv"?"TV":p==="phone"?"Mobil":"Vert"}</button>)}</div><QuestionPreview question={draft} surface={preview}/>
      </section>}
    </div>
  </main>;
}
function QuestionPreview({question:q,surface}:{question:BankQuestion;surface:"tv"|"phone"|"host"}) {
  const [reveal,setReveal]=useState(false);
  const [stage,setStage]=useState(0);
  useEffect(()=>setReveal(false),[q.id]);
  const media = reveal ? q.revealMedia ?? q.media : q.media;
  return <div className={`bank-preview bank-preview--${surface}`}><small>{surface==="host"?"Privat vertsskjerm":surface==="phone"?"Lagets mobil":"Felles TV"} · {q.category} · {questionPoints(q)} poeng</small>
    {surface!=="phone"&&<p>{q.prompt||"Spørsmålsteksten vises her"}</p>}
    {surface!=="phone"&&media?.url&&(media.type==="image"?<img style={q.format==="progressive_image" && !reveal && surface==="tv" ? {filter:`blur(${[18,10,4,0][stage]}px)`} : undefined} src={media.url} alt="Ledetråd"/>:<audio controls src={media.url}/>)}
    {surface==="phone"&&(q.format==="closest"?<label>Deres tall<input disabled placeholder="Privat tallgjetting"/></label>:q.format==="private_choice"?<div>{q.choices?.map((c,i)=><button key={i} disabled>{c||"Tomt alternativ"}</button>)}</div>:<button className="buzzer" disabled>BUZZ</button>)}
    {(surface==="host"||reveal)&&<p><b>Fasit:</b> {q.answer}{surface==="host"&&<><br/><small>{q.hostNote}</small></>}</p>}
    {surface==="tv"&&q.format==="progressive_image"&&<button onClick={()=>setStage((stage+1)%4)}>Test bildetrinn · {stage+1}/4</button>}
    {surface==="tv"&&<button onClick={()=>setReveal(!reveal)}>{reveal?"Skjul fasit":"Test avsløring"}</button>}
  </div>;
}
