import type { ClientMessage } from "./types.js";

const fields: Record<string,string[]> = {
  "host:undo":[], "host:replace_question":[],
  "host:create_room":[], "host:add_team":[], "host:remove_team":["teamId"], "host:update_team":["teamId","name","players"],
  "host:set_target":["targetScore"], "host:resume_room":["sessionToken"], "team:join":["teamName","players","photoDataUrl?"],
  "team:resume":["teamId","sessionToken"], "team:buzz":["teamId"], "team:choose_route":["teamId","nodeId"],
  "host:choose_route":["nodeId"], "team:submit_friend_answer":["teamId","answer"], "tv:hello":[],
  "host:start_reading":[], "host:open_buzzers":[], "host:mark_correct":["teamId"], "host:mark_wrong":["teamId"],
  "host:skip_question":[], "host:pause":[], "host:resume":[], "host:adjust_score":["teamId","delta"],
  "host:advance_final":[], "host:finish_route":[], "host:select_finalists":["teamIds"], "host:reveal_friend_answers":[], "host:reveal_question":[],
};
export function validateMessage(value: unknown): ClientMessage {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Meldingen må være et objekt.");
  const data=value as Record<string,unknown>;
  if(typeof data.type!=="string" || !Object.hasOwn(fields,data.type)) throw new Error("Ukjent meldingstype.");
  const expected=[...(data.type==="host:create_room"?[]:["roomCode"]),...fields[data.type]];
  const allowed=new Set(["type",...expected.map(f=>f.replace("?",""))]);
  if(Object.keys(data).some(key=>!allowed.has(key))) throw new Error("Meldingen inneholder ukjente felt.");
  const text=(v:unknown,max:number)=>typeof v==="string" && v.trim().length>0 && v.length<=max;
  const id=(v:unknown)=>text(v,64)&&/^[A-Za-z0-9_-]+$/.test(v as string);
  for(const field of expected){
    const key=field.replace("?","");const item=data[key];if(field.endsWith("?")&&item===undefined)continue;
    let valid=false;
    switch(key){
      case "roomCode":valid=typeof item==="string"&&/^[A-Z0-9]{5}$/.test(item);break;
      case "teamId":case "nodeId":valid=id(item);break;
      case "teamIds":valid=Array.isArray(item)&&item.length===2&&item.every(id)&&new Set(item).size===2;break;
      case "teamName":case "name":valid=text(item,24);break;
      case "players":valid=Array.isArray(item)&&item.length===2&&item.every(v=>text(v,24));break;
      case "sessionToken":valid=text(item,128);break;
      case "answer":valid=text(item,20000);break;
      case "photoDataUrl":valid=typeof item==="string"&&item.length<=450000&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item);break;
      case "delta":valid=Number.isSafeInteger(item)&&Math.abs(item as number)<=100000;break;
      case "targetScore":valid=Number.isSafeInteger(item)&&(item as number)>=1000&&(item as number)<=20000;break;
    }
    if(!valid)throw new Error(`Ugyldig felt: ${key}.`);
  }
  return data as unknown as ClientMessage;
}
