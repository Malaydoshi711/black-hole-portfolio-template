import { useEffect, useRef } from "react";
import gsap from "gsap";

/** Crosshair cursor: a dot that tracks exactly and a reticle that trails and
 *  locks onto anything interactive. Desktop with a fine pointer only. */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const d = dot.current!, r = ring.current!;
    const dx = gsap.quickTo(d, "x", { duration: 0.08, ease: "power3" });
    const dy = gsap.quickTo(d, "y", { duration: 0.08, ease: "power3" });
    const rx = gsap.quickTo(r, "x", { duration: 0.45, ease: "power3" });
    const ry = gsap.quickTo(r, "y", { duration: 0.45, ease: "power3" });

    // stay hidden until the pointer actually moves (no stray reticle at 0,0)
    gsap.set([d, r], { autoAlpha: 0 });
    let shown = false;
    const move = (e: PointerEvent) => {
      if (!shown) { shown = true; gsap.set([d, r], { x: e.clientX, y: e.clientY }); gsap.to([d, r], { autoAlpha: 1, duration: 0.2 }); }
      dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("a, button, [data-cursor]");
      r.classList.toggle("cursor__ring--lock", !!el);
      label.current!.textContent = el?.dataset.cursor ?? "";
      r.classList.toggle("cursor__ring--label", !!el?.dataset.cursor);
    };
    const down = () => r.classList.add("cursor__ring--down");
    const up = () => r.classList.remove("cursor__ring--down");
    const leave = () => gsap.to([d, r], { autoAlpha: 0, duration: 0.2 });
    const enter = () => gsap.to([d, r], { autoAlpha: 1, duration: 0.2 });

    const ext = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      r.classList.toggle("cursor__ring--lock", !!text);
      r.classList.toggle("cursor__ring--label", !!text);
      label.current!.textContent = text;
    };
    window.addEventListener("cursor:label", ext);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("pointerenter", enter);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("cursor:label", ext);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerenter", enter);
    };
  }, []);

  return (
    <div className="cursor" aria-hidden="true">
      <div className="cursor__dot" ref={dot} />
      <div className="cursor__ring" ref={ring}>
        <i /><i /><i /><i />
        <span ref={label} />
      </div>
    </div>
  );
}
