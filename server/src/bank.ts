import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import seed from "./data/question-bank.json" with { type: "json" };
import { isGutta, numericAnswer } from "./types.js";
import type { Question } from "./types.js";

export const FORMATS = ["text", "emoji", "image", "audio", "private_choice", "closest", "sorting", "list", "wager", "progressive_image", "timer"] as const;
export type Format = typeof FORMATS[number];
export interface BankQuestion extends Question {
  format: Format;
  selection: "PICK" | "MAYBE" | "REJECT" | "UNREVIEWED";
  readiness: "draft" | "needs_assets" | "ready" | "archived";
  source: string;
  sourceUrl: string;
  assetBrief: string;
  notes: string;
  originalFormat: string;
  revealMedia?: { type: "image" | "audio"; url: string };
}
export interface QuestionPack { id: string; name: string; questionIds: string[]; finalQuestionIds?: string[] }
export interface QuestionBank { version: 1; revision: number; questions: BankQuestion[]; packs: QuestionPack[]; activePackId: string }
export const SUPPORTED_FORMATS: Format[] = ["text", "emoji", "image", "audio", "private_choice", "closest", "progressive_image"];
export function readyProblems(q: BankQuestion): string[] {
  const problems: string[] = [];
  if (!q.prompt.trim() || !q.answer.trim() || !q.category.trim()) problems.push("Spørsmål, fasit og kategori må fylles ut.");
  if (!SUPPORTED_FORMATS.includes(q.format)) problems.push("Dette formatet er foreløpig bare tilgjengelig som utkast.");
  if (q.format === "image" || q.format === "audio") {
    if (!q.media?.url || q.media.type !== q.format) problems.push("Last opp riktig mediefil før spørsmålet er klart.");
  }
  if (q.format === "closest" && numericAnswer(q.answer) === null) problems.push("Nærmest trenger en gyldig tallfasit (punktum eller komma, maks 15 sifre).");
  if (q.format === "progressive_image" && (!q.media?.url || q.media.type !== "image")) problems.push("Last opp et bilde til den progressive avsløringen.");
  if (q.format === "private_choice" && (!q.choices || new Set(q.choices.filter(c => c.trim())).size < 2 || q.choices.some(c => !c.trim()) || !q.choices.includes(q.answer))) problems.push("Flervalg trenger minst to alternativer, inkludert fasiten.");
  return problems;
}
function string(value: unknown, field: string, max = 20000): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Ugyldig ${field}.`);
}
export function validateBank(value: unknown): QuestionBank {
  if (!value || typeof value !== "object") throw new Error("Ugyldig spørsmålsbank.");
  const bank = structuredClone(value) as QuestionBank;
  if (bank.version !== 1 || !Number.isSafeInteger(bank.revision) || bank.revision < 1 || !Array.isArray(bank.questions) || bank.questions.length > 10000 || !Array.isArray(bank.packs) || !bank.packs.length) throw new Error("Ugyldig bankversjon, revisjon eller innhold.");
  const ids = new Set<string>();
  for (const q of bank.questions) {
    for (const field of ["id", "category", "prompt", "answer", "source", "sourceUrl", "assetBrief", "notes", "originalFormat"] as const) string(q[field], field);
    if (!q.id.trim() || ids.has(q.id)) throw new Error(`Duplikat eller tom ID: ${q.id}`);
    ids.add(q.id);
    if(isGutta(q.category))q.tier="T3";
    if (!["T1","T2","T3","T4","T5"].includes(q.tier) || !FORMATS.includes(q.format) || !["PICK","MAYBE","REJECT","UNREVIEWED"].includes(q.selection) || !["draft","needs_assets","ready","archived"].includes(q.readiness)) throw new Error(`Ugyldige felt for ${q.id}.`);
    for (const list of [q.acceptedAlternatives, q.choices ?? []]) if (!Array.isArray(list) || list.some(item => typeof item !== "string")) throw new Error(`Ugyldige svaralternativer: ${q.id}`);
    if (q.hostNote !== undefined) string(q.hostNote, "vertsnotat");
    for (const media of [q.media, q.revealMedia]) if (media) {
      if (!["image","audio","video"].includes(media.type)) throw new Error("Ugyldig medietype.");
      string(media.url, "medieadresse", 2000);
      if (media.url && !/^\/media\/[a-zA-Z0-9._-]+$/.test(media.url) && !/^https?:\/\//.test(media.url)) throw new Error("Medier må være opplastet eller ha en HTTP(S)-adresse.");
    }
    if (q.readiness === "ready" && readyProblems(q).length) throw new Error(`${q.id}: ${readyProblems(q).join(" ")}`);
    q.status = "unused";
    q.mode = q.format === "closest" ? "closest" : q.format === "private_choice" ? "private_choice" : "buzzer";
    q.progressiveImage = q.format === "progressive_image";
  }
  const packs = new Set<string>();
  for (const pack of bank.packs) {
    string(pack.id, "pakke-ID"); string(pack.name, "pakkenavn");
    if (!pack.id || !pack.name.trim() || packs.has(pack.id) || !Array.isArray(pack.questionIds) || pack.questionIds.some(id => !ids.has(id))) throw new Error("Ugyldig kveldspakke.");
    if (pack.finalQuestionIds !== undefined && (!Array.isArray(pack.finalQuestionIds) || pack.finalQuestionIds.some(id=>!pack.questionIds.includes(id)))) throw new Error("Finalespørsmål må være med i kveldspakken.");
    pack.finalQuestionIds = [...new Set(pack.finalQuestionIds ?? [])];
    pack.questionIds = [...new Set(pack.questionIds)]; packs.add(pack.id);
  }
  if (!packs.has(bank.activePackId)) throw new Error("Velg en gyldig kveldspakke.");
  return bank;
}
export function playableQuestions(bank: QuestionBank): Question[] {
  const selected = new Set(bank.packs.find(pack => pack.id === bank.activePackId)!.questionIds);
  return bank.questions.filter(q => selected.has(q.id) && q.selection === "PICK" && q.readiness === "ready" && !readyProblems(q).length).map(q => ({...structuredClone(q), progressiveImage:q.format === "progressive_image", mode: q.format === "closest" ? "closest" : q.format === "private_choice" ? "private_choice" : "buzzer", status: "unused"}));
}
export class BankStore {
  private bank: QuestionBank;
  constructor(private path = resolve(process.env.BANK_DATA_DIR ?? fileURLToPath(new URL("../runtime/", import.meta.url)), "question-bank.json")) {
    try { this.bank = validateBank(JSON.parse(readFileSync(path, "utf8"))); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; this.bank = validateBank(seed); }
  }
  get() { return structuredClone(this.bank); }
  save(value: unknown) {
    const next = validateBank(value);
    if (next.revision !== this.bank.revision) throw new Error("Banken er endret i et annet vindu. Last inn på nytt før du lagrer.");
    next.revision++;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(next, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
    this.bank = next;
    return this.get();
  }
}
