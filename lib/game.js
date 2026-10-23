import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callJSON } from "./claude.js";
import { mockCallJSON } from "./mock.js";
import { createEngine } from "./engine.js";

export { GameError } from "./engine.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY_FILE = path.join(ROOT, "data", "history.json");

// 進行中のゲーム。プロトタイプなのでメモリに置くだけ（再起動で消える）
const games = new Map();

const engine = createEngine({
  call: process.env.MOCK ? mockCallJSON : callJSON,
  seedPools: JSON.parse(await readFile(path.join(ROOT, "prompts", "seeds.json"), "utf8")),
  newId: randomUUID,
  store: {
    save: (game) => games.set(game.id, game),
    load: (id) => games.get(id) ?? null,
  },
  history: {
    async load() {
      try {
        return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
      } catch {
        return [];
      }
    },
    async append(summary) {
      const list = await this.load();
      list.push(summary);
      await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
      await writeFile(HISTORY_FILE, JSON.stringify(list.slice(-30), null, 2));
    },
  },
});

export const { makeCards, startGame, sendMessage, nextChapter, finishGame, resumeGame } = engine;
