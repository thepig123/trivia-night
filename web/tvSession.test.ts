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
