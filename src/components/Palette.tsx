import { useEffect, useMemo, useRef, useState } from "react";

export type Command = { id: string; label: string; hint?: string; run: () => void };

/** Ctrl/Cmd+K command palette: jump anywhere, grab the resume, ask the agent. */
export default function Palette({ open, onClose, commands, onAsk }: { open: boolean; onClose: () => void; commands: Command[]; onAsk: (q: string) => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const s = q.toLowerCase().trim();
    const base = s ? commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(s)) : commands;
    // free text that matches nothing becomes a question for the agent
    return s && !base.length ? [{ id: "ask-free", label: `Ask my agent: "${q.trim()}"`, run: () => onAsk(q.trim()) }] : base;
  }, [q, commands, onAsk]);

  useEffect(() => {
    if (!open) return;
    setQ(""); setIdx(0);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => input.current?.focus(), 30);
    return () => prev?.focus?.();
  }, [open]);
  useEffect(() => setIdx(0), [q]);

  if (!open) return null;
  const pick = (c?: Command) => { if (!c) return; onClose(); setTimeout(c.run, 10); };

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command menu">
      <button className="palette__scrim" aria-label="Close menu" onClick={onClose} tabIndex={-1} />
      <div className="palette__box">
        <input
          ref={input}
          className="palette__input"
          placeholder="Jump to a section, download the resume, or ask a question"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={list[idx] ? `pc-${list[idx].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(list[idx]); }
            else if (e.key === "Escape") onClose();
          }}
        />
        <ul id="palette-list" className="palette__list" role="listbox">
          {list.map((c, i) => (
            <li key={c.id} id={`pc-${c.id}`} role="option" aria-selected={i === idx}
              className={i === idx ? "is-on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => pick(c)}>
              <span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
        </ul>
        <p className="palette__foot"><kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close</p>
      </div>
    </div>
  );
}
