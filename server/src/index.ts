import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { GameEngine } from "./gameState.js";
import type { ClientMessage, ServerMessage } from "./types.js";

const PORT = Number(process.env.PORT ?? 8080);

type Role = "host" | "team" | "tv";

interface ClientInfo {
  ws: WebSocket;
  role: Role | null;
  roomCode: string | null;
  teamId: string | null;
}

const rooms = new Map<string, GameEngine>();
const clients = new Map<WebSocket, ClientInfo>();

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string) {
  send(ws, { type: "error", message });
}

/** Broadcast the current state to everyone connected to a room, role-appropriately. */
function broadcast(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const publicState = room.toPublicState();
  const hostState = room.toHostState();
  for (const [ws, info] of clients) {
    if (info.roomCode !== roomCode) continue;
    if (info.role === "host") {
      send(ws, { type: "state:host", state: hostState });
    } else {
      send(ws, { type: "state:public", state: publicState });
    }
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  clients.set(ws, { ws, role: null, roomCode: null, teamId: null });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendError(ws, "Malformed message.");
      return;
    }

    const info = clients.get(ws)!;

    try {
      switch (msg.type) {
        case "host:create_room": {
          const code = makeRoomCode();
          const room = new GameEngine(code);
          rooms.set(code, room);
          info.role = "host";
          info.roomCode = code;
          send(ws, { type: "room:created", roomCode: code });
          broadcast(code);
          break;
        }

        case "host:resume_room": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Room ${msg.roomCode} not found.`);
          info.role = "host";
          info.roomCode = msg.roomCode;
          broadcast(msg.roomCode);
          break;
        }

        case "tv:hello": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Room ${msg.roomCode} not found.`);
          info.role = "tv";
          info.roomCode = msg.roomCode;
          broadcast(msg.roomCode);
          break;
        }

        case "team:join": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Room ${msg.roomCode} not found.`);
          const team = room.addTeam(msg.teamName);
          info.role = "team";
          info.roomCode = msg.roomCode;
          info.teamId = team.id;
          send(ws, { type: "team:joined", teamId: team.id, roomCode: msg.roomCode });
          broadcast(msg.roomCode);
          break;
        }

        case "team:buzz": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.registerBuzz(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "team:choose_route": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.chooseRoute(msg.teamId, msg.nodeId);
          broadcast(msg.roomCode);
          break;
        }

        case "host:start_reading": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          // First activation from START has no node yet — activate on demand.
          if (!room.activeNodeId && room.map.currentStep < room.map.steps) {
            room.activateCurrentNode();
          }
          room.startReading();
          broadcast(msg.roomCode);
          break;
        }

        case "host:open_buzzers": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.openBuzzers();
          broadcast(msg.roomCode);
          break;
        }

        case "host:mark_correct": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.markCorrect(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "host:mark_wrong": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.markWrong(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "host:skip_question": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.skipQuestion();
          broadcast(msg.roomCode);
          break;
        }

        case "host:pause": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.pause();
          broadcast(msg.roomCode);
          break;
        }

        case "host:resume": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.resume();
          broadcast(msg.roomCode);
          break;
        }

        case "host:adjust_score": {
          const room = rooms.get(msg.roomCode);
          if (!room) return;
          room.adjustScore(msg.teamId, msg.delta);
          broadcast(msg.roomCode);
          break;
        }

        default:
          sendError(ws, `Unknown message type.`);
      }
    } catch (err) {
      console.error(err);
      sendError(ws, "Server error handling message.");
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    if (info?.role === "team" && info.roomCode && info.teamId) {
      const room = rooms.get(info.roomCode);
      room?.setConnected(info.teamId, false);
      broadcast(info.roomCode);
    }
    clients.delete(ws);
  });
});

console.log(`TRIVIA NIGHT server listening on ws://localhost:${PORT}`);
