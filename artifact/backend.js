// claude.ai版のバックエンド：AIは claude.use("sample") 経由、保存はこのブラウザの中
// PROMPTS と SEED_POOLS はビルド時に埋め込まれる

const TIER = {
  "1_preset.md": "default",
  "2_scenario.md": "complex",
  "3_play.md": "default",
  "4_chapter_eval.md": "default",
  "5_ending.md": "complex",
};

const SAMPLE_ERRORS = {
  not_granted: "AIの利用が許可されてない。ページを開き直して「許可」を選んでね。",
  sampling_disabled: "このアカウントではAIが使えないみたい。",
  rate_limited: "使いすぎか混雑で止められた。少し待ってからもう一回送ってね。",
  session_expired: "ログインが切れてる。claude.aiにログインし直してね。",
  refused: "AIがこの内容を断った。言い方を変えてみてね。",
  invalid_json: "AIの返事がうまく読めなかった。もう一回試してね。",
  empty_completion: "AIの返事が空だった。もう一回試してね。",
  prompt_too_large: "話が長くなりすぎた。",
};

let samplePromise;
function getSample() {
  samplePromise ??= window.claude?.use ? window.claude.use("sample") : Promise.resolve(null);
  return samplePromise;
}

async function sampleCall(file, input, effort) {
  const sample = await getSample();
  if (!sample) throw new GameError("ここではAIが使えない。claude.aiでこのページを開いてね。");
  const prompt = `${PROMPTS[file]}\n\n---\n\n# 今回の入力\n\n${JSON.stringify(input)}\n\n上の指示どおりの形式で、JSONだけを返してください。`;
  try {
    return await sample.json(prompt, { modelTier: TIER[file], effort, cache: false });
  } catch (e) {
    throw new GameError(SAMPLE_ERRORS[e?.code] ?? "AIにつながらなかった。もう一回試してね。");
  }
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// 保存できない環境でも、開いてる間は遊べるようにメモリにも置く
const memoryGames = new Map();
const MAX_SAVED_GAMES = 5;

const engine = createEngine({
  call: sampleCall,
  seedPools: SEED_POOLS,
  newId: () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  store: {
    save(game) {
      memoryGames.set(game.id, game);
      const ids = readLocal("gameIds", []).filter((id) => id !== game.id);
      ids.push(game.id);
      for (const old of ids.splice(0, Math.max(0, ids.length - MAX_SAVED_GAMES))) {
        try {
          localStorage.removeItem(`game:${old}`);
        } catch {}
      }
      writeLocal("gameIds", ids);
      writeLocal(`game:${game.id}`, game);
    },
    load(id) {
      return memoryGames.get(id) ?? readLocal(`game:${id}`, null);
    },
  },
  history: {
    load: () => readLocal("history", []),
    append: (summary) => writeLocal("history", [...readLocal("history", []), summary].slice(-30)),
  },
});

const backend = {
  cards: engine.makeCards,
  start: engine.startGame,
  send: engine.sendMessage,
  next: engine.nextChapter,
  finish: engine.finishGame,
  resume: engine.resumeGame,
};
