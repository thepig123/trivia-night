import test from "node:test";
import assert from "node:assert/strict";
import { validateMessage } from "./protocol.js";

test("protocol rejects malformed JSON shapes, nonnumeric scores and injected fields",()=>{
  for(const value of [null,[],"buzz",{}, {type:"__proto__"},{type:"host:adjust_score",roomCode:"ABCDE",teamId:"A",delta:"100"},{type:"host:adjust_score",roomCode:"ABCDE",teamId:"A",delta:Infinity},{type:"host:create_room",state:{score:9999}},{type:"team:join",roomCode:"ABCDE",teamName:"A",players:[]},{type:"host:select_finalists",roomCode:"ABCDE",teamIds:["A","A"]}]) assert.throws(()=>validateMessage(value));
  assert.deepEqual(validateMessage({type:"host:adjust_score",roomCode:"ABCDE",teamId:"A",delta:-100}),{type:"host:adjust_score",roomCode:"ABCDE",teamId:"A",delta:-100});
  assert.equal(validateMessage({type:"team:join",roomCode:"ABCDE",teamName:"Lag",players:["P1","P2"]}).type,"team:join");
});
