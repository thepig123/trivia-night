import type { TestControllerSession } from "../types";
export const localTestingHost = (hostname: string) => ["localhost","127.0.0.1","::1","[::1]"].includes(hostname);
export function parseTestControllers(text: string): TestControllerSession[] {
  const value: unknown=JSON.parse(text);
  if(!Array.isArray(value)||value.length!==4)throw new Error("Ugyldig testrom.");
  for(const session of value)if(!session || !/^[A-Z0-9]{5}$/.test(session.roomCode) || !/^[A-Za-z0-9_-]{8}$/.test(session.teamId) || !/^[A-Za-z0-9_-]{32}$/.test(session.sessionToken) || typeof session.teamName!=="string")throw new Error("Ugyldig testøkt.");
  if(new Set(value.map(s=>s.roomCode)).size!==1||new Set(value.map(s=>s.teamId)).size!==4)throw new Error("Ugyldig testrom.");
  return value;
}
export function testControllerUrl(sessions: TestControllerSession[], origin: string) {
  return `${origin}/join#test=${encodeURIComponent(JSON.stringify(sessions))}`;
}
