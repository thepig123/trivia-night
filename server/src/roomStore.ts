import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "./gameState.js";

export interface SavedRoom { state: Record<string, unknown>; hostToken: string; teamTokens: [string,string][] }
export class RoomStore {
  constructor(private path = resolve(process.env.BANK_DATA_DIR ?? fileURLToPath(new URL("../runtime/",import.meta.url)), "rooms.json")) {}
  load(): SavedRoom[] {
    try {
      const data=JSON.parse(readFileSync(this.path,"utf8"));
      if(data.version!==1 || !Array.isArray(data.rooms)) throw new Error("Ukjent romformat.");
      for(const room of data.rooms) {
        if(typeof room.hostToken!=="string" || !Array.isArray(room.teamTokens)) throw new Error("Ugyldig lagret rom.");
        GameEngine.restore(room.state);
      }
      return data.rooms;
    } catch(error:any) {
      if(error.code==="ENOENT") return [];
      throw new Error("Kunne ikke lese lagrede rom. Bevar rooms.json og gjenopprett en sikkerhetskopi før ny oppstart.");
    }
  }
  save(rooms: SavedRoom[]) {
    mkdirSync(dirname(this.path),{recursive:true});
    writeFileSync(this.path+".tmp",JSON.stringify({version:1,rooms}),{mode:0o600});
    renameSync(this.path+".tmp",this.path);
  }
}
