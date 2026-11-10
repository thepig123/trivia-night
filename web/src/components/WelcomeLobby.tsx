import React, {useEffect, useState} from "react";
import QRCode from "qrcode";
import type {PublicGameState} from "../types";
import {joinLink} from "../lib/joinLink";
import LobbyMusic from "./LobbyMusic";
export default function WelcomeLobby({state,origin}:{state:PublicGameState;origin:string}) {
  const link=joinLink(state.lobby.joinUrl,origin,state.roomCode),[qr,setQr]=useState(""),[qrError,setQrError]=useState(false);
  useEffect(()=>{let cancelled=false;setQr("");setQrError(false);if(link)void QRCode.toDataURL(link,{width:320,margin:4,errorCorrectionLevel:"M"}).then(data=>{if(!cancelled)setQr(data);}).catch(()=>{if(!cancelled)setQrError(true);});return ()=>{cancelled=true;};},[link]);
  return <section className="welcome-lobby" aria-label="Velkommen til quiz med gutta">
    <div className="welcome-lobby__intro"><small>VELKOMMEN TIL KVELDENS QUIZ</small><h1>{state.lobby.title}</h1><p>Finn en lagkamerat. Velg et navn.<br/>Gjør dere klare for heder og skryterettigheter.</p><div className="welcome-lobby__code"><span>ROMKODE</span><strong>{state.roomCode}</strong></div><LobbyMusic musicUrl={state.lobby.musicUrl} paused={state.paused}/></div>
    <div className="welcome-lobby__join"><h2>Skann og bli med</h2>{qr?<img src={qr} width="320" height="320" alt="QR-kode til lagpåmelding"/>:<div className="welcome-lobby__qr-placeholder">{link?(qrError?"QR kunne ikke lages. Bruk lenken nedenfor.":"Lager QR-kode…"):"Legg inn Vercel-adressen eller en adresse på lokalnettet i vertspanelet."}</div>}{link&&<a href={link} target="_blank" rel="noreferrer">{link}</a>}<p>Én telefon per lag · to spillere</p></div>
    <div className="welcome-lobby__teams"><h2>{state.teams.length ? `${state.teams.length} lag i lobbyen` : "Hvem blir først inn?"}</h2><div>{state.teams.map(team=><article key={team.id} style={{borderColor:team.color}}><h3 style={{color:team.color}}>{team.name}</h3><p>{team.players.join(" & ")}</p><small>{team.connected?"● Tilkoblet":"○ Venter på tilkobling"}</small></article>)}</div><p>Verten starter når alle er klare.</p></div>
  </section>;
}
