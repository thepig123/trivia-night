import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, HostGameState, PublicGameState, ServerMessage } from "../types";

// Change this if your server runs somewhere other than localhost:8080,
// e.g. set VITE_WS_URL in a .env file at web/.env for LAN play.
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

export interface UseGameSocket {
  connected: boolean;
  publicState: PublicGameState | null;
  hostState: HostGameState | null;
  lastError: string | null;
  roomCode: string | null;
  teamId: string | null;
  send: (msg: ClientMessage) => void;
}

type ClientRole = "host" | "team" | "tv";

export function useGameSocket(role: ClientRole): UseGameSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [publicState, setPublicState] = useState<PublicGameState | null>(null);
  const [hostState, setHostState] = useState<HostGameState | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket;
    let reconnectTimer: number | undefined;

    function connect() {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setLastError(null);
        if (role === "host") {
          const saved = readSession(localStorage, "trivia-host-session");
          if (saved) socket.send(JSON.stringify({ type: "host:resume_room", ...saved } satisfies ClientMessage));
        } else if (role === "team") {
          const saved = readSession(sessionStorage, "trivia-team-session");
          if (saved?.teamId) {
            socket.send(
              JSON.stringify({
                type: "team:resume",
                roomCode: saved.roomCode,
                teamId: saved.teamId,
                sessionToken: saved.sessionToken,
              } satisfies ClientMessage),
            );
          }
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "room:created":
            setRoomCode(msg.roomCode);
            localStorage.setItem("trivia-host-session", JSON.stringify({ roomCode: msg.roomCode, sessionToken: msg.sessionToken }));
            break;
          case "team:joined":
            setRoomCode(msg.roomCode);
            setTeamId(msg.teamId);
            sessionStorage.setItem(
              "trivia-team-session",
              JSON.stringify({ roomCode: msg.roomCode, teamId: msg.teamId, sessionToken: msg.sessionToken }),
            );
            break;
          case "state:public":
            setPublicState(msg.state);
            setRoomCode(msg.state.roomCode);
            break;
          case "state:host":
            setHostState(msg.state);
            setRoomCode(msg.state.roomCode);
            break;
          case "error":
            setLastError(msg.message);
            break;
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [role]);

  const send = useCallback((msg: ClientMessage) => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));
  }, []);

  return { connected, publicState, hostState, lastError, roomCode, teamId, send };
}

function readSession(storage: Storage, key: string): { roomCode: string; sessionToken: string; teamId?: string } | null {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
