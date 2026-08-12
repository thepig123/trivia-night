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
const hostSessionTokens = new Map<string, string>();
const teamSessionTokens = new Map<string, Map<string, string>>();

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

function requireHost(ws: WebSocket, info: ClientInfo, roomCode: string): GameEngine | null {
  const room = rooms.get(roomCode);
  if (!room) sendError(ws, `Fant ikke rom ${roomCode}.`);
  else if (info.role !== "host" || info.roomCode !== roomCode) sendError(ws, "Krever tilgang som vert.");
  else return room;
  return null;
}

function requireTeam(ws: WebSocket, info: ClientInfo, roomCode: string, teamId: string): GameEngine | null {
  const room = rooms.get(roomCode);
  if (!room) sendError(ws, `Fant ikke rom ${roomCode}.`);
  else if (info.role !== "team" || info.roomCode !== roomCode || info.teamId !== teamId) {
    sendError(ws, "Krever tilgang som lag.");
  } else return room;
  return null;
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
      sendError(ws, "Ugyldig melding.");
      return;
    }

    const info = clients.get(ws)!;

    try {
      switch (msg.type) {
        case "host:create_room": {
          const code = makeRoomCode();
          const room = new GameEngine(code);
          room.initializeDefaultTeams();
          rooms.set(code, room);
          const sessionToken = nanoid(32);
          hostSessionTokens.set(code, sessionToken);
          teamSessionTokens.set(code, new Map());
          info.role = "host";
          info.roomCode = code;
          send(ws, { type: "room:created", roomCode: code, sessionToken });
          broadcast(code);
          break;
        }

        case "host:add_team": {
          const room = requireHost(ws, info, msg.roomCode); if (!room || room.teams.length >= 5) return;
          room.addTeam(`Team ${room.teams.length + 1}`); room.teams.at(-1)!.connected = false; broadcast(msg.roomCode); break;
        }
        case "host:remove_team": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.removeTeam(msg.teamId); broadcast(msg.roomCode); break;
        }
        case "host:update_team": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.updateTeam(msg.teamId, msg.name, msg.players); broadcast(msg.roomCode); break;
        }
        case "host:set_target": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.setTargetScore(msg.targetScore); broadcast(msg.roomCode); break;
        }

        case "host:resume_room": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Room ${msg.roomCode} not found.`);
          if (hostSessionTokens.get(msg.roomCode) !== msg.sessionToken) return sendError(ws, "Invalid host session.");
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
          const team = room.registerTeam(msg.teamName, msg.players, msg.photoDataUrl);
          if (!team) return sendError(ws, "Skriv inn lagnavn og to spillernavn. Rommet støtter opptil fem lag.");
          const sessionToken = nanoid(32);
          teamSessionTokens.get(msg.roomCode)?.set(team.id, sessionToken);
          info.role = "team";
          info.roomCode = msg.roomCode;
          info.teamId = team.id;
          send(ws, { type: "team:joined", teamId: team.id, roomCode: msg.roomCode, sessionToken });
          broadcast(msg.roomCode);
          break;
        }

        case "team:resume": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Room ${msg.roomCode} not found.`);
          if (teamSessionTokens.get(msg.roomCode)?.get(msg.teamId) !== msg.sessionToken) {
            return sendError(ws, "Invalid team session.");
          }
          if (!room.teams.some((team) => team.id === msg.teamId)) return sendError(ws, "Team not found.");
          info.role = "team";
          info.roomCode = msg.roomCode;
          info.teamId = msg.teamId;
          room.setConnected(msg.teamId, true);
          send(ws, { type: "team:joined", teamId: msg.teamId, roomCode: msg.roomCode, sessionToken: msg.sessionToken });
          broadcast(msg.roomCode);
          break;
        }

        case "team:buzz": {
          const room = requireTeam(ws, info, msg.roomCode, msg.teamId);
          if (!room) return;
          room.registerBuzz(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "team:choose_route": {
          const room = requireTeam(ws, info, msg.roomCode, msg.teamId);
          if (!room) return;
          room.chooseRoute(msg.teamId, msg.nodeId);
          broadcast(msg.roomCode);
          break;
        }
        case "team:submit_friend_answer": {
          const room = requireTeam(ws, info, msg.roomCode, msg.teamId); if (!room) return;
          room.submitFriendAnswer(msg.teamId, msg.answer); broadcast(msg.roomCode); break;
        }

        case "host:start_reading": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          // First activation from START has no node yet — activate on demand.
          if (!room.activeNodeId) {
            room.activateCurrentNode();
          }
          room.startReading();
          broadcast(msg.roomCode);
          break;
        }

        case "host:open_buzzers": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.openBuzzers();
          broadcast(msg.roomCode);
          break;
        }

        case "host:mark_correct": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.markCorrect(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "host:mark_wrong": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.markWrong(msg.teamId);
          broadcast(msg.roomCode);
          break;
        }

        case "host:skip_question": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.skipQuestion();
          broadcast(msg.roomCode);
          break;
        }

        case "host:pause": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.pause();
          broadcast(msg.roomCode);
          break;
        }

        case "host:resume": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.resume();
          broadcast(msg.roomCode);
          break;
        }

        case "host:adjust_score": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.adjustScore(msg.teamId, msg.delta);
          broadcast(msg.roomCode);
          break;
        }

        case "host:advance_final": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.advanceFinal();
          broadcast(msg.roomCode);
          break;
        }
        case "host:reveal_friend_answers": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.revealFriendAnswers(); broadcast(msg.roomCode); break;
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
