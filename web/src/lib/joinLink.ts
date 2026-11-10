export function joinLink(configured: string, origin: string, roomCode: string): string | null {
  try {
    const url=new URL(configured || "/join",origin);
    if(!["http:","https:"].includes(url.protocol) || url.username || url.password)return null;
    if(["localhost","127.0.0.1","[::1]","::1"].includes(url.hostname))return null;
    if(url.pathname==="/")url.pathname="/join";
    url.hash="";url.searchParams.set("room",roomCode);
    return url.toString();
  }catch{return null;}
}
export function roomFromQuery(search: string): string {
  const code=new URLSearchParams(search).get("room")?.toUpperCase()??"";
  return /^[A-Z0-9]{5}$/.test(code)?code:"";
}
