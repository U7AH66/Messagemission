import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callJSON } from "./claude.js";
import { mockCallJSON } from "./mock.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY_FILE = path.join(ROOT, "data", "history.json");
const AVOID_LIMIT = 30;

const call = process.env.MOCK ? mockCallJSON : callJSON;
const seedPools = JSON.parse(await readFile(path.join(ROOT, "prompts", "seeds.json"), "utf8"));

// 進行中のゲーム。プロトタイプなのでメモリに置くだけ（再起動で消える）
const games = new Map();

export class GameError extends Error {}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rollSeed(userOutline = null) {
  const seed = Object.fromEntries(Object.entries(seedPools).map(([k, list]) => [k, pick(list)]));
  seed.user_outline = userOutline;
  return seed;
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function appendHistory(summary) {
  const history = await loadHistory();
  history.push(summary);
  await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history.slice(-AVOID_LIMIT), null, 2));
}

function getGame(id) {
  const game = games.get(id);
  if (!game) throw new GameError("ゲームが見つからない。最初からやり直してね。");
  return game;
}

// クライアントに送ってはいけないもの（真相・伏線・エンディング条件）を落とす
function publicCard({ hidden, ...card }) {
  return card;
}

function publicScenario(s) {
  return {
    title: s.title,
    genre: s.genre,
    tone: s.tone,
    teaser: s.teaser,
    protagonist: s.protagonist,
    characters: s.characters.map((c) => ({ id: c.id, display_name: c.display_name, icon_hint: c.icon_hint })),
    chapterCount: s.chapters.length,
  };
}

function scoresSoFar(game) {
  const relations = Object.fromEntries(game.scenario.characters.map((c) => [c.id, 0]));
  let awareness = 0;
  let depth = 0;
  for (const ev of game.evals) {
    awareness += ev.awareness ?? 0;
    depth += ev.depth ?? 0;
    for (const r of ev.relations ?? []) relations[r.character] = (relations[r.character] ?? 0) + (r.delta ?? 0);
  }
  return { awareness, depth, relations };
}

// プレイ側がエンディングを返さずに最終章を閉じたときの保険
function chooseEnding(game) {
  const { awareness, depth, relations } = scoresSoFar(game);
  const max = game.evals.length * 10 || 1;
  const rel = Object.values(relations).reduce((a, b) => a + b, 0);
  const ratio = (awareness + depth) / max + rel * 0.03;
  if (ratio >= 0.65) return "high";
  if (ratio >= 0.35) return "mid";
  return "low";
}

function pastSummary(game) {
  const lines = [];
  for (let no = 1; no < game.chapter; no++) {
    lines.push(`## 第${no}章 ${game.scenario.chapters[no - 1].date}`);
    for (const m of game.logs[no] ?? []) {
      const who = m.from === "player" ? `主人公→${m.to}` : m.from;
      lines.push(`${who}: ${m.text ?? `[${m.type}${m.duration ? ` ${m.duration}` : ""}]`}`);
    }
    const ev = game.evals[no - 1];
    if (ev?.one_liner) lines.push(`（評価メモ：${ev.one_liner}）`);
  }
  return lines.join("\n");
}

async function playTurn(game, playerMessage) {
  const result = await call("3_play.md", {
    scenario: game.scenario,
    chapter: game.chapter,
    chapter_history: game.logs[game.chapter],
    past_summary: pastSummary(game),
    scores_so_far: scoresSoFar(game),
    player_message: playerMessage,
  }, "medium");

  const messages = (result.messages ?? []).map((m) => ({ ...m, chapter: game.chapter }));
  game.logs[game.chapter].push(...messages);

  const out = { messages, read: !!result.player_message_read, chapterEnd: false };
  if (!playerMessage || !result.chapter_end) return out;

  out.chapterEnd = true;
  const ev = await call("4_chapter_eval.md", {
    scenario: game.scenario,
    chapter: game.chapter,
    chapter_log: game.logs[game.chapter],
    clues_shown: result.clues_shown ?? [],
    hints_given: result.hints_given ?? 0,
  }, "low");
  game.evals[game.chapter - 1] = ev;
  out.evaluation = ev;

  const isLast = game.chapter >= game.scenario.chapters.length;
  if (result.ending || isLast) {
    game.ending = result.ending ?? chooseEnding(game);
    out.finished = true;
  }
  return out;
}

async function beginChapter(game) {
  game.logs[game.chapter] = [];
  return playTurn(game, null);
}

// ---- API から呼ぶ関数 ----

export async function makeCards({ outline }) {
  const count = outline ? 3 : 4;
  const history = await loadHistory();
  const { cards } = await call("1_preset.md", {
    seeds: Array.from({ length: count }, () => rollSeed(outline || null)),
    avoid: history,
  }, "medium");

  const id = randomUUID();
  games.set(id, { id, cards, logs: {}, evals: [] });
  return { gameId: id, cards: cards.map(publicCard) };
}

export async function startGame({ gameId, cardId, custom }) {
  let game;
  let input;
  if (custom) {
    game = { id: randomUUID(), logs: {}, evals: [] };
    games.set(game.id, game);
    input = { mode: "custom", card: null, custom };
  } else {
    game = getGame(gameId);
    const card = game.cards.find((c) => c.id === cardId);
    if (!card) throw new GameError("そのカードは見つからない");
    input = { mode: "card", card, custom: null };
  }

  game.scenario = await call("2_scenario.md", input, "high");
  game.chapter = 1;
  const first = await beginChapter(game);
  return { gameId: game.id, scenario: publicScenario(game.scenario), chapter: 1, ...first };
}

export async function sendMessage({ gameId, to, text }) {
  const game = getGame(gameId);
  if (game.ending) throw new GameError("このゲームはもう終わってる");
  if (!text?.trim()) throw new GameError("メッセージが空だよ");
  if (!game.scenario.characters.some((c) => c.id === to)) throw new GameError("送り先が見つからない");

  const msg = { from: "player", to, type: "text", text: text.trim(), chapter: game.chapter };
  game.logs[game.chapter].push(msg);
  return playTurn(game, { to, text: msg.text, time: null });
}

export async function nextChapter({ gameId }) {
  const game = getGame(gameId);
  if (game.ending) throw new GameError("もう最終章まで終わってる");
  if (!game.evals[game.chapter - 1]) throw new GameError("まだこの章は終わってない");
  game.chapter++;
  return { chapter: game.chapter, ...(await beginChapter(game)) };
}

export async function finishGame({ gameId }) {
  const game = getGame(gameId);
  if (!game.ending) throw new GameError("まだ最後まで進んでない");
  if (!game.result) {
    const fullLog = Object.keys(game.logs).sort((a, b) => a - b).flatMap((no) =>
      game.logs[no].map((m, index) => ({ ...m, index })),
    );
    game.result = await call("5_ending.md", {
      scenario: game.scenario,
      ending: game.ending,
      full_log: fullLog,
      chapter_evals: game.evals,
    }, "high");
    if (game.result.summary_for_history) await appendHistory(game.result.summary_for_history);
  }
  return game.result;
}
