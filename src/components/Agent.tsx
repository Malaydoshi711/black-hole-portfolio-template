import { useEffect, useMemo, useRef, useState } from "react";
import { buildKB, composeAnswer, createRetriever, intentOf, type Hit } from "../agent/kb";
import { experience, featured, profile, publications, skills } from "../data/content";

type Step = { agent: string; text: string; state: "run" | "done" };
type Turn = { q: string; steps: Step[]; answer: string; shown: string; sources: Hit[]; via: string };

// suggested questions, written from content.ts so they always have an answer
const P = profile.pronouns;
const first = profile.name.split(/\s+/)[0];
const SUGGEST = [
  experience[0] ? `What does ${first} do at ${experience[0].short || experience[0].org}?` : `What does ${first} work on?`,
  `What is ${featured.title}?`,
  publications.some((p) => p.award) ? `Has ${P.subject} won any awards?` : publications.length ? `What has ${P.subject} published?` : `Where is ${P.subject} based?`,
  skills[0] ? `Which ${skills[0].group.toLowerCase()} tools does ${P.subject} use?` : `What is ${P.possessive} toolkit?`,
  `How do I contact ${P.object}?`,
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask-my-agent console: a visible 4-agent trace over a retrieval pipeline,
 *  over this site's content. Uses /api/ask (LLM) when configured, else answers
 *  extractively from the same knowledge base. */
export default function Agent({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: string }) {
  const retrieve = useMemo(() => createRetriever(buildKB()), []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => input.current?.focus(), 60);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [open, onClose]);

  useEffect(() => { if (open && seed) ask(seed); /* eslint-disable-next-line */ }, [open, seed]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: reduce ? "auto" : "smooth" }); });

  const update = (fn: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);

  async function ask(question: string) {
    const text = question.trim().slice(0, 300);
    if (!text || busy) return;
    setBusy(true);
    setQ("");
    setTurns((ts) => [...ts, { q: text, steps: [], answer: "", shown: "", sources: [], via: "" }]);
    const pace = reduce ? 0 : 1;
    const step = async (agent: string, run: string, done: string, ms: number) => {
      update((t) => ({ ...t, steps: [...t.steps, { agent, text: run, state: "run" }] }));
      await wait(ms * pace);
      update((t) => ({ ...t, steps: t.steps.map((s, i) => (i === t.steps.length - 1 ? { ...s, text: done, state: "done" } : s)) }));
    };

    const intent = intentOf(text);
    await step("Query", "Reading the question", `Intent: ${intent}`, 420);
    const { terms, hits } = retrieve(text, 3);
    await step("Retrieve", "Searching portfolio data", hits.length ? `${hits.length} sources matched on ${terms.slice(0, 4).join(", ")}` : "No grounded sources found", 520);

    // try the LLM in parallel with the reasoning step
    const llm = (import.meta.env.VITE_LLM !== "1" ? Promise.resolve(null) : fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Promise<{ answer?: string; model?: string } | null>;
    await step("Reason", "Grounding the answer in sources", "Answer checked against sources", 480);
    const res = hits.length ? await Promise.race([llm, wait(6000).then(() => null)]) : null;
    const answer = res?.answer || composeAnswer(text, hits);
    const via = res?.answer ? `LLM (${res.model ?? "remote"}) over retrieved context` : "Extractive answer from retrieved context";
    await step("Respond", "Writing", via, 120);
    update((t) => ({ ...t, answer, sources: hits, via }));

    // stream the answer in
    if (pace) {
      for (let i = 0; i <= answer.length; i += 3) {
        update((t) => ({ ...t, shown: answer.slice(0, i) }));
        await wait(12);
      }
    }
    update((t) => ({ ...t, shown: answer }));
    setBusy(false);
    input.current?.focus();
  }

  if (!open) return null;
  return (
    <div className="agentx" role="dialog" aria-modal="true" aria-labelledby="agentx-h" ref={dialog}>
      <button className="agentx__scrim" aria-label="Close agent" onClick={onClose} tabIndex={-1} />
      <div className="agentx__panel">
        <header className="agentx__head">
          <div>
            <h2 id="agentx-h">Ask my agent</h2>
            <p>A small retrieval agent that answers only from the content of this portfolio.</p>
          </div>
          <button className="agentx__close" onClick={onClose} aria-label="Close">Close</button>
        </header>

        <div className="agentx__log" ref={log} aria-live="polite">
          {!turns.length && (
            <div className="agentx__empty">
              <p>Try one of these, or ask your own question.</p>
              <div className="agentx__chips">
                {SUGGEST.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div className="turn" key={i}>
              <p className="turn__q">{t.q}</p>
              <ol className="trace">
                {t.steps.map((s) => (
                  <li key={s.agent} className={`trace__step trace__step--${s.state}`}>
                    <span className="trace__agent">{s.agent}</span>
                    <span className="trace__text">{s.text}</span>
                  </li>
                ))}
              </ol>
              {t.shown && <p className="turn__a">{t.shown}{t.shown.length < t.answer.length && <i className="caret" />}</p>}
              {t.shown === t.answer && t.answer && (
                <div className="turn__meta">
                  {t.sources.length > 0 && (
                    <p className="turn__src">
                      Sources: {t.sources.map((h, j) => (
                        h.chunk.href
                          ? <a key={j} href={h.chunk.href} target="_blank" rel="noreferrer">{h.chunk.title}</a>
                          : <span key={j}>{h.chunk.title}</span>
                      ))}
                    </p>
                  )}
                  <p className="turn__via">{t.via}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <form className="agentx__form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <label htmlFor="agentx-q" className="sr-only">Your question</label>
          <input id="agentx-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about my work, research or skills" maxLength={300} autoComplete="off" disabled={busy} />
          <button className="btn btn--solid" type="submit" disabled={busy || !q.trim()}>{busy ? "Thinking" : "Ask"}</button>
        </form>
      </div>
    </div>
  );
}
