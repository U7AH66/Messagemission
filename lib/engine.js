// ゲーム進行の本体。Node（server.js）とブラウザ（claude.ai版）の両方で動くように、
// AI呼び出しと履歴の保存は外から渡す。

export class GameError extends Error {}

const AVOID_LIMIT = 30;

const EFFORT = {
  "1_preset.md": "medium",
  "2_scenario.md": "high",
  "3_play.md": "medium",
  "4_chapter_eval.md": "low",
  "5_ending.md": "high",
};

/**
 * call(promptFile, input, effort) -> 出力JSON
 * history: { load() -> string[], append(summary) }
 * store:   { save(game), load(id) -> game | null }  ゲームの保存先
 */
export function createEngine({ call, history, store, seedPools, newId }) {
  const ask = (file, input) => call(file, input, EFFORT[file]);

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function rollSeed(userOutline) {
    const seed = Object.fromEntries(Object.entries(seedPools).map(([k, list]) => [k, pick(list)]));
    seed.user_outline = userOutline;
    return seed;
  }

  async function getGame(id) {
    const game = await store.load(id);
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
      if (!ev) continue;
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
    const result = await ask("3_play.md", {
      scenario: game.scenario,
      chapter: game.chapter,
      chapter_history: game.logs[game.chapter],
      past_summary: pastSummary(game),
      scores_so_far: scoresSoFar(game),
      player_message: playerMessage,
    });

    const messages = (result.messages ?? []).map((m) => ({ ...m, chapter: game.chapter }));
    game.logs[game.chapter].push(...messages);
    if (result.player_message_read) {
      for (const m of game.logs[game.chapter]) if (m.from === "player") m.read = true;
    }

    const out = { messages, read: !!result.player_message_read, chapterEnd: false };
    if (playerMessage && result.chapter_end) {
      out.chapterEnd = true;
      const ev = await ask("4_chapter_eval.md", {
        scenario: game.scenario,
        chapter: game.chapter,
        chapter_log: game.logs[game.chapter],
        clues_shown: result.clues_shown ?? [],
        hints_given: result.hints_given ?? 0,
      });
      game.evals[game.chapter - 1] = ev;
      out.evaluation = ev;

      const isLast = game.chapter >= game.scenario.chapters.length;
      if (result.ending || isLast) {
        game.ending = result.ending ?? chooseEnding(game);
        out.finished = true;
      }
    }
    await store.save(game);
    return out;
  }

  async function beginChapter(game) {
    game.logs[game.chapter] = [];
    return playTurn(game, null);
  }

  return {
    async makeCards({ outline }) {
      const count = outline ? 3 : 4;
      const { cards } = await ask("1_preset.md", {
        seeds: Array.from({ length: count }, () => rollSeed(outline || null)),
        avoid: (await history.load()).slice(-AVOID_LIMIT),
      });

      const game = { id: newId(), cards, logs: {}, evals: [] };
      await store.save(game);
      return { gameId: game.id, cards: cards.map(publicCard) };
    },

    async startGame({ gameId, cardId, custom }) {
      let game;
      let input;
      if (custom) {
        game = { id: newId(), logs: {}, evals: [] };
        input = { mode: "custom", card: null, custom };
      } else {
        game = await getGame(gameId);
        const card = game.cards.find((c) => c.id === cardId);
        if (!card) throw new GameError("そのカードは見つからない");
        input = { mode: "card", card, custom: null };
      }

      game.scenario = await ask("2_scenario.md", input);
      game.chapter = 1;
      const first = await beginChapter(game);
      return { gameId: game.id, scenario: publicScenario(game.scenario), chapter: 1, ...first };
    },

    async sendMessage({ gameId, to, text }) {
      const game = await getGame(gameId);
      if (game.ending) throw new GameError("このゲームはもう終わってる");
      if (!text?.trim()) throw new GameError("メッセージが空だよ");
      if (!game.scenario.characters.some((c) => c.id === to)) throw new GameError("送り先が見つからない");

      const msg = { from: "player", to, type: "text", text: text.trim(), chapter: game.chapter };
      game.logs[game.chapter].push(msg);
      try {
        return await playTurn(game, { to, text: msg.text, time: null });
      } catch (err) {
        // AIの返事が来なかったら、送ってないことにする
        game.logs[game.chapter].pop();
        throw err;
      }
    },

    async nextChapter({ gameId }) {
      const game = await getGame(gameId);
      if (game.ending) throw new GameError("もう最終章まで終わってる");
      if (!game.evals[game.chapter - 1]) throw new GameError("まだこの章は終わってない");
      game.chapter++;
      try {
        return { chapter: game.chapter, ...(await beginChapter(game)) };
      } catch (err) {
        delete game.logs[game.chapter];
        game.chapter--;
        throw err;
      }
    },

    async finishGame({ gameId }) {
      const game = await getGame(gameId);
      if (!game.ending) throw new GameError("まだ最後まで進んでない");
      if (!game.result) {
        const fullLog = Object.keys(game.logs).sort((a, b) => a - b).flatMap((no) =>
          game.logs[no].map((m, index) => ({ ...m, index })),
        );
        game.result = await ask("5_ending.md", {
          scenario: game.scenario,
          ending: game.ending,
          full_log: fullLog,
          chapter_evals: game.evals,
        });
        if (game.result.summary_for_history) await history.append(game.result.summary_for_history);
        await store.save(game);
      }
      return game.result;
    },

    // 途中から再開するための情報（真相は含めない）
    async resumeGame({ gameId }) {
      const game = await getGame(gameId);
      if (!game.scenario) throw new GameError("まだ始まってないゲーム");
      return {
        gameId: game.id,
        scenario: publicScenario(game.scenario),
        chapter: game.chapter,
        logs: game.logs,
        chapterEnded: !!game.evals[game.chapter - 1],
        evaluation: game.evals[game.chapter - 1] ?? null,
        finished: !!game.ending,
        result: game.result ?? null,
      };
    },
  };
}
