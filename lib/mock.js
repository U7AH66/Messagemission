// APIキーなしで画面を確認するための固定レスポンス（MOCK=1 のとき使う）

const scenario = {
  title: "また今度で",
  genre: "家族",
  tone: "泣ける",
  teaser: "最近、お父さんが電話に出ない。LINEはいつも通りなのに。",
  protagonist: { name: "みほ", age: 27, situation: "東京で一人暮らしの会社員" },
  truth: "父は喉のがんの手術で声を失っていて、それを娘に隠している",
  characters: [
    {
      id: "father", display_name: "お父さん", relation: "父", personality: "無口で不器用",
      texting_style: "短文、句読点なし、たまに絵文字", knows_truth: "全部", knows_detail: "自分の病気のすべて",
      reason_to_hide: "娘の幸せな時期に心配をかけたくない", never_says: "声が出ない", icon_hint: "盆栽",
    },
    {
      id: "mother", display_name: "お母さん", relation: "母", personality: "明るいが嘘が下手",
      texting_style: "丁寧、句読点あり", knows_truth: "全部", knows_detail: "夫の病気のすべて",
      reason_to_hide: "夫に口止めされている", never_says: "手術", icon_hint: "花",
    },
  ],
  chapters: [
    {
      no: 1, date: "5/11(月)", event: "父から短い電話", opener: { from: "father", type: "call", text: "" },
      clues: [{ id: "c1-1", what: "通話時間0:48", level: 1 }], hints_if_pushed: ["忙しかっただけ"], end_condition: "会話がひと段落",
    },
    {
      no: 2, date: "7/3(金)", event: "誕生日がLINEだけ", opener: { from: "father", type: "text", text: "誕生日おめでとう🎂" },
      clues: [{ id: "c2-1", what: "毎年の電話がない", level: 2 }], hints_if_pushed: ["もう27だし"], end_condition: "会話がひと段落",
    },
  ],
  endings: {
    high: { condition: "", reveal: "父から手書きの文字の写真が届く" },
    mid: { condition: "", reveal: "母から聞く" },
    low: { condition: "", reveal: "母からの長文で知る" },
  },
  hindsight: [
    { chapter: 1, clue_id: "c1-1", clue: "通話時間0:48", meaning: "声を出そうとしたけど出なくて、すぐ切った" },
    { chapter: 2, clue_id: "c2-1", clue: "誕生日がLINEだけ", meaning: "毎年歌っていた「みほ〜おめでと〜」が、もう言えなかった" },
  ],
};

let playTurn = 0;

const responders = {
  "1_preset.md": (input) => ({
    cards: input.seeds.map((s, i) => ({
      id: `c${i + 1}`,
      title: ["また今度で", "既読がつかない", "送信取り消し", "未来からの通知", "退職届", "異世界の友達"][i % 6],
      genre: s.genre,
      tone: s.tone,
      teaser: `（モック）${s.season}、${s.relation}とのトーク。なんだか最近、返信の様子がおかしい。`,
      protagonist_hint: "27歳、一人暮らしの会社員",
      cast: [{ display_name: s.relation, relation: s.relation }],
      first_message: { from: s.relation, text: "ねえ、ちょっといい？" },
      difficulty: "ふつう",
      hidden: { truth: "（モックの真相）", why_hidden: "", twist: s.twist },
    })),
  }),

  "2_scenario.md": () => {
    playTurn = 0;
    return structuredClone(scenario);
  },

  "3_play.md": (input) => {
    const ch = input.scenario.chapters[input.chapter - 1];
    if (!input.player_message) {
      return {
        chapter: ch.no, date: ch.date,
        messages: [
          { from: "system", type: "system", text: ch.date },
          ch.opener.type === "call"
            ? { from: "father", type: "call", duration: "0:48", time: "20:36" }
            : { from: ch.opener.from, type: "text", text: ch.opener.text, time: "0:00" },
        ],
        player_message_read: false, clues_shown: [ch.clues[0].id], hints_given: 0, chapter_end: false, ending: null,
      };
    }
    playTurn++;
    const last = input.chapter === input.scenario.chapters.length;
    const end = playTurn % 2 === 0;
    return {
      chapter: ch.no, date: ch.date,
      messages: [
        { from: input.player_message.to, type: "text", text: end ? "なんでもないよ" : "うん", time: "22:41" },
        ...(end ? [{ from: input.player_message.to, type: "text", text: "またかけるね", time: "22:41" }] : []),
      ],
      player_message_read: true, clues_shown: [], hints_given: 0,
      chapter_end: end, ending: end && last ? "mid" : null,
    };
  },

  "4_chapter_eval.md": (input) => ({
    chapter: input.chapter, awareness: 3, depth: 2,
    relations: [{ character: "father", delta: 1, reason: "（モック）気にかけてくれたのが伝わった" }],
    good: { quote: input.chapter_log.find((m) => m.from === "player")?.text ?? "", comment: "（モック）自然に聞けてる" },
    missed: { quote: "", comment: "（モック）通話時間、短くなかった？" },
    hint: "通話の長さ",
    one_liner: "（モック）なんか引っかかる夜",
  }),

  "5_ending.md": (input) => ({
    ending: input.ending,
    ending_name: "でれなくてごめん",
    truth_reveal: "お父さんは4月にがんが見つかって、5月に喉の手術をした。手術は成功したけど、声はもう出ない。",
    hindsight: input.scenario.hindsight.map((h) => ({
      chapter: h.chapter, date: input.scenario.chapters[h.chapter - 1].date,
      message_ref: { chapter: h.chapter, index: 1 }, clue: h.clue, meaning: h.meaning, player_reaction: null,
    })),
    last_message: { from: "father", type: "photo", text: "でれなくてごめん" },
    rank: "B",
    scores: { awareness: 6, depth: 4, relations: { father: 2 } },
    best_reply: { quote: "", comment: "（モック）" },
    biggest_miss: { quote: "", comment: "（モック）" },
    closing: "あの0:48は、お父さんが精一杯出そうとした声だった。",
    summary_for_history: "父が喉の手術で声を失い、電話に出られなかった",
  }),
};

export async function mockCallJSON(promptFile, input) {
  await new Promise((r) => setTimeout(r, 300));
  return responders[promptFile](input);
}
