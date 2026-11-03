import { localTestingHost, parseTestControllers } from "./testControllers";
import { tvReconnectMessage } from "./tvSession";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, HostGameState, PublicGameState, ServerMessage, TestControllerSession, SavedEventSummary } from "../types";

// Follow the browser's hostname so phones on the LAN reach the host laptop.
// Set VITE_WS_URL in web/.env when the backend uses a different host or port.
const WS_URL = import.meta.env.VITE_WS_URL ?? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8080`;

export interface UseGameSocket {
  events: SavedEventSummary[] | null;
  connected: boolean;
  testControllers: TestControllerSession[];
  publicState: PublicGameState | null;
  hostState: HostGameState | null;
  lastError: string | null;
  roomCode: string | null;
  teamId: string | null;
  send: (msg: ClientMessage) => void;
}

type ClientRole = "host" | "team" | "tv";

export function useGameSocket(role: ClientRole): UseGameSocket {
  const [events,setEvents] = useState<SavedEventSummary[] | null>(null);
  const [testControllers,setTestControllers]=useState<TestControllerSession[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [publicState, setPublicState] = useState<PublicGameState | null>(null);
  const [hostState, setHostState] = useState<HostGameState | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;
    if(localTestingHost(window.location.hostname)) {
      try {
        const fragment=new URLSearchParams(window.location.hash.slice(1)).get("test");
        if(role === "team" && fragment) {
          const sessions=parseTestControllers(fragment);
          sessionStorage.setItem("trivia-test-controllers",JSON.stringify(sessions));
          sessionStorage.setItem("trivia-team-session",JSON.stringify(sessions[0]));
          window.history.replaceState(null,"",window.location.pathname+window.location.search);
        }
        const stored=sessionStorage.getItem("trivia-test-controllers");
        if(stored)setTestControllers(parseTestControllers(stored));
      } catch {sessionStorage.removeItem("trivia-test-controllers");}
    }

    function connect() {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        if (cancelled || wsRef.current !== socket) return;
        setConnected(true);
        setLastError(null);
        if (role === "tv") {
          const hello = tvReconnectMessage(sessionStorage);
          if (hello) socket.send(JSON.stringify(hello));
        } else if (role === "host") {
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
        if (cancelled || wsRef.current !== socket) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (event) => {
        if (cancelled || wsRef.current !== socket) return;
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "host:events":
            setEvents(msg.events); break;
          case "room:created":
            setTestControllers(msg.testControllers ?? []);
            if(msg.testControllers)sessionStorage.setItem("trivia-test-controllers",JSON.stringify(msg.testControllers));
            else sessionStorage.removeItem("trivia-test-controllers");
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
            if (role === "tv") sessionStorage.setItem("trivia-tv-room", msg.state.roomCode);
            setPublicState(msg.state);
            setRoomCode(msg.state.roomCode);
            break;
          case "state:host":
            setHostState(msg.state);
            setRoomCode(msg.state.roomCode);
            break;
          case "error":
            if(msg.code === "session_expired") {
              if(role === "host")localStorage.removeItem("trivia-host-session");
              if(role === "team")sessionStorage.removeItem("trivia-team-session");
              if(role === "tv")sessionStorage.removeItem("trivia-tv-room");
              sessionStorage.removeItem("trivia-test-controllers");setTestControllers([]);
              setHostState(null);setPublicState(null);setRoomCode(null);setTeamId(null);
              setLastError(null);
            } else setLastError(msg.message);
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
    if(wsRef.current?.readyState !== WebSocket.OPEN){setLastError("Ingen forbindelse til serveren. Vent på tilkobling.");return;}
    setLastError(null);
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  return { events, connected, testControllers, publicState, hostState, lastError, roomCode, teamId, send };
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
