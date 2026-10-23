// claude.ai に公開する1ファイル版を dist/artifact.html に作る
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(path.join(ROOT, p), "utf8");

// 1つの <script> にまとめるので import 行と export キーワードを外す
const strip = (src) =>
  src
    .split("\n")
    .filter((line) => !/^import\s/.test(line) && !/^export\s*\{/.test(line))
    .join("\n")
    .replace(/^export /gm, "");

const PROMPT_FILES = ["1_preset.md", "2_scenario.md", "3_play.md", "4_chapter_eval.md", "5_ending.md"];
const prompts = Object.fromEntries(await Promise.all(PROMPT_FILES.map(async (f) => [f, await read(`prompts/${f}`)])));
const seeds = JSON.parse(await read("prompts/seeds.json"));

const html = await read("public/index.html");
const body = html
  .slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script[^>]*><\/script>/g, "")
  .trim();

const js = [
  strip(await read("lib/engine.js")),
  `const PROMPTS = ${JSON.stringify(prompts)};`,
  `const SEED_POOLS = ${JSON.stringify(seeds)};`,
  strip(await read("artifact/backend.js")),
  strip(await read("public/app.js")),
].join("\n\n");

const page = `<title>あとで知ったこと</title>
<style>
${await read("public/style.css")}
</style>
${body}
<script type="module">
${js.replace(/<\/script/gi, "<\\/script")}
</script>
`;

await mkdir(path.join(ROOT, "dist"), { recursive: true });
await writeFile(path.join(ROOT, "dist", "artifact.html"), page);
console.log(`dist/artifact.html (${(page.length / 1024).toFixed(1)} KB)`);
