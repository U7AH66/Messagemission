import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");
const MODEL = process.env.MODEL || "claude-opus-5-5";

let client;
const prompts = new Map();

async function loadPrompt(name) {
  if (!prompts.has(name)) {
    prompts.set(name, await readFile(path.join(PROMPT_DIR, name), "utf8"));
  }
  return prompts.get(name);
}

// プロンプトは「JSONのみ」を返すよう指示しているが、前後に余計な文字が付いても拾えるようにする
function extractJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("JSONが見つからない");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * prompts/ のファイルをシステムプロンプトにして、入力JSONを渡し、出力JSONを返す。
 * effort: low | medium | high
 */
export async function callJSON(promptFile, input, effort = "medium") {
  client ??= new Anthropic();
  const system = await loadPrompt(promptFile);
  const messages = [{ role: "user", content: JSON.stringify(input) }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      throw new Error("AIがこのリクエストを断りました。内容を変えて試してください。");
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      return extractJSON(text);
    } catch (err) {
      if (attempt === 1) throw err;
      messages.push(
        { role: "assistant", content: response.content },
        { role: "user", content: "出力がJSONとして読めませんでした。指定の形式のJSONだけをもう一度返してください。" },
      );
    }
  }
}
