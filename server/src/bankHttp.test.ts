import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

function start(directory: string, resumeRooms=true): Promise<{child:ChildProcess;base:string}> {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./index.ts",import.meta.url))],{env:{...process.env,PORT:"0",BANK_DATA_DIR:directory,BANK_ADMIN_KEY:"integration-test-key",RESUME_ROOMS:resumeRooms?"true":"false"},stdio:["ignore","pipe","pipe"]});
    const timer=setTimeout(()=>{child.kill();reject(new Error("Server startup timed out"));},10000);
    let output="";
    child.stdout!.on("data",data=>{output+=data;const found=output.match(/listening on ws:\/\/localhost:(\d+)/);if(found){clearTimeout(timer);resolve({child,base:`http://127.0.0.1:${found[1]}`});}});
    child.once("error",reject);child.once("exit",code=>{clearTimeout(timer);if(code)reject(new Error(`Server exited: ${code}`));});
  });
}
function message(ws:WebSocket,type:string,predicate:(message:any)=>boolean=()=>true):Promise<any>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off("message",listener);reject(new Error(`No ${type}`));},5000);
    const listener=(raw:any)=>{const msg=JSON.parse(raw.toString());if(msg.type===type&&predicate(msg)){clearTimeout(timer);ws.off("message",listener);resolve(msg);}};
    ws.on("message",listener);
  });
}
async function connect(base:string){const ws=new WebSocket(base.replace("http:","ws:"));await new Promise<void>((resolve,reject)=>{ws.once("open",()=>resolve());ws.once("error",reject);});return ws;}
async function stop(child:ChildProcess,signal:NodeJS.Signals="SIGTERM"){const ended=new Promise(resolve=>child.once("exit",resolve));child.kill(signal);await ended;}

test("bank API protects answers, persists uploads and edits, and freezes room content",{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-http-"));
  let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try{
    server=await start(directory);let base=server.base;
    assert.equal((await fetch(base+"/api/bank")).status,401);
    const bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    const q={tier:"T5",acceptedAlternatives:[],status:"unused",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:"",id:"GUT-HTTP",category:"Gutta HTTP",prompt:"Hvem sa dette?",answer:"Rune",choices:["Rune","Lasse"],format:"private_choice",mode:"private_choice",readiness:"ready",selection:"PICK"};
    bank.questions.push(q);bank.packs.push({id:"http",name:"HTTP kveld",questionIds:[q.id]});bank.activePackId="http";
    let response=await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});assert.equal(response.status,200);const saved=await response.json() as any;
    assert.equal((await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)})).status,400);
    response=await fetch(base+"/api/bank/media",{headers,method:"POST",body:JSON.stringify({mime:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1EAAAAASUVORK5CYII="})});
    assert.equal(response.status,201);const media=await response.json() as any;assert.equal((await fetch(base+media.url)).status,200);
    const host=await connect(base);sockets.push(host);const denied=message(host,"error");host.send(JSON.stringify({type:"host:create_room",adminKey:"wrong-key"}));assert.match((await denied).message,/redaktørnøkkel/);let next=message(host,"state:host");const created=message(host,"room:created");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key"}));const state=(await next).state;const hostIdentity=await created;assert.equal(state.isTestRoom,false);assert.equal(hostIdentity.testControllers,undefined);
    assert.equal(state.questionPoolTotal,1);assert.ok(state.map.nodes.filter((n:any)=>n.tier).every((n:any)=>n.category==="Gutta HTTP"));
    saved.questions.find((q:any)=>q.id==="GUT-HTTP").prompt="Endret etter rommet ble opprettet";
    assert.equal((await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(saved)})).status,200);
    const tv=await connect(base);sockets.push(tv);let publicNext=message(tv,"state:public");tv.send(JSON.stringify({type:"tv:hello",roomCode:state.roomCode}));await publicNext;
    for(let index=0;index<2;index++){const phone=await connect(base);sockets.push(phone);const joined=message(phone,"team:joined");phone.send(JSON.stringify({type:"team:join",roomCode:state.roomCode,teamName:`Lag ${index}`,players:[`P${index}a`,`P${index}b`]}));await joined;}
    next=message(host,"state:host",m=>m.state.phase==="reading");publicNext=message(tv,"state:public",m=>m.state.phase==="reading");host.send(JSON.stringify({type:"host:start_reading",roomCode:state.roomCode}));
    assert.equal((await next).state.activeQuestion.prompt,"Hvem sa dette?");const publicState=(await publicNext).state;
    assert.equal(publicState.activeQuestionPublic.answer,undefined);assert.equal(publicState.revealedQuestion,null);
    for(const ws of sockets)ws.terminate();
    await stop(server.child,"SIGKILL");server=undefined;
    server=await start(directory);base=server.base;
    const restored=await(await fetch(base+"/api/bank",{headers})).json() as any;
    assert.equal(restored.questions.find((q:any)=>q.id==="GUT-HTTP").prompt,"Endret etter rommet ble opprettet");
    assert.equal((await fetch(base+media.url)).status,200);
    const resumed=await connect(base);sockets.push(resumed);const recovered=message(resumed,"state:host");
    resumed.send(JSON.stringify({type:"host:resume_room",roomCode:hostIdentity.roomCode,sessionToken:hostIdentity.sessionToken}));
    const recovery=(await recovered).state;assert.equal(recovery.paused,true);assert.equal(recovery.phase,"reading");assert.equal(recovery.activeQuestion.prompt,"Hvem sa dette?");
  }finally{
    for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});
  }
});

test("team presence survives closing one of two resumed connections; TV cannot use host override", {timeout:15000}, async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-presence-"));let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory);const base=server.base;
    const bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    bank.questions=[{id:"ONE",category:"Test",tier:"T5",prompt:"Test?",answer:"Ja",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}];bank.packs[0].questionIds=["ONE"];
    await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});
    const host=await connect(base);sockets.push(host);let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key"}));const code=(await next).state.roomCode;
    const a=await connect(base);sockets.push(a);let joined=message(a,"team:joined");a.send(JSON.stringify({type:"team:join",roomCode:code,teamName:"A",players:["P1","P2"]}));const identity=await joined;
    const b=await connect(base);sockets.push(b);joined=message(b,"team:joined");b.send(JSON.stringify({type:"team:resume",roomCode:code,teamId:identity.teamId,sessionToken:identity.sessionToken}));await joined;
    next=message(host,"state:host");a.close();assert.equal((await next).state.teams[0].connected,true);
    next=message(host,"state:host");b.close();assert.equal((await next).state.teams[0].connected,false);
    const tv=await connect(base);sockets.push(tv);let publicNext=message(tv,"state:public");tv.send(JSON.stringify({type:"tv:hello",roomCode:code}));await publicNext;
    const error=message(tv,"error");tv.send(JSON.stringify({type:"host:choose_route",roomCode:code,nodeId:"any"}));assert.match((await error).message,/vert/);
    for(const ws of sockets)ws.terminate();await stop(server.child,"SIGKILL");server=undefined;
    server=await start(directory);const recoveredTeam=await connect(server.base);sockets.push(recoveredTeam);
    const rejoined=message(recoveredTeam,"team:joined");const recoveredPublic=message(recoveredTeam,"state:public");
    recoveredTeam.send(JSON.stringify({type:"team:resume",roomCode:code,teamId:identity.teamId,sessionToken:identity.sessionToken}));
    assert.equal((await rejoined).teamId,identity.teamId);assert.equal((await recoveredPublic).state.teams[0].connected,true);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});

test("four real controllers complete route recovery, undo, qualification and a scored Final over WebSockets",{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-match-"));let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory);const base=server.base;
    const bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    bank.questions=Array.from({length:12},(_,i)=>({id:`MATCH${i}`,category:"Generelt",tier:"T5",prompt:`Testspørsmål ${i}`,answer:"Svar",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}));bank.packs[0].questionIds=bank.questions.map((q:any)=>q.id);
    await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});
    const host=await connect(base);sockets.push(host);let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key"}));let state=(await next).state;const code=state.roomCode;
    const rpc=async(type:string,extra:object={},predicate:(m:any)=>boolean=()=>true)=>{const result=message(host,"state:host",predicate);host.send(JSON.stringify({type,roomCode:code,...extra}));return (await result).state;};
    const teams:any[]=[];
    for(let i=0;i<4;i++){const ws=await connect(base);sockets.push(ws);const joined=message(ws,"team:joined");ws.send(JSON.stringify({type:"team:join",roomCode:code,teamName:`Lag ${i}`,players:[`Spiller ${i}a`,`Spiller ${i}b`]}));teams.push({ws,...await joined});}
    state=await rpc("host:start_reading",{},m=>m.state.phase==="reading");state=await rpc("host:open_buzzers",{},m=>m.state.phase==="buzzing");
    const buzz=async(index:number)=>{const result=message(host,"state:host",m=>m.state.currentResponderId===teams[index].teamId);teams[index].ws.send(JSON.stringify({type:"team:buzz",roomCode:code,teamId:teams[index].teamId}));return(await result).state;};
    await buzz(0);await rpc("host:mark_wrong",{teamId:teams[0].teamId});
    state=await rpc("host:undo");assert.equal(state.paused,true);assert.equal(state.teams[0].score,0);assert.equal(state.phase,"adjudicating");
    await rpc("host:resume");state=await rpc("host:mark_correct",{teamId:teams[0].teamId});assert.equal(state.phase,"route_choice");
    const tv = await connect(base); sockets.push(tv);
    let publicNext = message(tv, "state:public");
    tv.send(JSON.stringify({type:"tv:hello",roomCode:code})); await publicNext;
    assert.equal(state.canDismissQuestionCard, true); // correct answer auto-reveals
    const deniedDismiss = message(tv, "error");
    tv.send(JSON.stringify({type:"host:dismiss_question_card",roomCode:code}));
    assert.match((await deniedDismiss).message, /vert/);
    publicNext = message(tv, "state:public", m=>m.state.questionCardDismissed);
    state = await rpc("host:dismiss_question_card");
    assert.equal(state.canDismissQuestionCard, false);
    const cleared = (await publicNext).state;
    assert.equal(cleared.revealedQuestion, null);
    assert.equal(cleared.questionCardDismissed, true);
    assert.ok(cleared.legalNextNodeIds.length);
    const choicesBeforeUndo = state.legalNextNodeIds;
    const controllerBeforeUndo = state.controllingTeamId;
    state = await rpc("host:finish_route");
    state = await rpc("host:undo");
    assert.equal(state.phase, "route_choice");
    assert.equal(state.paused, true);
    assert.equal(state.controllingTeamId, controllerBeforeUndo);
    assert.equal(state.currentResponderId, null);
    assert.deepEqual(state.legalNextNodeIds, choicesBeforeUndo);
    state = await rpc("host:resume");
    const playerChoice = message(host, "state:host", m=>m.state.phase === "map");
    teams[0].ws.send(JSON.stringify({type:"team:choose_route",roomCode:code,teamId:teams[0].teamId,nodeId:choicesBeforeUndo[0]}));
    state = (await playerChoice).state;
    assert.equal(state.activeNodeId, choicesBeforeUndo[0]);
    assert.ok(state.activeQuestion);

    state=await rpc("host:finish_route");assert.equal(state.phase,"playoff");
    assert.equal(state.playoffState.questionIds.length,5);
    assert.deepEqual(Object.values(state.playoffState.scores),[0,0,0]);
    for(let i=0;i<5;i++){
      await rpc("host:start_reading");await rpc("host:open_buzzers");await buzz(1);
      state=await rpc("host:mark_correct",{teamId:teams[1].teamId});
      assert.equal(state.playoffState.scores[teams[1].teamId],i+1);
      state=await rpc("host:advance_playoff");
    }
    assert.equal(state.phase,"final");
    assert.deepEqual(new Set(state.finalState.finalists),new Set([teams[0].teamId,teams[1].teamId]));
    const count=state.finalState.questionIds.length;
    for(let i=0;i<count;i++){
      state=await rpc("host:start_reading");assert.equal(state.finalState.roundPhase,"reading");await rpc("host:open_buzzers");await buzz(0);
      state=await rpc("host:mark_correct",{teamId:teams[0].teamId});assert.equal(state.finalState.roundPhase,"resolved");state=await rpc("host:advance_final");
    }
    assert.equal(state.phase,"ended");assert.deepEqual(state.finalState.winnerIds,[teams[0].teamId]);assert.equal(state.finalState.scores[teams[0].teamId],count*200);assert.equal(state.teams[0].score,200);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});

test("default startup ignores old rooms, expires old sessions and keeps the question bank",{timeout:15000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-fresh-"));let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory,true);let base=server.base;
    const bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    bank.questions=Array.from({length:2},(_,i)=>({id:`FRESH${i}`,category:"Generelt",tier:"T5",prompt:`Test ${i}`,answer:"Ja",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}));bank.packs[0].questionIds=bank.questions.map((q:any)=>q.id);
    await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});
    const host=await connect(base);sockets.push(host);const created=message(host,"room:created");let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key"}));const before=(await next).state;const identity=await created;
    for(let i=0;i<2;i++){next=message(host,"state:host");host.send(JSON.stringify({type:"host:add_team",roomCode:before.roomCode}));await next;}
    next=message(host,"state:host",m=>m.state.phase==="reading");host.send(JSON.stringify({type:"host:start_reading",roomCode:before.roomCode}));assert.equal((await next).state.questionPoolRemaining,1);
    for(const ws of sockets)ws.terminate();await stop(server.child);server=undefined;
    server=await start(directory,false);base=server.base;
    const restoredBank=await(await fetch(base+"/api/bank",{headers})).json() as any;assert.equal(restoredBank.questions.length,2);
    const freshHost=await connect(base);sockets.push(freshHost);const expired=message(freshHost,"error");freshHost.send(JSON.stringify({type:"host:resume_room",roomCode:identity.roomCode,sessionToken:identity.sessionToken}));assert.equal((await expired).code,"session_expired");
    next=message(freshHost,"state:host");freshHost.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key"}));const fresh=(await next).state;
    assert.equal(fresh.phase,"lobby");assert.equal(fresh.teams.length,0);assert.equal(fresh.questionPoolRemaining,2);assert.notEqual(fresh.gameId,before.gameId);assert.notEqual(fresh.map.nodes[1].id,before.map.nodes[1].id);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});

test("local test room creates four virtual teams and one controller can switch identities and play",{timeout:15000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-local-test-"));let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory,false);const base=server.base;
    const bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    bank.questions=Array.from({length:6},(_,i)=>({id:`LOCAL${i}`,category:"Generelt",tier:"T5",prompt:`Test ${i}`,answer:"Ja",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}));bank.packs[0].questionIds=bank.questions.map((q:any)=>q.id);
    await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});
    const host=await connect(base);sockets.push(host);const created=message(host,"room:created");let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key",testMode:true}));let state=(await next).state;const credentials=(await created).testControllers;
    assert.equal(state.isTestRoom,true);assert.equal(state.teams.length,4);assert.ok(state.teams.every((t:any)=>t.connected));assert.equal(credentials.length,4);
    const controller=await connect(base);sockets.push(controller);
    for(const session of credentials.slice(0,2)){
      const joined=message(controller,"team:joined");controller.send(JSON.stringify({type:"team:resume",roomCode:session.roomCode,teamId:session.teamId,sessionToken:session.sessionToken}));assert.equal((await joined).teamId,session.teamId);
    }
    const rpc=async(type:string,extra:object={},predicate:(m:any)=>boolean=()=>true)=>{const result=message(host,"state:host",predicate);host.send(JSON.stringify({type,roomCode:state.roomCode,...extra}));return(await result).state;};
    await rpc("host:start_reading",{},m=>m.state.phase==="reading");await rpc("host:open_buzzers",{},m=>m.state.phase==="buzzing");
    next=message(host,"state:host",m=>m.state.currentResponderId===credentials[1].teamId);controller.send(JSON.stringify({type:"team:buzz",roomCode:state.roomCode,teamId:credentials[1].teamId}));await next;
    state=await rpc("host:mark_correct",{teamId:credentials[1].teamId});assert.equal(state.teams[1].score,200);assert.equal(state.phase,"route_choice");assert.ok(state.teams.every((t:any)=>t.connected));
    const publicState=message(controller,"state:public");host.send(JSON.stringify({type:"host:pause",roomCode:state.roomCode}));assert.equal((await publicState).state.testControllers,undefined);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});

test("event nights recover without environment flags and require editor authentication",{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-event-")); let server:Awaited<ReturnType<typeof start>>|undefined; const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory,false);
    const bank=await(await fetch(server.base+"/api/bank",{headers})).json() as any;
    bank.questions=Array.from({length:9},(_,i)=>({id:`EVENT${i}`,category:"History",tier:"T5",prompt:`Event ${i}`,answer:"A",acceptedAlternatives:[],status:"unused",format:"text",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}));bank.packs[0].questionIds=bank.questions.map((q:any)=>q.id);
    await fetch(server.base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});
    const host=await connect(server.base);sockets.push(host);
    let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key",eventMode:true}));let state=(await next).state;const code=state.roomCode;
    assert.equal(state.eventMode,true);
    for(let i=0;i<2;i++){next=message(host,"state:host");host.send(JSON.stringify({type:"host:add_team",roomCode:code}));state=(await next).state;}
    // The lobby itself is recoverable, including manual score corrections.
    next=message(host,"state:host");host.send(JSON.stringify({type:"host:adjust_score",roomCode:code,teamId:state.teams[0].id,delta:100}));await next;
    for(const ws of sockets)ws.terminate(); await stop(server.child,"SIGKILL");server=undefined;
    server=await start(directory,false);
    const freshHost=await connect(server.base);sockets.push(freshHost);
    const denied=message(freshHost,"error");freshHost.send(JSON.stringify({type:"host:list_events",adminKey:"wrong"}));assert.match((await denied).message,/redaktørnøkkel/);
    const list=message(freshHost,"host:events");freshHost.send(JSON.stringify({type:"host:list_events",adminKey:"integration-test-key"}));const events=(await list).events;
    assert.equal(events.length,1);assert.equal(events[0].roomCode,code);assert.equal(events[0].teams.length,2);assert.equal(events[0].hostToken,undefined);
    next=message(freshHost,"state:host");freshHost.send(JSON.stringify({type:"host:recover_event",roomCode:code,adminKey:"integration-test-key"}));state=(await next).state;
    assert.equal(state.eventMode,true);assert.equal(state.paused,true);assert.equal(state.teams.length,2);assert.equal(state.teams[0].score,100);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});

test("closest guesses and image stages travel over WebSockets with role checks and private results",{timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"trivia-new-formats-"));let server:Awaited<ReturnType<typeof start>>|undefined;const sockets:WebSocket[]=[];
  const headers={Authorization:"Bearer integration-test-key","Content-Type":"application/json"};
  try {
    server=await start(directory,false);const base=server.base;
    let bank=await(await fetch(base+"/api/bank",{headers})).json() as any;
    bank.questions=Array.from({length:9},(_,i)=>({id:`NUM${i}`,category:"Tall",tier:"T5",prompt:`Tall ${i}`,answer:"10",acceptedAlternatives:[],status:"unused",format:"closest",selection:"PICK",readiness:"ready",source:"test",sourceUrl:"",assetBrief:"",notes:"",originalFormat:""}));bank.packs[0].questionIds=bank.questions.map((q:any)=>q.id);
    let response=await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});assert.equal(response.status,200);bank=await response.json();
    const host=await connect(base);sockets.push(host);let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key",testMode:true}));let state=(await next).state;let code=state.roomCode;
    const rpc=async(type:string,extra:object={})=>{const result=message(host,"state:host");host.send(JSON.stringify({type,roomCode:code,...extra}));return (await result).state;};
    const tv=await connect(base);sockets.push(tv);let pub=message(tv,"state:public");tv.send(JSON.stringify({type:"tv:hello",roomCode:code}));await pub;
    // Attach real phones to two of the generated teams using their host-created sessions.
    // New room credentials are sent only to the host, so recover them from room:created on a second creation.
    const credentials=message(host,"room:created");next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key",testMode:true}));state=(await next).state;code=state.roomCode;const identities=(await credentials).testControllers;
    pub=message(tv,"state:public",m=>m.state.roomCode===code);tv.send(JSON.stringify({type:"tv:hello",roomCode:code}));await pub;
    const phones:WebSocket[]=[];
    for(const identity of identities.slice(0,2)){const phone=await connect(base);sockets.push(phone);phones.push(phone);const joined=message(phone,"team:joined");phone.send(JSON.stringify({type:"team:resume",roomCode:code,teamId:identity.teamId,sessionToken:identity.sessionToken}));await joined;}
    await rpc("host:start_reading");state=await rpc("host:open_buzzers");assert.equal(state.activeQuestion.mode,"closest");
    for(let i=0;i<2;i++){next=message(host,"state:host",m=>Object.keys(m.state.friendAnswers).length===i+1);phones[i].send(JSON.stringify({type:"team:submit_friend_answer",roomCode:code,teamId:identities[i].teamId,answer:i===0?"9":"11"}));await next;}
    pub=message(tv,"state:public",m=>m.state.revealedQuestion!==null);state=await rpc("host:reveal_friend_answers");const results=(await pub).state;
    assert.equal(results.revealedQuestion.results.length,2);assert.ok(results.revealedQuestion.results.every((row:any)=>row.correct));assert.equal(results.feedback.points,200);assert.equal(results.activeQuestionPublic,null);
    assert.equal(state.teams[0].score,200);assert.equal(state.teams[1].score,200);
    // Change only the bank; the active numeric room retains its frozen question pack.
    bank.questions=bank.questions.map((q:any)=>({...q,format:"progressive_image",media:{type:"image",url:"/media/test.png"}}));
    response=await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(bank)});assert.equal(response.status,200);
    next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room",adminKey:"integration-test-key",testMode:true}));state=(await next).state;code=state.roomCode;
    pub=message(tv,"state:public",m=>m.state.roomCode===code);tv.send(JSON.stringify({type:"tv:hello",roomCode:code}));await pub;
    state=await rpc("host:start_reading");assert.equal(state.activeQuestion.progressiveImage,true);
    const denied=message(tv,"error");tv.send(JSON.stringify({type:"host:advance_image",roomCode:code}));assert.match((await denied).message,/vert/);
    pub=message(tv,"state:public",m=>m.state.imageRevealStage===1);await rpc("host:advance_image");assert.equal((await pub).state.imageRevealStage,1);
    state=await rpc("host:undo");assert.equal(state.paused,true);assert.equal(state.imageRevealStage,0);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});
