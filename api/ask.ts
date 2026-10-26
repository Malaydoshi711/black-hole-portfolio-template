// Optional LLM backend for the on-site agent (Vercel Edge Function).
//
// Works with any OpenAI-compatible chat API. Set these in Vercel:
//   LLM_API_KEY   required, e.g. a Groq or OpenAI key
//   LLM_BASE_URL  optional, default https://api.groq.com/openai/v1
//   LLM_MODEL     optional, default llama-3.3-70b-versatile
//
// Without LLM_API_KEY this returns 501 and the site falls back to its
// built-in retrieval answers, so nothing breaks.
import { buildKB, createRetriever, SYSTEM_PROMPT } from "../src/agent/kb";

export const config = { runtime: "edge" };

const retrieve = createRetriever(buildKB());
const hits = new Map<string, { n: number; t: number }>();

export default async function handler(req: Request) {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const key = process.env.LLM_API_KEY;
  if (!key) return json({ error: "LLM not configured" }, 501);

  // light per-IP rate limit (best effort, per edge instance)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const now = Date.now();
  const rec = hits.get(ip);
  if (rec && now - rec.t < 60_000) {
    if (rec.n >= 8) return json({ error: "Too many questions, try again in a minute" }, 429);
    rec.n++;
  } else hits.set(ip, { n: 1, t: now });

  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = String(body.question ?? "").slice(0, 300).trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!question) return json({ error: "Empty question" }, 400);

  // retrieval happens server-side, so the client can't inject its own context
  const { hits: found } = retrieve(question, 4);
  const context = found.map((h, i) => `[${i + 1}] ${h.chunk.title}: ${h.chunk.text}`).join("\n");

  const base = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Context:\n${context || "(no matching context)"}\n\nQuestion: ${question}` },
        ],
      }),
    });
    if (!r.ok) return json({ error: `Upstream ${r.status}` }, 502);
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = data.choices?.[0]?.message?.content?.replace(/—|–/g, ",").trim();
    if (!answer) return json({ error: "Empty answer" }, 502);
    return json({ answer, model, sources: found.map((h) => h.chunk.id) });
  } catch {
    return json({ error: "Upstream unreachable" }, 502);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

declare const process: { env: Record<string, string | undefined> };
