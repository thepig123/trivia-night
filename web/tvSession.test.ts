import assert from "node:assert/strict";
import test from "node:test";
import { tvReconnectMessage } from "./src/lib/tvSession.js";

test("TV re-registers the same room after every socket reconnect", () => {
  const storage = { getItem: (key: string) => key === "trivia-tv-room" ? "ABCDE" : null };
  for (let reconnect = 0; reconnect < 3; reconnect++) {
    assert.deepEqual(tvReconnectMessage(storage), { type: "tv:hello", roomCode: "ABCDE" });
  }
});
test("fresh TV does not join a room before selection", () => {
  assert.equal(tvReconnectMessage({ getItem: () => null }), null);
});

import { parseTestControllers, testControllerUrl, localTestingHost } from "./src/lib/testControllers.js";
test("local test controller links preserve all four sessions without putting credentials in HTTP query strings",()=>{
  const sessions=Array.from({length:4},(_,i)=>({roomCode:"ABCDE",teamId:`TEAM000${i}`,sessionToken:"a".repeat(32),teamName:`Testlag ${i}`}));
  const url=new URL(testControllerUrl(sessions,"http://localhost:5173"));assert.equal(url.search,"");
  assert.deepEqual(parseTestControllers(new URLSearchParams(url.hash.slice(1)).get("test")!),sessions);
  assert.throws(()=>parseTestControllers(JSON.stringify(sessions.slice(0,1))));
  assert.equal(localTestingHost("localhost"),true);assert.equal(localTestingHost("192.168.1.20"),false);
});
