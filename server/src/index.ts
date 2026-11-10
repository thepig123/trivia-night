import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { httpServer, bankStore, isEditorKey } from "./bankHttp.js";
import { playableQuestions } from "./bank.js";
import { localTestingAllowed } from "./localTesting.js";
import { validateMessage } from "./protocol.js";
import { RoomStore } from "./roomStore.js";
import { GameEngine } from "./gameState.js";
import type { ClientMessage, ServerMessage, TestControllerSession } from "./types.js";

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

const roomStore = new RoomStore();
const resumeAllRooms = process.env.RESUME_ROOMS === "true";
for (const saved of roomStore?.load() ?? []) {
  if (!resumeAllRooms && !saved.state.eventMode) continue;
  const game=GameEngine.restore(saved.state);
  rooms.set(game.roomCode,game);
  hostSessionTokens.set(game.roomCode,saved.hostToken);
  teamSessionTokens.set(game.roomCode,new Map(saved.teamTokens));
}
function persistRooms() {
  roomStore?.save([...rooms].filter(([,game])=>resumeAllRooms || game.eventMode).map(([code,game])=>({state:game.exportState(),hostToken:hostSessionTokens.get(code)!,teamTokens:[...(teamSessionTokens.get(code) ?? new Map<string,string>())]})));
}
for (const signal of ["SIGTERM","SIGINT"] as const) process.once(signal,()=>{ try{persistRooms();}finally{process.exit(0);} });

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

function sendError(ws: WebSocket, message: string, code?: "session_expired") {
  send(ws, { type: "error", message, code });
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

function refreshPresence(roomCode: string, teamId: string) {
  const connected = rooms.get(roomCode)?.isTestRoom || [...clients.values()].some(client => client.roomCode === roomCode && client.teamId === teamId && client.role === "team" && client.ws.readyState === WebSocket.OPEN);
  rooms.get(roomCode)?.setConnected(teamId, connected);
}
function identify(info: ClientInfo, role: Role, roomCode: string, teamId: string | null = null) {
  const oldRoom = info.roomCode, oldTeam = info.teamId, oldRole = info.role;
  info.role = role; info.roomCode = roomCode; info.teamId = teamId;
  if (oldRoom && oldTeam && (oldRoom !== roomCode || oldTeam !== teamId)) {
    refreshPresence(oldRoom, oldTeam); broadcast(oldRoom);
  }
  if (oldRoom && oldRole === "host" && (role !== "host" || oldRoom !== roomCode)) {
    if (![...clients.values()].some(c=>c.role==="host"&&c.roomCode===oldRoom&&c.ws.readyState===WebSocket.OPEN)) rooms.get(oldRoom)?.pause();
    broadcast(oldRoom);
  }
  if (teamId) refreshPresence(roomCode, teamId);
}

/** Broadcast the current state to everyone connected to a room, role-appropriately. */
function broadcast(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  let saveError: string | null = null;
  try { persistRooms(); } catch { saveError = "Kunne ikke lagre spillfremdriften. Sjekk at runtime-mappen kan skrives til."; }
  const publicState = room.toPublicState();
  const hostState = room.toHostState();
  for (const [ws, info] of clients) {
    if (info.roomCode !== roomCode) continue;
    if (info.role === "host") {
      send(ws, { type: "state:host", state: hostState });
      if (saveError) sendError(ws,saveError);
    } else {
      send(ws, { type: "state:public", state: publicState });
    }
  }
}

const wss = new WebSocketServer({ server: httpServer, maxPayload: 600_000 });
const alive = new WeakSet<WebSocket>();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) { ws.terminate(); continue; }
    alive.delete(ws); ws.ping();
  }
}, 15_000);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));

wss.on("connection", (ws, request) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  ws.on("error", () => {});
  clients.set(ws, { ws, role: null, roomCode: null, teamId: null });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = validateMessage(JSON.parse(raw.toString()));
    } catch (error) {
      sendError(ws, error instanceof SyntaxError ? "Ugyldig JSON-melding." : error instanceof Error ? error.message : "Ugyldig melding.");
      return;
    }

    const info = clients.get(ws)!;

    try {
      switch (msg.type) {
        case "host:list_events": {
         if (!isEditorKey(msg.adminKey)) return sendError(ws,"Gyldig redaktørnøkkel kreves.");
         send(ws,{type:"host:events",events:[...rooms.values()].filter(r=>r.eventMode).map(r=>({roomCode:r.roomCode,phase:r.phase,teams:r.teams.map(t=>t.name),startedAt:r.startedAt}))});
         break;
       }
       case "host:recover_event": {
         if (!isEditorKey(msg.adminKey)) return sendError(ws,"Gyldig redaktørnøkkel kreves.");
         const room=rooms.get(msg.roomCode);
         if(!room?.eventMode) return sendError(ws,"Fant ikke en lagret spillkveld med denne romkoden.");
         room.pause();
         identify(info,"host",msg.roomCode);
         send(ws,{type:"room:created",roomCode:msg.roomCode,sessionToken:hostSessionTokens.get(msg.roomCode)!});
         broadcast(msg.roomCode);break;
       }
       case "host:create_room": {
          if (!isEditorKey(msg.adminKey)) return sendError(ws,"Gyldig redaktørnøkkel kreves for å opprette et vertsrom.");
          if (msg.testMode && !localTestingAllowed(request.socket.remoteAddress)) return sendError(ws,"Testrom er bare tilgjengelig på localhost utenfor produksjon.");
          if (msg.testMode && msg.eventMode) return sendError(ws,"Testrom kan ikke være en spillkveld.");
          const code = makeRoomCode();
          const bank = bankStore.get();
          const pool = playableQuestions(bank);
          const pack=bank.packs.find(p=>p.id===bank.activePackId)!;
          const finalIds = pack.finalQuestionIds ?? [];
          const playoffIds = pack.playoffQuestionIds ?? [];
          if (!pool.length) return sendError(ws, "Kveldspakken har ingen klare, valgte spørsmål. Åpne spørsmålsbanken først.");
          if (pool.every(q=>finalIds.includes(q.id) || playoffIds.includes(q.id))) return sendError(ws,"Pakken trenger minst ett klart hovedspørsmål utenfor kvalifiserings- og finalepotten.");
          const room = new GameEngine(code, pool, finalIds, playoffIds);
          if(msg.eventMode && pool.length-room.reservedFinalQuestionIds.length<9) return sendError(ws,"En spillkveld trenger fem kvalifiseringsspørsmål, tre duellspørsmål og minst ett hovedspørsmål utenfor finalepotten. Legg til flere klare spørsmål.");
          room.eventMode = !!msg.eventMode;
          room.initializeDefaultTeams();
          rooms.set(code, room);
          const sessionToken = nanoid(32);
          hostSessionTokens.set(code, sessionToken);
          teamSessionTokens.set(code, new Map());
          const testControllers: TestControllerSession[] = [];
          if (msg.testMode) {
            room.isTestRoom = true;
            for (let index=1; index<=4; index++) {
              const team=room.registerTeam(`Testlag ${index}`,[`Testspiller ${index}A`,`Testspiller ${index}B`])!;
              const token=nanoid(32);teamSessionTokens.get(code)!.set(team.id,token);
              testControllers.push({roomCode:code,teamId:team.id,sessionToken:token,teamName:team.name});
            }
          }
          identify(info, "host", code);
          send(ws, { type: "room:created", roomCode: code, sessionToken, ...(msg.testMode ? {testControllers} : {}) });
          broadcast(code);
          break;
        }

        case "host:add_team": {
          const room = requireHost(ws, info, msg.roomCode); if (!room || room.phase !== "lobby" || room.teams.length >= 5) return;
          room.addTeam(`Team ${room.teams.length + 1}`); room.teams.at(-1)!.connected = false; broadcast(msg.roomCode); break;
        }
        case "host:remove_team": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.removeTeam(msg.teamId); if (!room.teams.some(team => team.id === msg.teamId)) teamSessionTokens.get(msg.roomCode)?.delete(msg.teamId); broadcast(msg.roomCode); break;
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
          if (!room) return sendError(ws, "Forrige spill er avsluttet. Bli med i eller opprett et nytt rom.", "session_expired");
          if (hostSessionTokens.get(msg.roomCode) !== msg.sessionToken) return sendError(ws, "Ugyldig vertsøkt. Opprett et nytt rom.", "session_expired");
          identify(info, "host", msg.roomCode);
          broadcast(msg.roomCode);
          break;
        }

        case "tv:hello": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, "Forrige spill er avsluttet. Bli med i eller opprett et nytt rom.", "session_expired");
          identify(info, "tv", msg.roomCode);
          broadcast(msg.roomCode);
          break;
        }

        case "team:join": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, `Fant ikke rom ${msg.roomCode}.`);
          const team = room.registerTeam(msg.teamName, msg.players, msg.photoDataUrl);
          if (!team) return sendError(ws, "Skriv inn lagnavn og to spillernavn. Rommet støtter opptil fem lag.");
          const sessionToken = nanoid(32);
          teamSessionTokens.get(msg.roomCode)?.set(team.id, sessionToken);
          identify(info, "team", msg.roomCode, team.id);
          send(ws, { type: "team:joined", teamId: team.id, roomCode: msg.roomCode, sessionToken });
          broadcast(msg.roomCode);
          break;
        }

        case "team:resume": {
          const room = rooms.get(msg.roomCode);
          if (!room) return sendError(ws, "Forrige spill er avsluttet. Bli med i eller opprett et nytt rom.", "session_expired");
          if (teamSessionTokens.get(msg.roomCode)?.get(msg.teamId) !== msg.sessionToken) {
            return sendError(ws, "Ugyldig lagøkt. Bli med i et nytt rom.", "session_expired");
          }
          if (!room.teams.some((team) => team.id === msg.teamId)) return sendError(ws, "Fant ikke laget.");
          identify(info, "team", msg.roomCode, msg.teamId);
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

        case "host:choose_route": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.chooseRouteByHost(msg.nodeId); broadcast(msg.roomCode); break;
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
          if (room.phase === "lobby" && room.teams.length < 2) return sendError(ws,"Minst to lag må være med før spillet starter.");
          // First activation from START has no node yet — activate on demand.
          if (!room.activeNodeId && room.phase === "lobby") {
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

        case "host:undo": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.undo(); broadcast(msg.roomCode); break;
        }
        case "host:replace_question": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          if (!room.replaceQuestion()) sendError(ws,"Ingen alternative spørsmål igjen i kveldspakken.");
          broadcast(msg.roomCode); break;
        }
        case "host:finish_route": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.finishRoutePhase(); broadcast(msg.roomCode); break;
        }
        case "host:select_duelists": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.selectDuelists(msg.teamIds); broadcast(msg.roomCode); break;
        }
        case "host:select_finalists": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.selectFinalists(msg.teamIds); broadcast(msg.roomCode); break;
        }
        case "host:configure_lobby": {
          const room=requireHost(ws,info,msg.roomCode);if(!room)return;
          if(!room.configureLobby(msg.title,msg.joinUrl,msg.musicUrl))return sendError(ws,"Bruk en gyldig HTTP(S)-adresse for deltakere og HTTP(S) eller /media/ for musikk. Lobbyen kan bare endres før start.");
          broadcast(msg.roomCode);break;
        }
        case "host:advance_playoff": {
          const room=requireHost(ws,info,msg.roomCode);if(!room)return;
          room.advancePlayoff();broadcast(msg.roomCode);break;
        }
        case "host:select_first_qualifier": {
          const room=requireHost(ws,info,msg.roomCode);if(!room)return;
          room.selectFirstQualifier(msg.teamId);broadcast(msg.roomCode);break;
        }
        case "host:advance_final": {
          const room = requireHost(ws, info, msg.roomCode);
          if (!room) return;
          room.advanceFinal();
          broadcast(msg.roomCode);
          break;
        }
        case "host:advance_image": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.advanceImage(); broadcast(msg.roomCode); break;
        }
        case "host:dismiss_question_card": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.dismissQuestionCard(); broadcast(msg.roomCode); break;
        }
        case "host:reveal_question": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.revealQuestion(); broadcast(msg.roomCode); break;
        }
        case "host:reveal_friend_answers": {
          const room = requireHost(ws, info, msg.roomCode); if (!room) return;
          room.revealFriendAnswers(); broadcast(msg.roomCode); break;
        }

        default:
          sendError(ws, "Ukjent meldingstype.");
      }
    } catch (err) {
      console.error(err);
      sendError(ws, "Serveren kunne ikke behandle meldingen.");
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    if (info?.role === "team" && info.roomCode && info.teamId) {
      const room = rooms.get(info.roomCode);
      clients.delete(ws);
      refreshPresence(info.roomCode, info.teamId);
      broadcast(info.roomCode);
    }
    clients.delete(ws);
    if (info?.role === "host" && info.roomCode) {
      if (![...clients.values()].some(c=>c.role==="host"&&c.roomCode===info.roomCode&&c.ws.readyState===WebSocket.OPEN)) rooms.get(info.roomCode)?.pause();
      broadcast(info.roomCode);
    }
  });
});

const clockTicker=setInterval(()=>{
  for(const [code,room] of rooms)if(room.tick())broadcast(code);
},200);
clockTicker.unref();

httpServer.listen(PORT, () => {
  const address = httpServer.address();
  console.log(`TRIVIA NIGHT server listening on ws://localhost:${typeof address === "object" && address ? address.port : PORT}`);
});
