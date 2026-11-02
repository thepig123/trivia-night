import { useEffect, useMemo, useState } from "react";
import type { QuestionClock } from "../types";

export default function GameClock({clock,paused}:{clock:QuestionClock;paused:boolean}) {
  const [now,setNow]=useState(Date.now);
  const receivedAt=useMemo(()=>Date.now(),[clock]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),100);return()=>window.clearInterval(timer);},[]);
  if(!clock?.kind) return clock?.answerStarted ? <div className="game-clock">Svaret er i gang</div> : null;
  const remaining=Math.max(0,clock.remainingMs-(paused?0:Math.max(0,now-receivedAt)));
  return <div className={`game-clock ${remaining<=5000?"game-clock--urgent":""}`} role="timer"><span>{clock.kind==="answer"?"Begynn å svare":"Tid igjen"}</span><strong>{Math.ceil(remaining/1000)} s</strong>{paused&&<span>Pause</span>}</div>;
}
