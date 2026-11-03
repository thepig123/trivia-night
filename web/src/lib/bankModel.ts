import type { Question } from "../types";
export const FORMATS = ["text", "emoji", "image", "audio", "private_choice", "closest", "sorting", "list", "wager", "progressive_image", "timer"] as const;
export type Format = typeof FORMATS[number];
export interface BankQuestion extends Question {
  format: Format;
  selection: "PICK" | "MAYBE" | "REJECT" | "UNREVIEWED";
  readiness: "draft" | "needs_assets" | "ready" | "archived";
  source: string; sourceUrl: string; assetBrief: string; notes: string; originalFormat: string;
  revealMedia?: {type:"image" | "audio"; url:string};
}
export interface QuestionPack { id: string; name: string; questionIds: string[]; finalQuestionIds?: string[] }
export interface QuestionBank { version: 1; revision: number; questions: BankQuestion[]; packs: QuestionPack[]; activePackId: string }
export const FORMAT_LABELS: Record<Format,string> = { text:"Tekst / åpen buzzer", emoji:"Emoji / åpen buzzer", image:"Bilde / åpen buzzer", audio:"Lyd / åpen buzzer", private_choice:"Privat flervalg", closest:"Nærmest (utkast)", sorting:"Sortering (utkast)", list:"Nevn flere (utkast)", wager:"Innsats (utkast)", progressive_image:"Progressivt bilde (utkast)", timer:"Presisjonsduell (utkast)" };
export const READY_LABELS = {draft:"Utkast",needs_assets:"Trenger medier",ready:"Klar",archived:"Arkivert"};
export function readyProblems(q: BankQuestion): string[] {
  const errors: string[] = [];
  if (!q.category.trim() || !q.prompt.trim() || !q.answer.trim()) errors.push("Fyll ut kategori, spørsmål og fasit.");
  if (!["text","emoji","image","audio","private_choice"].includes(q.format)) errors.push("Spillmekanikken er ikke implementert ennå. Lagre som utkast.");
  if (["image","audio"].includes(q.format) && (!q.media?.url || q.media.type !== q.format)) errors.push("Legg til riktig bilde eller lydfil.");
  if (q.format === "private_choice" && (new Set((q.choices ?? []).filter(c => c.trim())).size < 2 || (q.choices ?? []).some(c => !c.trim()) || !q.choices?.includes(q.answer))) errors.push("Legg til minst to alternativer. Ett må være identisk med fasiten.");
  return errors;
}
export function isPlayable(q: BankQuestion) { return q.selection === "PICK" && q.readiness === "ready" && readyProblems(q).length === 0; }
export function uniqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
}
export function newQuestion(): BankQuestion {
  return {id:`CUSTOM-${uniqueId()}`,category:"Gutta",subcategory:"",tier:"T3",prompt:"",answer:"",acceptedAlternatives:[],hostNote:"",status:"unused",format:"text",selection:"UNREVIEWED",readiness:"draft",source:"custom",sourceUrl:"",assetBrief:"",notes:"",originalFormat:"",mode:"buzzer"};
}
// RFC 4180-style parser: quoted newlines, commas and doubled quotes are preserved.
export function parseCsv(text: string): string[][] {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/,1)[0];
  const separator = /^(?:ID|id|SELECT);/.test(header) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (!quoted && value.length) throw new Error("Ugyldig CSV: anførselstegn midt i et felt.");
      else quoted = !quoted;
    } else if (!quoted && c === separator) { row.push(value); value = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i+1] === "\n") i++;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Ugyldig CSV: et sitert felt er ikke avsluttet.");
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export const CSV_FIELDS = ["id","category","subcategory","tier","format","selection","readiness","prompt","answer","acceptedAlternatives","choices","hostNote","media","revealMedia","source","sourceUrl","assetBrief","notes","originalFormat"] as const;
export function exportCsv(questions: BankQuestion[]) {
  const cell = (v: unknown) => '"' + String(v ?? "").replace(/"/g,'""') + '"';
  return "\uFEFF" + [CSV_FIELDS.join(","), ...questions.map(q => CSV_FIELDS.map(field => cell(Array.isArray(q[field]) || typeof q[field] === "object" ? JSON.stringify(q[field]) : q[field])).join(","))].join("\r\n");
}
export function importQuestions(text: string, json: boolean): BankQuestion[] {
  if (json) {
    const value = JSON.parse(text); const qs = Array.isArray(value) ? value : value.questions;
    if (!Array.isArray(qs)) throw new Error("JSON må inneholde en spørsmålsliste eller en eksportert bank.");
    if (!Array.isArray(value) && value.version !== 1) throw new Error("Ukjent bankversjon.");
    if (qs.some(q => !q || typeof q !== "object" || typeof q.id !== "string" || !q.id.trim())) throw new Error("Hvert spørsmål må ha en stabil ID.");
    return qs.map(q => ({...newQuestion(), ...q}));
  }
  const rows = parseCsv(text); const headers = rows.shift();
  if (!headers) throw new Error("CSV-filen er tom.");
  const has = (field: string) => headers.includes(field);
  if (!(has("id") || has("ID")) || !(has("prompt") || has("QUESTION / PROMPT"))) throw new Error("Bruk CSV-eksporten fra banken eller QUESTION BANK-arket med ID og QUESTION / PROMPT.");
  const legacy: Record<string,string> = {ID:"id",CATEGORY:"category",SUBCATEGORY:"subcategory",TIER:"tier",SELECT:"selection","QUESTION / PROMPT":"prompt",ANSWER:"answer","ACCEPTED ANSWERS":"acceptedAlternatives","HOST NOTES":"hostNote","SOURCE URL":"sourceUrl","ASSET BRIEF":"assetBrief","YOUR NOTES":"notes",FORMAT:"originalFormat"};
  return rows.map(cells => {
    const q: any = newQuestion();
    headers.forEach((header,i) => {
      const key = legacy[header] ?? header; const value = cells[i] ?? "";
      if (!CSV_FIELDS.includes(key as any)) return;
      if (["acceptedAlternatives","choices"].includes(key)) q[key] = value.startsWith("[") ? JSON.parse(value) : value.split(";").map(x=>x.trim()).filter(Boolean);
      else if (["media","revealMedia"].includes(key)) { if(value) q[key] = JSON.parse(value); }
      else q[key] = value;
    });
    if (!has("format")) {
      const f = q.originalFormat.toLowerCase();
      q.format = /sort/.test(f) ? "sorting" : /nærmest/.test(f) ? "closest" : /budrunde/.test(f) ? "list" : /risiko/.test(f) ? "wager" : /timer/.test(f) ? "timer" : /lyd/.test(f) ? "audio" : /emoji/.test(f) ? "emoji" : /bilde|kart/.test(f) ? "image" : "text";
      q.readiness = ["image","audio"].includes(q.format) ? "needs_assets" : ["text","emoji"].includes(q.format) ? "ready" : "draft";
      q.source = "spreadsheet";
    }
    return q as BankQuestion;
  });
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+stable(v)).join(",") + "}";
  return JSON.stringify(value);
}
export function mergeQuestions(current: BankQuestion[], incoming: BankQuestion[]) {
  const ids = new Set<string>();
  for (const q of incoming) { if (!q.id?.trim() || ids.has(q.id)) throw new Error(`Duplikat eller tom ID i import: ${q.id}`); ids.add(q.id); }
  const merged = new Map(current.map(q => [q.id,q]));
  const added: string[] = [], changed: string[] = [], unchanged: string[] = [];
  for (const q of incoming) {
    const previous = merged.get(q.id);
    if (!previous) added.push(q.id);
    else if (stable(previous) !== stable(q)) changed.push(q.id);
    else unchanged.push(q.id);
    merged.set(q.id,q);
  }
  return {questions:[...merged.values()],added,changed,unchanged};
}

export function packSummary(bank: QuestionBank, pack: QuestionPack) {
  const members=bank.questions.filter(q=>pack.questionIds.includes(q.id));
  const playable=members.filter(isPlayable);
  const final=playable.filter(q=>(pack.finalQuestionIds??[]).includes(q.id));
  const route=playable.filter(q=>!final.includes(q));
  const categories=[...new Set(members.map(q=>q.category))].sort().map(category=>({category,total:members.filter(q=>q.category===category).length,ready:route.filter(q=>q.category===category).length}));
  const tiers=["T5","T4","T3","T2","T1"].map(tier=>({tier,count:route.filter(q=>q.tier===tier && q.category.trim().toLowerCase()!=="gutta").length}));
  const formats=FORMATS.map(format=>({format,count:playable.filter(q=>q.format===format).length})).filter(row=>row.count);
  return {members,playable,final,route,categories,tiers,formats,blocked:members.filter(q=>!isPlayable(q)),missingAssets:members.filter(q=>q.readiness==="needs_assets" || (["image","audio","progressive_image"].includes(q.format) && !q.media?.url))};
}
