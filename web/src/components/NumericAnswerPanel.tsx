import React, { useState } from "react";
import { numericAnswer } from "../types";
export default function NumericAnswerPanel({disabled,submitted,onSubmit}:{disabled:boolean;submitted:boolean;onSubmit:(answer:string)=>void}) {
  const [answer,setAnswer]=useState("");
  return <form className="friend-answer-panel" onSubmit={e=>{e.preventDefault();if(!disabled && !submitted && numericAnswer(answer)!==null)onSubmit(answer.trim());}}>
    <h3>Hvilket tall tror dere?</h3><p>Nærmest fasiten vinner. Svaret er privat frem til avsløringen.</p>
    <label className="field">Deres tall<input aria-label="Deres tall" inputMode="decimal" value={answer} disabled={disabled||submitted} onChange={e=>setAnswer(e.target.value)} placeholder="Skriv et tall" autoComplete="off"/></label>
    <button className="btn teal" disabled={disabled||submitted||numericAnswer(answer)===null}>{submitted ? "Svar levert og låst" : "Lås svaret"}</button>
    {submitted && <p>Venter på avsløringen…</p>}
  </form>;
}
