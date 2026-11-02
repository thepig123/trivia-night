import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BankStore, playableQuestions, validateBank } from "./bank.js";
import { GameEngine } from "./gameState.js";

function sampleBank(store: BankStore) {
  const bank=store.get();
  bank.questions=[{id:"FIXTURE",category:"Generelt",tier:"T5",prompt:"Hva er 2 + 2?",answer:"4",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}];
  bank.packs[0].questionIds=["FIXTURE"];
  return bank;
}
test("fresh bank contains no private content and only ready picks enter rooms", () => {
  const dir=mkdtempSync(join(tmpdir(),"trivia-bank-"));
  try {
    const store=new BankStore(join(dir,"bank.json"));
    assert.equal(store.get().questions.length,0);
    const bank=sampleBank(store);
    bank.questions.push({...bank.questions[0],id:"DRAFT",readiness:"draft"},{...bank.questions[0],id:"MAYBE",selection:"MAYBE"},{...bank.questions[0],id:"ARCHIVE",readiness:"archived"});
    bank.packs[0].questionIds=bank.questions.map(q=>q.id);
    assert.deepEqual(playableQuestions(bank).map(q=>q.id),["FIXTURE"]);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("bank edits survive restart and stale writes cannot overwrite another edit", () => {
  const dir=mkdtempSync(join(tmpdir(),"trivia-bank-"));const path=join(dir,"bank.json");
  try {
    const store=new BankStore(path);const stale=store.get();const update=sampleBank(store);
    update.questions[0].prompt="Redigert spørsmål";
    store.save(update);
    assert.equal(new BankStore(path).get().questions[0].prompt,"Redigert spørsmål");
    assert.throws(()=>store.save(stale),/annet vindu/);
    assert.equal(store.get().revision,2);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("unsupported formats, missing media and invalid private choices cannot be marked ready", () => {
  const dir=mkdtempSync(join(tmpdir(),"trivia-bank-"));
  try {
    const bank=sampleBank(new BankStore(join(dir,"bank.json")));const q=bank.questions[0];q.readiness="ready";
    q.format="sorting";assert.throws(()=>validateBank(bank),/utkast/);
    q.format="audio";assert.throws(()=>validateBank(bank),/mediefil/);
    q.format="private_choice";q.choices=["A","B"];q.answer="C";assert.throws(()=>validateBank(bank),/fasiten/);
    q.answer="A";assert.doesNotThrow(()=>validateBank(bank));
    bank.questions.push(structuredClone(q));assert.throws(()=>validateBank(bank),/Duplikat/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("room snapshots ignore later bank edits and route categories come from the selected pack", () => {
  const pool=[{id:"CUSTOM",category:"Gutta: ferie",tier:"T4" as const,prompt:"Hvem sa det?",answer:"Rune",acceptedAlternatives:[],status:"unused" as const,mode:"private_choice" as const,choices:["Rune","Lasse"]}];
  const game=new GameEngine("SNAPSHOT",pool);
  pool[0].answer="Lasse";pool[0].choices.push("Mathias");
  assert.equal(game.questionPool[0].answer,"Rune");assert.deepEqual(game.questionPool[0].choices,["Rune","Lasse"]);
  assert.ok(game.map.nodes.filter(n=>n.tier).every(n=>n.category==="Gutta: ferie"&&n.tier==="T4"));
  const team=game.addTeam("A"); game.activateCurrentNode();game.startReading();game.openBuzzers();
  assert.equal(game.registerBuzz(team.id),false);
  game.submitFriendAnswer(team.id,"Rune");
  assert.deepEqual(game.toPublicState().friendAnswersSubmitted,[team.id]);
  assert.equal(JSON.stringify(game.toPublicState()).includes('"answer":"Rune"'),false);
  game.revealFriendAnswers();assert.equal(team.score,400);assert.equal(game.toPublicState().revealedQuestion?.answer,"Rune");
});
