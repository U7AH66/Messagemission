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

## 構成

```
server.js          HTTPサーバー（/api/* と public/ の配信）
lib/game.js        ゲーム進行。サイコロ、状態管理、真相をクライアントに出さない処理
lib/claude.js      prompts/ を読んで Claude API を呼び、JSONを返す
lib/mock.js        MOCK=1 のときの固定レスポンス
public/            画面（素のHTML/CSS/JS）
prompts/           AIへの指示書一式とサイコロの中身
data/history.json  遊んだ話の真相の要約（次のプリセットでかぶらないようにする）
```

## 今の制限

- ゲームの状態はメモリにしかないので、サーバーを再起動すると進行中の話は消える。
- 遊んだ履歴は全ユーザー共通（ログインがないため）。
