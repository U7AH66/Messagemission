const $ = (sel) => document.querySelector(sel);

const state = {
  cardsRequest: null, // 引き直し用に、最後にカードを作ったときの条件
  gameId: null,
  scenario: null,
  chapter: 0,
  logs: {},           // 章ごとのメッセージ。添字はサーバーと同じ順番になる
  room: null,
  unread: new Set(),
  busy: false,
  ending: null,
  highlights: null,   // 読み返しモードのとき { "章:添字": 解説 }
};

// ---------- 小物 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${screen}`));
}

function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

async function api(path, body, loadingText) {
  if (loadingText) {
    $("#loading-text").textContent = loadingText;
    $("#loading").hidden = false;
  }
  try {
    const res = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "エラーが起きた");
    return data;
  } finally {
    $("#loading").hidden = true;
  }
}

function character(id) {
  return state.scenario.characters.find((c) => c.id === id);
}

function nameOf(id) {
  return character(id)?.display_name ?? id;
}

// メッセージがどのトークルームに出るか。system は全部のルームに出す
function roomOf(m) {
  if (m.type === "system" || m.from === "system") return null;
  return m.from === "player" ? m.to : m.from;
}

// ---------- タイトル → カード ----------

async function requestCards(request) {
  try {
    const { gameId, cards } = await api("cards", request, "話を考えてる…");
    state.cardsRequest = request;
    state.gameId = gameId;
    renderCards(cards);
    show("cards");
  } catch (err) {
    toast(err.message);
  }
}

function renderCards(cards) {
  const wrap = $("#cards");
  wrap.replaceChildren();
  for (const card of cards) {
    const b = el("button", "card");
    b.append(el("h3", null, card.title));
    const chips = el("div", "chips");
    for (const c of [card.genre, card.tone, card.difficulty]) if (c) chips.append(el("span", "chip", c));
    b.append(chips, el("p", null, card.teaser));
    if (card.cast?.length) b.append(el("p", "preview", `登場：${card.cast.map((c) => c.display_name).join("、")}`));
    if (card.first_message?.text) b.append(el("p", "preview", `${card.first_message.from}「${card.first_message.text}」`));
    b.addEventListener("click", () => start({ gameId: state.gameId, cardId: card.id }));
    wrap.append(b);
  }
}

// ---------- ゲーム開始 ----------

async function start(body) {
  try {
    const data = await api("start", body, "シナリオを作ってる…（少しかかるよ）");
    Object.assign(state, {
      gameId: data.gameId,
      scenario: data.scenario,
      chapter: data.chapter,
      logs: { [data.chapter]: [] },
      room: data.scenario.characters[0].id,
      unread: new Set(),
      ending: null,
      highlights: null,
    });
    renderRooms();
    show("chat");
    receive(data);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- トーク ----------

function renderRooms() {
  const nav = $("#rooms");
  nav.replaceChildren();
  nav.classList.toggle("single", state.scenario.characters.length < 2);
  for (const c of state.scenario.characters) {
    const tab = el("button", "room-tab", c.display_name);
    tab.classList.toggle("active", c.id === state.room);
    tab.classList.toggle("unread", state.unread.has(c.id));
    tab.addEventListener("click", () => {
      state.room = c.id;
      state.unread.delete(c.id);
      renderRooms();
      renderMessages();
    });
    nav.append(tab);
  }
  $("#room-name").textContent = nameOf(state.room);
  $("#chapter-label").textContent = state.highlights
    ? "あとで読み返すと"
    : `第${state.chapter}章 / 全${state.scenario.chapterCount}章`;
}

function bubbleFor(m) {
  switch (m.type) {
    case "call":
      return el("div", "bubble call", `📞 通話時間 ${m.duration ?? ""}`);
    case "missed_call":
      return el("div", "bubble call", "📞 不在着信");
    case "photo": {
      const b = el("div", "bubble photo");
      b.append(el("div", "frame", m.text ?? "🖼"));
      return b;
    }
    case "image_caption":
      return el("div", "bubble", `🖼 ${m.text ?? ""}`);
    case "stamp":
      return el("div", "bubble stamp", m.text ?? "👍");
    default:
      return el("div", "bubble", m.text ?? "");
  }
}

function messageNode(m) {
  if (m.type === "system" || m.from === "system") return el("div", "pill", m.text);
  if (m.type === "unsend") return el("div", "pill", `${nameOf(m.from)}が送信を取り消しました`);

  const me = m.from === "player";
  const row = el("div", `row${me ? " me" : ""}`);
  if (!me) row.append(el("div", "avatar", nameOf(m.from).slice(0, 1)));
  row.append(bubbleFor(m));
  const meta = el("div", "meta");
  if (me && m.read) meta.append(el("div", null, "既読"));
  if (m.time) meta.append(el("div", null, m.time));
  row.append(meta);
  return row;
}

function renderMessages() {
  const box = $("#messages");
  box.replaceChildren();
  for (const ch of Object.keys(state.logs).map(Number).sort((a, b) => a - b)) {
    state.logs[ch].forEach((m, index) => {
      const room = roomOf(m);
      if (room && room !== state.room) return;
      const node = messageNode(m);
      box.append(node);
      const note = state.highlights?.[`${ch}:${index}`];
      if (note) {
        node.classList.add("hl");
        box.append(el("div", "annot", note));
      }
    });
  }
  if (state.busy && !state.highlights) {
    const typing = el("div", "row typing");
    typing.append(el("div", "avatar", nameOf(state.room).slice(0, 1)), el("div", "bubble", "…"));
    box.append(typing);
  }
  box.scrollTop = state.highlights ? 0 : box.scrollHeight;
}

function setBusy(busy) {
  state.busy = busy;
  $("#input").disabled = busy;
  $("#composer button").disabled = busy;
  renderMessages();
}

function receive(data) {
  const log = state.logs[state.chapter];
  if (data.read) {
    for (const m of log) if (m.from === "player") m.read = true;
  }
  for (const m of data.messages ?? []) {
    log.push(m);
    const room = roomOf(m);
    if (room && room !== state.room) state.unread.add(room);
  }
  renderRooms();
  renderMessages();
  if (data.chapterEnd) showEvaluation(data.evaluation, data.finished);
}

async function sendCurrent(event) {
  event.preventDefault();
  const input = $("#input");
  const text = input.value.trim();
  if (!text || state.busy) return;

  const msg = { from: "player", to: state.room, type: "text", text };
  state.logs[state.chapter].push(msg);
  input.value = "";
  setBusy(true);
  try {
    const data = await api("send", { gameId: state.gameId, to: state.room, text });
    setBusy(false);
    receive(data);
  } catch (err) {
    // サーバーには届いていない扱いにして、入力を戻す
    state.logs[state.chapter].pop();
    input.value = text;
    setBusy(false);
    toast(err.message);
  }
  input.focus();
}

// ---------- 章末評価 ----------

function showEvaluation(ev, finished) {
  $("#input").disabled = true;
  $("#composer button").disabled = true;

  const body = $("#sheet-body");
  body.replaceChildren();
  body.append(el("h3", null, `第${state.chapter}章 おわり`), el("p", "one-liner", ev?.one_liner ?? ""));

  const scores = el("div", "scores");
  for (const [label, value] of [["気づき", ev?.awareness], ["踏み込み", ev?.depth]]) {
    const s = el("div", "score");
    s.append(el("small", null, label), el("br"), el("b", null, `${value ?? "-"}`), el("small", null, " / 5"));
    scores.append(s);
  }
  body.append(scores);

  for (const r of ev?.relations ?? []) {
    const sign = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    body.append(el("div", "rel", `${nameOf(r.character)}との関係 ${sign}：${r.reason}`));
  }
  for (const [label, item] of [["よかった", ev?.good], ["惜しかった", ev?.missed]]) {
    if (!item?.comment) continue;
    const box = el("div", "quote-box");
    box.append(el("small", null, label));
    if (item.quote) box.append(el("q", null, item.quote));
    box.append(el("div", null, item.comment));
    body.append(box);
  }
  if (ev?.hint) body.append(el("p", "note", `💡 ${ev.hint}`));

  const next = el("button", "btn primary", finished ? "結末を見る" : "次の章へ");
  next.addEventListener("click", finished ? finish : goNextChapter);
  body.append(next);
  $("#sheet").hidden = false;
}

async function goNextChapter() {
  $("#sheet").hidden = true;
  try {
    const data = await api("next", { gameId: state.gameId }, "時間が流れていく…");
    state.chapter = data.chapter;
    state.logs[data.chapter] = [];
    setBusy(false);
    receive(data);
  } catch (err) {
    $("#sheet").hidden = false;
    toast(err.message);
  }
}

// ---------- 結末 ----------

async function finish() {
  $("#sheet").hidden = true;
  try {
    state.ending = await api("finish", { gameId: state.gameId }, "あとで知ったこと…");
    renderEnding();
    show("ending");
  } catch (err) {
    $("#sheet").hidden = false;
    toast(err.message);
  }
}

function renderEnding() {
  const r = state.ending;
  const wrap = $("#ending");
  wrap.replaceChildren();
  wrap.append(el("p", "rank", r.rank ?? ""), el("h2", null, r.ending_name ?? ""), el("p", "truth", r.truth_reveal ?? ""));

  if (r.last_message) {
    const box = el("div", "last-msg");
    box.append(messageNode({ ...r.last_message, from: r.last_message.from }));
    wrap.append(box);
  }

  wrap.append(el("h3", null, "あとで読み返すと"));
  for (const h of r.hindsight ?? []) {
    const item = el("div", "hs-item");
    item.append(el("div", "date", `第${h.chapter}章 ${h.date ?? ""}`), el("div", "clue", h.clue), el("div", "meaning", h.meaning));
    if (h.player_reaction) item.append(el("div", "reaction", `あなた：「${h.player_reaction}」`));
    wrap.append(item);
  }

  const review = el("button", "btn primary", "トークを読み返す");
  review.addEventListener("click", startReview);
  wrap.append(review);

  for (const [label, item] of [["一番よかった返信", r.best_reply], ["一番惜しかった瞬間", r.biggest_miss]]) {
    if (!item?.comment) continue;
    const box = el("div", "quote-box");
    box.append(el("small", null, label));
    if (item.quote) box.append(el("q", null, item.quote));
    box.append(el("div", null, item.comment));
    wrap.append(box);
  }
  if (r.closing) wrap.append(el("p", "closing", r.closing));

  const again = el("button", "btn", "もう一回あそぶ");
  again.addEventListener("click", () => show("title"));
  wrap.append(again);
}

function startReview() {
  state.highlights = {};
  let firstRoom = null;
  for (const h of state.ending.hindsight ?? []) {
    const ref = h.message_ref;
    if (!ref) continue;
    state.highlights[`${ref.chapter}:${ref.index}`] = `${h.clue}\n${h.meaning}`;
    const m = state.logs[ref.chapter]?.[ref.index];
    firstRoom ??= m && roomOf(m);
  }
  if (firstRoom) state.room = firstRoom;
  $("#composer").hidden = true;
  $("#review-bar").hidden = false;
  renderRooms();
  renderMessages();
  show("chat");
}

function backToEnding() {
  state.highlights = null;
  $("#composer").hidden = false;
  $("#review-bar").hidden = true;
  show("ending");
}

// ---------- イベント ----------

const actions = {
  omakase: () => requestCards({}),
  outline: () => {
    const outline = $("#outline").value.trim();
    if (!outline) return toast("大枠を書いてね");
    requestCards({ outline });
  },
  custom: () => {
    const v = (id) => $(id).value.trim();
    const custom = {
      genre: v("#c-genre"), tone: v("#c-tone"), characters: v("#c-characters"),
      setting: v("#c-setting"), free_text: v("#c-free"), truth: v("#c-truth"),
    };
    if (!custom.truth) return toast("真相は書いてね");
    start({ custom });
  },
  reroll: () => requestCards(state.cardsRequest ?? {}),
  home: () => {
    if (state.gameId && state.scenario && !state.ending && !confirm("タイトルに戻る？進行中の話は消えるよ")) return;
    $("#sheet").hidden = true;
    show("title");
  },
  "back-to-ending": backToEnding,
};

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action) actions[action]();
});
$("#composer").addEventListener("submit", sendCurrent);
