import React, {useEffect, useRef, useState} from "react";

export default function LobbyMusic({musicUrl,paused}:{musicUrl:string;paused:boolean}) {
  const [enabled,setEnabled]=useState(false),[error,setError]=useState("");
  const [volume,setVolume]=useState(()=>{try{const value=Number(localStorage.getItem("trivia-lobby-volume")??.18);return Number.isFinite(value)?Math.max(0,Math.min(1,value)):.18;}catch{return .18;}});
  const audio=useRef<HTMLAudioElement>(null),gain=useRef<GainNode|null>(null);
  useEffect(()=>{if(audio.current)audio.current.volume=volume;if(gain.current)gain.current.gain.value=volume;try{localStorage.setItem("trivia-lobby-volume",String(volume));}catch{}},[volume]);
  useEffect(()=>{
    if(!enabled || paused)return;
    setError("");
    if(musicUrl){let stopped=false;const element=audio.current!;element.volume=volume;void element.play().catch(()=>{if(stopped)return;setError("Trykk Spill igjen for å aktivere lyd, eller sjekk musikkadressen.");setEnabled(false);});return ()=>{stopped=true;element.pause();};}
    // An original, quiet four-chord ambient loop. No streamed or licensed track.
    let stopped=false;
    const context=new AudioContext(),master=context.createGain();gain.current=master;master.gain.value=volume;master.connect(context.destination);
    const chords=[[261.63,329.63,392,493.88],[220,261.63,329.63,392],[174.61,220,261.63,329.63],[196,261.63,293.66,392]];
    function phrase(){if(stopped)return;const start=context.currentTime+.05;chords.forEach((chord,index)=>chord.forEach((frequency,note)=>{
      const oscillator=context.createOscillator(),envelope=context.createGain(),time=start+index*2+note*.22;
      oscillator.type="sine";oscillator.frequency.value=frequency;
      oscillator.connect(envelope);envelope.connect(master);envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(.09,time+.08);envelope.gain.exponentialRampToValueAtTime(.0001,time+2.2);
      oscillator.start(time);oscillator.stop(time+2.3);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();};
    }));}
    void context.resume().then(phrase).catch(()=>{if(stopped)return;setError("Nettleseren trenger et nytt trykk for å starte musikken.");setEnabled(false);});
    const timer=window.setInterval(phrase,8000);
    return ()=>{stopped=true;window.clearInterval(timer);gain.current=null;void context.close();};
  },[enabled,paused,musicUrl]);
  return <div className="lobby-music"><button className="btn ghost" disabled={paused} onClick={()=>setEnabled(!enabled)}>{enabled ? "Stopp lobby-musikk" : "Spill lobby-musikk"}</button><label>Volum <input aria-label="Volum for lobby-musikk" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>{musicUrl&&<audio ref={audio} src={musicUrl} loop preload="none" onError={()=>{setError("Kunne ikke spille musikkfilen. Sjekk adressen i vertspanelet.");setEnabled(false);}}/>}{error&&<small role="status">{error}</small>}</div>;
}
