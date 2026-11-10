import React, {useEffect, useState} from "react";
import type {ClientMessage, HostGameState} from "../types";
export default function LobbySettings({state,send,connected}:{state:HostGameState;send:(message:ClientMessage)=>void;connected:boolean}) {
  const [title,setTitle]=useState(state.lobby.title),[joinUrl,setJoinUrl]=useState(state.lobby.joinUrl),[musicUrl,setMusicUrl]=useState(state.lobby.musicUrl);
  useEffect(()=>{setTitle(state.lobby.title);setJoinUrl(state.lobby.joinUrl);setMusicUrl(state.lobby.musicUrl);},[state.lobby.title,state.lobby.joinUrl,state.lobby.musicUrl]);
  return <details className="card" open={state.phase==="lobby"}><summary>Velkomstskjerm og QR</summary><form className="lobby-settings" onSubmit={e=>{e.preventDefault();send({type:"host:configure_lobby",roomCode:state.roomCode,title,joinUrl:joinUrl.trim(),musicUrl:musicUrl.trim()});}}>
    <label className="field">Overskrift<input value={title} maxLength={80} required disabled={state.phase!=="lobby"} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="field">Deltakeradresse · Vercel eller lokalnett<input type="url" value={joinUrl} placeholder="https://ditt-navn.vercel.app" disabled={state.phase!=="lobby"} onChange={e=>setJoinUrl(e.target.value)}/></label><small>QR fyller inn romkoden. La feltet stå tomt for samme nettside som TV-en; localhost kan ikke brukes fra telefonene.</small>
    <label className="field">Egen lobby-musikk · valgfri lydadresse<input value={musicUrl} placeholder="https://…/musikk.mp3 eller /media/…" disabled={state.phase!=="lobby"} onChange={e=>setMusicUrl(e.target.value)}/></label><small>Uten egen fil brukes en rolig innebygd ambient-løkke. Start musikken på TV-skjermen.</small>
    <button className="btn teal" disabled={!connected||state.phase!=="lobby"}>Lagre velkomstskjerm</button>
  </form></details>;
}
