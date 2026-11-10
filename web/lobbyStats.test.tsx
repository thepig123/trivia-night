import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {joinLink, roomFromQuery} from "./src/lib/joinLink.js";
import WelcomeLobby from "./src/components/WelcomeLobby.js";
import PauseOverlay from "./src/components/PauseOverlay.js";
import StatisticsPanel, {statisticsCsv} from "./src/components/StatisticsPanel.js";
import PlayoffSummary from "./src/components/PlayoffSummary.js";
import {GameEngine} from "../server/src/gameState.js";

test("joining links use the configured Vercel origin, prefill room codes and reject unsafe or phone-local URLs",()=>{
  const value=joinLink("https://quiz.vercel.app","http://localhost:5173","ABCDE")!;const url=new URL(value);
  assert.equal(url.origin,"https://quiz.vercel.app");assert.equal(url.pathname,"/join");assert.equal(roomFromQuery(url.search),"ABCDE");
  assert.equal(joinLink("","http://localhost:5173","ABCDE"),null);
  assert.equal(joinLink("javascript:alert(1)","https://quiz.example","ABCDE"),null);
  assert.equal(joinLink("https://user:secret@example.com","https://quiz.example","ABCDE"),null);
  assert.equal(new URL(joinLink("","http://192.168.1.2:5173","ABCDE")!).pathname,"/join");
  assert.equal(roomFromQuery("?room=abcde"),"ABCDE");assert.equal(roomFromQuery("?room=too-long"),"");
});

test("welcome lobby renders the requested title, joining instructions and live team roster",()=>{
  const game=new GameEngine("ABCDE");const a=game.addTeam("Guttabois");a.players=["Rune","Lasse"];
  game.configureLobby("quiz med gutta","https://quiz.vercel.app","");
  const html=renderToStaticMarkup(<WelcomeLobby state={game.toPublicState()} origin="http://localhost:5173"/>);
  assert.match(html,/<h1>quiz med gutta<\/h1>/);assert.match(html,/Skann og bli med/);assert.match(html,/quiz.vercel.app\/join\?room=ABCDE/);assert.match(html,/Rune &amp; Lasse/);assert.match(html,/Spill lobby-musikk/);
  assert.equal(renderToStaticMarkup(<PauseOverlay paused={false}/>),"");
  const pause=renderToStaticMarkup(<PauseOverlay paused/>);assert.match(pause,/role="dialog"/);assert.match(pause,/>PAUSE</);assert.match(pause,/Verten fortsetter/);
});

test("statistics render honest empty values and export summary rows without question answers",()=>{
  const game=new GameEngine("ABCDE");game.addTeam("=SUM(1;2)");
  const statistics=game.toHostState().statistics;
  const html=renderToStaticMarkup(<StatisticsPanel statistics={statistics} teams={game.teams}/>);
  assert.match(html,/Snitt/);assert.match(html,/Raskest/);assert.match(html,/Tregest/);assert.doesNotMatch(html,/NaN|Infinity|0,00 s/);
  const csv=statisticsCsv(statistics,game.teams);assert.ok(csv.startsWith("\uFEFF"));assert.match(csv,/'=SUM/);assert.match(csv,/Snitt buzz ms/);assert.doesNotMatch(csv,/acceptedAlternatives|questionPool|prompt/);
});

test("playoff summary shows head starts separately from actual correct answers",()=>{
  const game=new GameEngine("ABCDE");const a=game.addTeam("First"),b=game.addTeam("Leading"),c=game.addTeam("Trailing");a.score=10000;b.score=9000;c.score=4000;game.setTargetScore(10000);game.playoffState!.scores[b.id]=2;
  const html=renderToStaticMarkup(<PlayoffSummary state={game.toPublicState()}/>);
  assert.match(html,/4 poeng/);assert.match(html,/2 riktige \+ 2 i forsprang/);assert.match(html,/maks \+2/);
});
