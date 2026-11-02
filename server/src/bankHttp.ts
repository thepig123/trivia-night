import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BankStore } from "./bank.js";

export const bankStore = new BankStore();
const directory = resolve(process.env.BANK_DATA_DIR ?? new URL("../runtime/", import.meta.url).pathname);
mkdirSync(directory, { recursive: true });
const keyPath = resolve(directory, "admin-key.txt");
let adminKey = process.env.BANK_ADMIN_KEY;
if (!adminKey) {
  try { adminKey = readFileSync(keyPath, "utf8").trim(); }
  catch { adminKey = randomBytes(24).toString("hex"); writeFileSync(keyPath, adminKey, { mode: 0o600 }); }
}
console.log(`Spørsmålsbank: /questions — redaktørnøkkel: ${adminKey}`);
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error("Filen er for stor (maks 15 MB før opplasting).");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export const httpServer = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const reply = (status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  try {
    if (req.method === "GET" && /^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|gif|webp|mp3|wav|ogg|m4a)$/.test(path)) {
      try {
        const data = readFileSync(resolve(directory, path.slice(1)));
        const ext = path.split(".").at(-1)!;
        const types: Record<string,string> = {png:"image/png",jpg:"image/jpeg",gif:"image/gif",webp:"image/webp",mp3:"audio/mpeg",wav:"audio/wav",ogg:"audio/ogg",m4a:"audio/mp4"};
        res.writeHead(200, {"Content-Type": types[ext], "Cache-Control":"public, max-age=31536000, immutable", "X-Content-Type-Options":"nosniff"}); res.end(data);
      } catch { reply(404, {error:"Fant ikke mediefilen."}); }
      return;
    }
    if (!path.startsWith("/api/bank")) return reply(404, {error:"Not found"});
    if (req.headers.authorization !== `Bearer ${adminKey}`) return reply(401, {error:"Skriv inn redaktørnøkkelen fra serverterminalen."});
    if (req.method === "GET" && path === "/api/bank") return reply(200, bankStore.get());
    if (req.method === "PUT" && path === "/api/bank") return reply(200, bankStore.save(await body(req)));
    if (req.method === "POST" && path === "/api/bank/media") {
      const upload = await body(req);
      const extensions: Record<string,string> = {"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","audio/mpeg":"mp3","audio/wav":"wav","audio/x-wav":"wav","audio/ogg":"ogg","audio/mp4":"m4a"};
      const ext = extensions[upload.mime];
      if (!ext || typeof upload.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(upload.data)) throw new Error("Støttet: PNG, JPEG, GIF, WebP, MP3, WAV, OGG eller M4A.");
      const bytes = Buffer.from(upload.data, "base64");
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("Mediefilen må være mellom 1 byte og 15 MB.");
      const name = `${randomBytes(16).toString("hex")}.${ext}`;
      mkdirSync(resolve(directory,"media"), {recursive:true}); writeFileSync(resolve(directory,"media", name), bytes);
      return reply(201, {url:`/media/${name}`,type:upload.mime.startsWith("image/") ? "image" : "audio"});
    }
    reply(405, {error:"Ukjent handling."});
  } catch (error) { reply(400, {error: error instanceof Error ? error.message : "Kunne ikke lagre."}); }
});
