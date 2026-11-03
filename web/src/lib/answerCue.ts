import { useEffect, useRef, useState } from "react";
let context: AudioContext | null = null;
export async function enableAnswerCue() {
  context ??= new AudioContext();
  await context.resume();
}
function chime() {
  if (!context || context.state !== "running") return;
  const start=context.currentTime;
  for(const [offset,frequency] of [[0,660],[.22,440]]) {
    const oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.connect(gain);gain.connect(context.destination);
    oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,start+offset);
    gain.gain.linearRampToValueAtTime(.18,start+offset+.015);
    gain.gain.exponentialRampToValueAtTime(.001,start+offset+.2);
    oscillator.start(start+offset);oscillator.stop(start+offset+.22);
  }
}
export function useAnswerCue(warningId: string | null | undefined) {
  const [enabled,setEnabled]=useState(false);
  const last=useRef<string|null|undefined>(undefined);
  useEffect(()=>{
    if(warningId===undefined)return;
    if(last.current!==undefined && warningId && warningId!==last.current)chime();
    last.current=warningId;
  },[warningId]);
  return {enabled,enable:async()=>{try {await enableAnswerCue();setEnabled(true);}catch{setEnabled(false);}}};
}
