import test from "node:test";
import assert from "node:assert/strict";
import { newQuestion, exportCsv, importQuestions, mergeQuestions, parseCsv } from "./src/lib/bankModel.js";

test("spreadsheet CSV round-trip keeps multiline notes, Unicode, choices and media", () => {
  const q={...newQuestion(),id:"GUT-001",prompt:'Hvem sa "hei, gutta"?\n🧊',answer:"Rune",acceptedAlternatives:["R"],choices:["Rune","Lasse"],notes:"Linje 1\nLinje 2; og komma,",media:{type:"image" as const,url:"/media/photo.jpg"}};
  const imported=importQuestions(exportCsv([q]),false);
  assert.deepEqual(imported,[q]);
  assert.deepEqual(mergeQuestions([q],imported).unchanged,[q.id]);
});
test("reviewed spreadsheet columns retain selection, ID and host notes", () => {
  const csv='SELECT;ID;CATEGORY;TIER;FORMAT;QUESTION / PROMPT;ANSWER;HOST NOTES\nPICK;GAM-001;Gaming;T5;Åpen buzzer;Spørsmål?;Svar;Privat notat';
  const q=importQuestions(csv,false)[0];
  assert.equal(q.id,"GAM-001");assert.equal(q.selection,"PICK");assert.equal(q.readiness,"ready");assert.equal(q.hostNote,"Privat notat");
});
test("imports preview upserts without deleting existing records and reject duplicate IDs", () => {
  const first={...newQuestion(),id:"A"};const second={...newQuestion(),id:"B"};
  const plan=mergeQuestions([first],[{...first,prompt:"Endret"},second]);
  assert.deepEqual(plan.changed,["A"]);assert.deepEqual(plan.added,["B"]);assert.equal(plan.questions.length,2);
  assert.throws(()=>mergeQuestions([], [first,first]),/Duplikat/);
  assert.throws(()=>importQuestions('[ {"prompt":"Mangler ID"} ]',true),/stabil ID/);
  assert.throws(()=>parseCsv('id,prompt\nA,"ikke avsluttet'),/avsluttet/);
});

import {packSummary} from "./src/lib/bankModel.js";
test("pack overview counts only playable pack members and separates reserved finals",()=>{
  const ready={...newQuestion(),prompt:"Q",answer:"A",selection:"PICK" as const,readiness:"ready" as const};
  const questions=[{...ready,id:"A"},{...ready,id:"F"},{...ready,id:"D",readiness:"needs_assets" as const},{...ready,id:"OUT"}];
  const pack={id:"P",name:"Evening",questionIds:["A","F","D"],finalQuestionIds:["F"]};
  const summary=packSummary({version:1,revision:1,questions,packs:[pack],activePackId:"P"},pack);
  assert.deepEqual(summary.route.map(q=>q.id),["A"]);assert.deepEqual(summary.final.map(q=>q.id),["F"]);
  assert.equal(summary.blocked.length,1);assert.equal(summary.missingAssets.length,1);
});

test("pack overview keeps playoff and grand-final reservations out of main coverage",()=>{
  const q={...newQuestion(),prompt:"Q",answer:"A",selection:"PICK" as const,readiness:"ready" as const};
  const pack={id:"P",name:"Evening",questionIds:["M","Q","F"],playoffQuestionIds:["Q"],finalQuestionIds:["F"]};
  const summary=packSummary({version:1,revision:1,questions:[{...q,id:"M"},{...q,id:"Q"},{...q,id:"F"}],packs:[pack],activePackId:"P"},pack);
  assert.deepEqual(summary.route.map(q=>q.id),["M"]);assert.deepEqual(summary.playoff.map(q=>q.id),["Q"]);assert.deepEqual(summary.final.map(q=>q.id),["F"]);
});
