// サーバー版：/api/* を呼ぶ
async function post(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "エラーが起きた");
  return data;
}

export const backend = Object.fromEntries(
  ["cards", "start", "send", "next", "finish", "resume"].map((p) => [p, (body) => post(p, body)]),
);
