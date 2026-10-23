import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { GameError, makeCards, startGame, sendMessage, nextChapter, finishGame } from "./lib/game.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 3000;

const routes = {
  "/api/cards": makeCards,
  "/api/start": startGame,
  "/api/send": sendMessage,
  "/api/next": nextChapter,
  "/api/finish": finishGame,
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8` });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

function errorMessage(err) {
  if (err instanceof GameError) return [400, err.message];
  if (err instanceof Anthropic.AuthenticationError) return [500, "APIキーが無効。ANTHROPIC_API_KEY を確認してね。"];
  if (err instanceof Anthropic.RateLimitError) return [429, "混んでるみたい。少し待ってもう一回送ってね。"];
  if (err instanceof Anthropic.APIConnectionError) return [502, "AIにつながらなかった。もう一回試してね。"];
  if (err instanceof Anthropic.APIError) return [502, `AIのエラー：${err.message}`];
  if (err instanceof SyntaxError) return [502, "AIの返事がうまく読めなかった。もう一回試してね。"];
  return [500, err.message || "なにかエラーが起きた"];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    const handler = routes[url.pathname];
    if (handler) {
      if (req.method !== "POST") return send(res, 405, { error: "POST only" });
      return send(res, 200, await handler(await readBody(req)));
    }

    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, "not found", "text/plain");
    send(res, 200, await readFile(full), TYPES[path.extname(full)] ?? "text/plain");
  } catch (err) {
    if (err.code === "ENOENT") return send(res, 404, "not found", "text/plain");
    const [status, message] = errorMessage(err);
    if (status >= 500) console.error(err);
    send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} ${process.env.MOCK ? "(MOCK)" : ""}`);
});
