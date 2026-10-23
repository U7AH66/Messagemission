# あとで知ったこと

LINE風メッセージゲーム。主人公として自由に返信を書いて、相手はAIが演じる。
どの話にも主人公だけが知らない真相があって、会話の違和感に気づけるかが勝負。章ごとに評価が出て、最後に「あとで読み返すと」の答え合わせがある。

プロンプトの設計は [`prompts/README.md`](prompts/README.md) を見てね。

## 動かし方

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start          # http://localhost:3000
```

APIキーなしで画面だけ確認したいとき：

```sh
npm run mock
```

| 環境変数 | 内容 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude APIキー |
| `MODEL` | 使うモデル（デフォルト `claude-opus-5-5`） |
| `PORT` | ポート（デフォルト 3000） |
| `MOCK` | `1` にすると固定レスポンスで動く |

## claude.ai版（スマホで遊ぶ用）

サーバーなしで、claude.aiのページとして動く版もある。AIはページを開いた人のClaudeプランで動くから、APIキーはいらない。

公開中：https://claude.ai/artifact/Q8reYiUdYSMHiFVZWRMLsM （今は持ち主だけが開ける）

```sh
npm run build:artifact   # dist/artifact.html を作る
```

`lib/engine.js`、`artifact/backend.js`、`public/` と `prompts/` を1ファイルにまとめて、AI呼び出しをclaude.aiの仕組みに差し替えてる。
サーバー版と違って真相がページの中に入るから、開発者ツールで覗けばネタバレできる。ゲームの途中経過はそのブラウザの中に保存される。

## 構成

```
server.js          HTTPサーバー（/api/* と public/ の配信）
lib/engine.js      ゲーム進行の本体。サイコロ、状態管理、真相をクライアントに出さない処理
lib/game.js        サーバー版の保存先とAI呼び出しをエンジンにつなぐ
lib/claude.js      prompts/ を読んで Claude API を呼び、JSONを返す
lib/mock.js        MOCK=1 のときの固定レスポンス
public/            画面（素のHTML/CSS/JS）。backend.js はサーバー版のAPI呼び出し
artifact/          claude.ai版のバックエンドとビルドスクリプト
prompts/           AIへの指示書一式とサイコロの中身
data/history.json  遊んだ話の真相の要約（次のプリセットでかぶらないようにする）
```

## 今の制限

- ゲームの状態はメモリにしかないので、サーバーを再起動すると進行中の話は消える。
- 遊んだ履歴は全ユーザー共通（ログインがないため）。
