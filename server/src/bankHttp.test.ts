import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

function start(directory: string): Promise<{child:ChildProcess;base:string}> {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./index.ts",import.meta.url))],{env:{...process.env,PORT:"0",BANK_DATA_DIR:directory,BANK_ADMIN_KEY:"integration-test-key"},stdio:["ignore","pipe","pipe"]});
    const timer=setTimeout(()=>{child.kill();reject(new Error("Server startup timed out"));},10000);
    let output="";
    child.stdout!.on("data",data=>{output+=data;const found=output.match(/listening on ws:\/\/localhost:(\d+)/);if(found){clearTimeout(timer);resolve({child,base:`http://127.0.0.1:${found[1]}`});}});
    child.once("error",reject);child.once("exit",code=>{clearTimeout(timer);if(code)reject(new Error(`Server exited: ${code}`));});
  });
}
function message(ws:WebSocket,type:string):Promise<any>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off("message",listener);reject(new Error(`No ${type}`));},5000);
    const listener=(raw:any)=>{const msg=JSON.parse(raw.toString());if(msg.type===type){clearTimeout(timer);ws.off("message",listener);resolve(msg);}};
    ws.on("message",listener);
  });
}
async function connect(base:string){const ws=new WebSocket(base.replace("http:","ws:"));await new Promise<void>((resolve,reject)=>{ws.once("open",()=>resolve());ws.once("error",reject);});return ws;}
async function stop(child:ChildProcess){const ended=new Promise(resolve=>child.once("exit",resolve));child.kill();await ended;}

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
    const host=await connect(base);sockets.push(host);let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room"}));const state=(await next).state;
    assert.equal(state.questionPoolTotal,1);assert.ok(state.map.nodes.filter((n:any)=>n.tier).every((n:any)=>n.category==="Gutta HTTP"));
    saved.questions.find((q:any)=>q.id==="GUT-HTTP").prompt="Endret etter rommet ble opprettet";
    assert.equal((await fetch(base+"/api/bank",{headers,method:"PUT",body:JSON.stringify(saved)})).status,200);
    const tv=await connect(base);sockets.push(tv);let publicNext=message(tv,"state:public");tv.send(JSON.stringify({type:"tv:hello",roomCode:state.roomCode}));await publicNext;
    next=message(host,"state:host");publicNext=message(tv,"state:public");host.send(JSON.stringify({type:"host:start_reading",roomCode:state.roomCode}));
    assert.equal((await next).state.activeQuestion.prompt,"Hvem sa dette?");const publicState=(await publicNext).state;
    assert.equal(publicState.activeQuestionPublic.answer,undefined);assert.equal(publicState.revealedQuestion,null);
    for(const ws of sockets)ws.terminate();
    await stop(server.child);server=undefined;
    server=await start(directory);base=server.base;
    const restored=await(await fetch(base+"/api/bank",{headers})).json() as any;
    assert.equal(restored.questions.find((q:any)=>q.id==="GUT-HTTP").prompt,"Endret etter rommet ble opprettet");
    assert.equal((await fetch(base+media.url)).status,200);
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
    const host=await connect(base);sockets.push(host);let next=message(host,"state:host");host.send(JSON.stringify({type:"host:create_room"}));const code=(await next).state.roomCode;
    const a=await connect(base);sockets.push(a);let joined=message(a,"team:joined");a.send(JSON.stringify({type:"team:join",roomCode:code,teamName:"A",players:["P1","P2"]}));const identity=await joined;
    const b=await connect(base);sockets.push(b);joined=message(b,"team:joined");b.send(JSON.stringify({type:"team:resume",roomCode:code,teamId:identity.teamId,sessionToken:identity.sessionToken}));await joined;
    next=message(host,"state:host");a.close();assert.equal((await next).state.teams[0].connected,true);
    next=message(host,"state:host");b.close();assert.equal((await next).state.teams[0].connected,false);
    const tv=await connect(base);sockets.push(tv);let publicNext=message(tv,"state:public");tv.send(JSON.stringify({type:"tv:hello",roomCode:code}));await publicNext;
    const error=message(tv,"error");tv.send(JSON.stringify({type:"host:choose_route",roomCode:code,nodeId:"any"}));assert.match((await error).message,/vert/);
  } finally {for(const ws of sockets)ws.terminate();if(server)await stop(server.child);rmSync(directory,{recursive:true,force:true});}
});
