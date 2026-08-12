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

export function useGameSocket(): UseGameSocket {
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

    function connect() {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => !cancelled && setConnected(true);
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setTimeout(connect, 1500); // simple auto-reconnect
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "room:created":
            setRoomCode(msg.roomCode);
            break;
          case "team:joined":
            setRoomCode(msg.roomCode);
            setTeamId(msg.teamId);
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
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));
  }, []);

  return { connected, publicState, hostState, lastError, roomCode, teamId, send };
}
