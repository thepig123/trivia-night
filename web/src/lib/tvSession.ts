import type { ClientMessage } from "../types";

export function tvReconnectMessage(storage: Pick<Storage, "getItem">): ClientMessage | null {
  const roomCode = storage.getItem("trivia-tv-room");
  return roomCode ? { type: "tv:hello", roomCode } : null;
}
