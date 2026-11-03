import { useEffect, useRef, useState } from "react";
import type { GameFeedback } from "../types";
let volume = .5;
let context: AudioContext | null = null;
export async function enableAnswerCue() {
  context ??= new AudioContext();
  await context.resume();
}
function chime(frequencies: number[] = [660,440]) {
  if (!context || context.state !== "running" || volume<=0) return;
  const start=context.currentTime;
  for(const [index,frequency] of frequencies.entries()) {
    const offset=index*.16;
    const oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.connect(gain);gain.connect(context.destination);
    oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,start+offset);
    gain.gain.linearRampToValueAtTime(.18*volume,start+offset+.015);
    gain.gain.exponentialRampToValueAtTime(.001*volume,start+offset+.2);
    oscillator.start(start+offset);oscillator.stop(start+offset+.22);
  }
}
export function useAnswerCue(warningId: string | null | undefined, feedback?:GameFeedback|null) {
  const [soundVolume,setSoundVolume]=useState(()=>{try{const stored=Number(localStorage.getItem("trivia-tv-volume")??.5);return Number.isFinite(stored)?Math.max(0,Math.min(1,stored)):.5;}catch{return .5;}});
  useEffect(()=>{volume=soundVolume;localStorage.setItem("trivia-tv-volume",String(soundVolume));},[soundVolume]);
  const lastFeedback=useRef(feedback?.id);
  useEffect(()=>{
    if(!feedback || feedback.id===lastFeedback.current)return;
    lastFeedback.current=feedback.id;
    if(Date.now()-feedback.createdAt>4000)return;
    const notes=feedback.kind === "wrong" ? [220,165] : feedback.kind === "correct" ? [523,659,784] : [523,659,784,1047];
    chime(notes);
  },[feedback?.id]);
  const [enabled,setEnabled]=useState(false);
  const last=useRef<string|null|undefined>(undefined);
  useEffect(()=>{
    if(warningId===undefined)return;
    if(last.current!==undefined && warningId && warningId!==last.current)chime();
    last.current=warningId;
  },[warningId]);
  return {enabled,volume:soundVolume,setVolume:setSoundVolume,enable:async()=>{try {await enableAnswerCue();setEnabled(true);}catch{setEnabled(false);}}};
}
