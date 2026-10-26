import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { World, categoryColor } from "./world/World";
import { REEL_END, ROUTE_AT, SECTIONS, type SectionId } from "./world/route";
import { Drone } from "./world/audio";
import Loader from "./components/Loader";
import Cursor from "./components/Cursor";
import Agent from "./components/Agent";
import Palette, { type Command } from "./components/Palette";
import {
  categories, certifications, contact, experience, featured, profile, projects, publications, research, site, skills,
} from "./data/content";

gsap.registerPlugin(ScrollTrigger, SplitText);

// only the categories some project uses appear in the legend
const CATEGORIES = categories.filter((c) => projects.some((p) => p.category === c.name));

// labels that follow the bodies in the 3D scene (World ignores ids it has no body for)
type Tag = { id: string; label: string; sub?: string; gold?: boolean };
const TAGS: Tag[] = [
  { id: "about-0", label: profile.city, sub: profile.coords },
  ...experience.map((e, i) => ({ id: `exp-${i}`, label: e.short || e.org, sub: `${e.start} to ${e.end}` })),
  ...featured.parts.map((a, i) => ({ id: `agent-${i}`, label: a.name })),
  ...projects.map((p, i) => ({ id: `proj-${i}`, label: p.title, sub: String(i + 1).padStart(2, "0") })),
  ...publications.map((p, i) => ({ id: `pulsar-${i}`, label: p.venue, sub: p.award ? p.note || "Award" : "", gold: p.award })),
  ...skills.map((s, i) => ({ id: `tool-${i}`, label: s.group })),
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const WORDS = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen Twenty".split(" ");
/** 3 -> "Three"; numbers past twenty stay digits */
const word = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${word(n)} ${n === 1 ? one : many}`;
/** section number as shown in the kicker, following the nav order */
const secN = (id: SectionId) => SECTIONS.findIndex((s) => s.id === id) + 1;
/** hero name: first word on line one, the rest on line two */
const NAME_LINES = (() => {
  const w = profile.name.trim().split(/\s+/);
  return w.length > 1 ? [w[0], w.slice(1).join(" ")] : w;
})();
/** how many characters the name must fit across: the longest word, or the
 *  longest line up to 12 characters (longer lines wrap between words) */
const NAME_FIT = Math.max(
  ...profile.name.split(/[\s]+|(?<=-)/).map((w) => w.length),
  Math.min(12, Math.max(...NAME_LINES.map((l) => l.length))),
  5,
);
/** "#" placeholder links stay in the page; real ones open in a new tab */
const ext = (href: string) => (href === "#" || href.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" });
const [EMAIL_USER, EMAIL_HOST] = profile.email.split("@");

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const loader = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hud = useRef<{ r?: HTMLElement | null; clock?: HTMLElement | null; bar?: HTMLElement | null; mark?: HTMLElement | null; count?: HTMLElement | null }>({});
  const tagEls = useRef<Record<string, HTMLElement | null>>({});
  const lenisRef = useRef<Lenis | null>(null);
  const worldRef = useRef<World | null>(null);
  const drone = useRef<Drone | null>(null);
  const [active, setActive] = useState(-1);
  const [agent, setAgent] = useState(0);
  const [menu, setMenu] = useState(false);
  const [noGL, setNoGL] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentSeed, setAgentSeed] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const [card, setCard] = useState(0);

  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
    const params = new URLSearchParams(location.search);
    const fixRes = params.has("fixres") ? Number(params.get("fixres")) || 0.6 : undefined;
    let world: World | null = null;
    let lenis: Lenis | null = null;
    const cleanups: (() => void)[] = [];
    const el = loader.current!;
    const num = el.querySelector<HTMLElement>(".loader__num")!;
    const step = el.querySelector<HTMLElement>(".loader__step")!;
    const trace = el.querySelector<SVGPathElement>(".loader__trace:not(.loader__trace--ghost)")!;
    document.documentElement.classList.add("is-loading");

    const counter = { v: 0 };
    const setCount = (to: number, label: string, dur = 0.6) => {
      step.textContent = label;
      return gsap.to(counter, {
        v: to, duration: reduce ? 0 : dur, ease: "power2.out",
        onUpdate: () => {
          num.textContent = String(Math.round(counter.v)).padStart(3, "0");
          trace.style.strokeDashoffset = String(1 - counter.v / 100);
        },
      });
    };

    const ctx = gsap.context(() => {}, root);
    // StrictMode runs this twice in dev: the first, cleaned-up boot must stop
    let dead = false;

    const boot = async () => {
      await setCount(22, "Calibrating the lens", 0.55);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (dead) return;
      try {
        world = new World(canvas.current!, { mobile, reduce, fixRes });
        worldRef.current = world;
        if (params.has("debug")) (window as unknown as { __world: World }).__world = world;
      } catch {
        setNoGL(true);
        document.documentElement.classList.add("nogl");
      }
      await setCount(58, "Tracing light around the hole", 0.5);
      await document.fonts.ready;
      if (dead) return;

      // scroll position -> story progress. Each section is pinned to its
      // anchor, so its scene is framed when the panel is centred.
      const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-sec]"));
      let anchors: [number, number][] = [[0, 0], [1, 1]];
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".card"));
      const computeAnchors = () => {
        const vh = window.innerHeight;
        const max = Math.max(1, document.documentElement.scrollHeight - vh);
        const list: [number, number][] = [[0, 0]];
        sections.forEach((s) => {
          const id = s.id as SectionId;
          const at = ROUTE_AT[id];
          const spacer = s.parentElement?.classList.contains("pin-spacer") ? s.parentElement : null;
          const top = (spacer ?? s).getBoundingClientRect().top + window.scrollY;
          if (id === "projects") {
            if (spacer) list.push([top, at], [top + spacer.offsetHeight - vh, REEL_END]);
            else if (cards.length) {
              const c0 = cards[0].getBoundingClientRect(), c1 = cards[cards.length - 1].getBoundingClientRect();
              list.push([c0.top + window.scrollY + c0.height / 2 - vh / 2, at], [c1.top + window.scrollY + c1.height / 2 - vh / 2, REEL_END]);
            }
          } else if (id === "contact") {
            list.push([max, 1]);
          } else {
            list.push([top + s.offsetHeight / 2 - vh / 2, at]);
          }
        });
        list.push([max + 1, 1]);
        anchors = list.filter((a, i) => i === 0 || (a[0] > list[i - 1][0] && a[1] >= list[i - 1][1]));
        onScroll();
      };
      const routeAt = (y: number) => {
        for (let i = 1; i < anchors.length; i++) {
          const [y0, p0] = anchors[i - 1], [y1, p1] = anchors[i];
          if (y <= y1) return p0 + ((p1 - p0) * Math.max(0, y - y0)) / (y1 - y0);
        }
        return 1;
      };

      if (!reduce) {
        lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 0.9 });
        lenisRef.current = lenis;
        if (params.has("debug")) (window as unknown as { __lenis: Lenis }).__lenis = lenis;
        lenis.on("scroll", ScrollTrigger.update);
        const raf = (time: number) => lenis!.raf(time * 1000);
        gsap.ticker.add(raf);
        gsap.ticker.lagSmoothing(0);
        cleanups.push(() => { gsap.ticker.remove(raf); lenis!.destroy(); lenisRef.current = null; });
        lenis.stop();
      }

      ctx.add(() => buildScroll(mobile, reduce));
      ScrollTrigger.addEventListener("refresh", computeAnchors);
      cleanups.push(() => ScrollTrigger.removeEventListener("refresh", computeAnchors));

      let lastIdx = -2;
      function onScroll() {
        const p = routeAt(window.scrollY);
        world?.setProgress(p);
        if (hud.current.bar) hud.current.bar.style.transform = `scaleY(${p})`;
        if (hud.current.mark) hud.current.mark.style.top = `${(p * 100).toFixed(2)}%`;
        let idx = -1;
        SECTIONS.forEach((s, i) => { if (p >= ROUTE_AT[s.id] - 0.055) idx = i; });
        if (idx !== lastIdx) { lastIdx = idx; setActive(idx); }
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", onScroll));

      // which project card is in focus, as a fractional index
      let lastCard = -1;
      const track = () => {
        if (!cards.length) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const r0 = cards[0].getBoundingClientRect();
        if (!mobile && (r0.top > vh || r0.bottom < 0)) return;
        const reelST = ScrollTrigger.getById("reel");
        if (reelST) {
          // desktop: the pan itself says which project is in focus, from 01 at
          // the start of the pin to the last one at its end
          const n = projects.length;
          const prog = reelST.animation ? reelST.animation.progress() : reelST.progress; // scrubbed, as drawn
          world?.setReel(prog * (n - 1));
          if (!world) { const c = Math.round(prog * (n - 1)); if (c !== lastCard) { lastCard = c; setCard(c); } }
          return;
        }
        const centres = cards.map((c) => { const r = c.getBoundingClientRect(); return mobile ? r.top + r.height / 2 : r.left + r.width / 2; });
        const mid = mobile ? vh / 2 : vw * 0.42;
        let fi = 0;
        if (mid <= centres[0]) fi = (mid - centres[0]) / (centres[1] - centres[0]);
        else if (mid >= centres[centres.length - 1]) fi = centres.length - 1 + (mid - centres[centres.length - 1]) / (centres[1] - centres[0]);
        else for (let i = 0; i < centres.length - 1; i++) {
          if (mid < centres[i + 1]) { fi = i + (mid - centres[i]) / (centres[i + 1] - centres[i]); break; }
        }
        world?.setReel(fi);
        if (world) return; // with WebGL the counter follows the lit body (world.onReel)
        const c = Math.max(0, Math.min(cards.length - 1, Math.round(fi)));
        if (c !== lastCard) { lastCard = c; setCard(c); }
      };
      gsap.ticker.add(track);
      cleanups.push(() => gsap.ticker.remove(track));

      ScrollTrigger.refresh();
      computeAnchors();

      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        world?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      const onResize = () => world?.resize();
      window.addEventListener("resize", onResize);
      cleanups.push(() => { window.removeEventListener("pointermove", onMove); window.removeEventListener("resize", onResize); });

      if (world) {
        TAGS.forEach((t) => world!.registerTag(t.id, tagEls.current[t.id] ?? null));
        world.onDegrade = () => document.documentElement.classList.add("lowfx");
        world.onReel = (i) => {
          // write the counter now, in the same frame as the label; React catches up
          if (hud.current.count) hud.current.count.textContent = pad2(i + 1);
          setCard(i);
        };
        let lastR = "";
        world.onTelemetry = (t) => {
          const r = t.r.toFixed(1);
          if (r === lastR) return;
          lastR = r;
          if (hud.current.r) hud.current.r.textContent = r;
          if (hud.current.clock) hud.current.clock.textContent = t.clock.toFixed(3);
          drone.current?.setClock(t.clock);
        };
        const ctxLost = (e: Event) => { e.preventDefault(); setNoGL(true); document.documentElement.classList.add("nogl"); };
        canvas.current!.addEventListener("webglcontextlost", ctxLost);
        cleanups.push(() => canvas.current?.removeEventListener("webglcontextlost", ctxLost));
      }

      await setCount(86, "Compiling shaders", 0.4);
      if (dead) return;
      try { world?.warm(); } catch { setNoGL(true); }
      await setCount(100, "Signal locked", 0.45);
      if (dead) return;

      document.documentElement.classList.remove("is-loading");
      world?.setIntro(reduce ? 1 : 0);
      world?.start();
      ctx.add(() => {
        const tl = gsap.timeline({ onComplete: () => { lenis?.start(); el.style.display = "none"; } });
        if (reduce) {
          tl.set(el, { autoAlpha: 0 });
          return;
        }
        const intro = { v: 0 };
        tl.fromTo(".loader__merger", { scale: 1, autoAlpha: 1 }, { scale: 9, autoAlpha: 0, duration: 0.7, ease: "power2.out", transformOrigin: "50% 50%" })
          .to(".loader__inner", { autoAlpha: 0, y: -16, duration: 0.5, ease: "power2.in" }, "<0.1")
          .to(el, { autoAlpha: 0, duration: 0.9, ease: "power2.inOut" }, "-=0.2")
          .to(intro, { v: 1, duration: 3.6, ease: "power2.out", onUpdate: () => world?.setIntro(intro.v) }, "<")
          .fromTo(".hero__name .ch", { yPercent: 115 }, { yPercent: 0, duration: 1.3, stagger: 0.045, ease: "expo.out" }, "-=2.4")
          .fromTo(".hero__fade", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.07, ease: "power3.out", clearProps: "transform" }, "-=1.1")
          .fromTo(".hud__fade", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, stagger: 0.05, ease: "power2.out" }, "<");
      });
    };

    boot();

    return () => {
      dead = true;
      cleanups.forEach((c) => c());
      ctx.revert();
      world?.dispose();
      worldRef.current = null;
      document.documentElement.classList.remove("is-loading");
    };
  }, []);

  useEffect(() => { worldRef.current?.setAgent(agent); }, [agent]);
  useEffect(() => () => drone.current?.dispose(), []);

  const go = useCallback((id: string) => {
    setMenu(false);
    const l = lenisRef.current;
    if (id === "top") { if (l) l.scrollTo(0, { duration: 2.4, force: true }); else window.scrollTo(0, 0); return; }
    const el = document.getElementById(id);
    if (!el) return;
    const spacer = el.parentElement?.classList.contains("pin-spacer") ? el.parentElement : null;
    const top = (spacer ?? el).getBoundingClientRect().top + window.scrollY;
    const vh = window.innerHeight;
    const y = spacer ? top + 2
      : id === "contact" ? document.documentElement.scrollHeight - vh
      : id === "projects" ? top
      : top + el.offsetHeight / 2 - vh / 2;
    if (l) l.scrollTo(y, { duration: 2.2, force: true });
    else window.scrollTo(0, y);
  }, []);

  const openAgent = useCallback((seed?: string) => { setAgentSeed(seed); setAgentOpen(true); setMenu(false); }, []);
  const closeAgent = useCallback(() => { setAgentOpen(false); setAgentSeed(undefined); }, []);
  const toggleSound = useCallback(() => {
    if (!drone.current) drone.current = new Drone();
    setSound(drone.current.toggle());
  }, []);
  const downloadResume = useCallback(() => {
    const a = document.createElement("a");
    a.href = site.resume;
    a.download = site.resumeName;
    a.click();
  }, []);

  useEffect(() => {
    const open = agentOpen || paletteOpen || menu;
    document.documentElement.classList.toggle("has-dialog", agentOpen || paletteOpen);
    const l = lenisRef.current;
    if (!l) return;
    if (open) l.stop(); else l.start();
  }, [agentOpen, paletteOpen, menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: Command[] = useMemo(() => [
    { id: "agent", label: "Ask my agent a question", hint: "AI", run: () => openAgent() },
    { id: "resume", label: "Download resume (PDF)", hint: "PDF", run: downloadResume },
    { id: "email", label: "Copy email address", run: () => navigator.clipboard?.writeText(profile.email).catch(() => {}) },
    ...SECTIONS.map((s) => ({ id: `go-${s.id}`, label: `Go to ${s.label}`, run: () => go(s.id) })),
    { id: "go-top", label: "Back to the start", run: () => go("top") },
    ...featured.links.filter((l) => l.href !== "#").map((l, i) => ({ id: `flagship-${i}`, label: `${featured.title}: ${l.label}`, run: () => window.open(l.href, "_blank", "noopener") })),
    ...site.socials.filter((l) => l.href !== "#").map((l) => ({ id: `social-${l.label}`, label: `Open ${l.label}`, run: () => window.open(l.href, "_blank", "noopener") })),
    { id: "sound", label: "Toggle the drone (sound)", run: toggleSound },
  ], [go, openAgent, downloadResume, toggleSound]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div ref={root}>
      <a className="skip" href="#about">Skip to content</a>
      <canvas className={`world${noGL ? " world--none" : ""}`} ref={canvas} aria-hidden="true" />
      <div className="fallback" aria-hidden="true"><i /></div>
      <div className="tags" aria-hidden="true">
        {TAGS.map((t) => (
          <div key={t.id} className={`tag${t.gold ? " tag--gold" : ""}${t.id.startsWith("proj") ? " tag--proj" : ""}`} ref={(e) => { tagEls.current[t.id] = e; }} style={{ opacity: 0 }}>
            <i className="tag__dot" /><i className="tag__lead" />
            <span className="tag__text">{t.sub && <small>{t.sub}</small>}{t.label}</span>
          </div>
        ))}
      </div>
      <div className="scrim" aria-hidden="true" />
      <Loader ref={loader} />
      <Cursor />

      {/* ---------- HUD ---------- */}
      <header className="hud">
        <div className="hud__top">
          <a href="#top" className="mark hud__fade" onClick={(e) => { e.preventDefault(); go("top"); }} aria-label={`${profile.name}, back to top`}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6.5" /><ellipse cx="16" cy="16" rx="14" ry="4.2" /></svg>
            <span>{profile.name}</span>
          </a>
          <nav className={`nav hud__fade${menu ? " nav--open" : ""}`} id="nav" aria-label="Sections">
            <ol>
              {SECTIONS.map((s, i) => (
                <li key={s.id} className={i === active ? "is-active" : ""}>
                  <a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); go(s.id); }} aria-current={i === active ? "true" : undefined}>
                    <span className="nav__n">{pad2(i + 1)}</span>{s.label}
                  </a>
                </li>
              ))}
            </ol>
            <div className="nav__extra">
              <button className="btn btn--solid" onClick={() => openAgent()}>Ask my agent</button>
              <a className="btn" href={site.resume} download={site.resumeName}>Resume</a>
            </div>
          </nav>
          <button className="menu hud__fade" aria-expanded={menu} aria-controls="nav" onClick={() => setMenu((m) => !m)}>
            <span>{menu ? "Close" : "Menu"}</span><i aria-hidden="true" />
          </button>
        </div>

        <div className="rail hud__fade" aria-hidden="true">
          <div className="rail__track"><i ref={(e) => { hud.current.bar = e; }} /></div>
          <ol className="rail__ticks">
            {SECTIONS.map((s, i) => (
              <li key={s.id} style={{ top: `${ROUTE_AT[s.id] * 100}%` }} className={i <= active ? "is-past" : ""}><span>{s.label}</span></li>
            ))}
          </ol>
          <div className="rail__mark" ref={(e) => { hud.current.mark = e; }}><b /></div>
        </div>

        <dl className="readout hud__fade" aria-hidden="true">
          <div><dt>Orbit</dt><dd><span ref={(e) => { hud.current.r = e; }}>30.0</span> r<sub>s</sub></dd></div>
          <div><dt>Clock rate</dt><dd><span ref={(e) => { hud.current.clock = e; }}>0.983</span>x</dd></div>
        </dl>

        <div className="dock hud__fade">
          <button className="dock__btn dock__btn--agent" onClick={() => openAgent()} data-cursor="Ask">
            <i aria-hidden="true" /> <span>Ask my agent</span>
          </button>
          <a className="dock__btn dock__btn--resume" href={site.resume} download={site.resumeName} data-cursor="PDF">Resume</a>
          <button className="dock__btn dock__btn--icon" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Turn the drone off" : "Turn the drone on"} data-cursor={sound ? "Mute" : "Sound"}>
            <svg className={`wave${sound ? " wave--on" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
              {[4, 8, 12, 16, 20].map((x, i) => <line key={x} x1={x} x2={x} y1={12 - [2, 5, 8, 5, 2][i]} y2={12 + [2, 5, 8, 5, 2][i]} style={{ animationDelay: `${i * 0.12}s` }} />)}
            </svg>
          </button>
          <button className="dock__btn dock__btn--kbd" onClick={() => setPaletteOpen(true)} aria-label="Open command menu">
            <kbd>{isMac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd>
          </button>
        </div>
      </header>

      <Agent open={agentOpen} onClose={closeAgent} seed={agentSeed} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} onAsk={(q) => openAgent(q)} />

      <main>
        {/* ---------- HERO ---------- */}
        <section className="hero" id="top">
          <div className="hero__inner">
            <p className="eyebrow hero__fade">{profile.role}<span>{profile.location}</span></p>
            <h1 className="hero__name" aria-label={profile.name} style={{ ["--chars" as string]: NAME_FIT }}>
              {NAME_LINES.map((line, l) => (
                <span className="hero__line" aria-hidden="true" key={l}>
                  {line.split(" ").map((w, wi) => (
                    <Fragment key={wi}>
                      {wi > 0 && " "}
                      {/* hyphenated names may wrap after the hyphen */}
                      {w.split(/(?<=-)/).map((part, pi) => (
                        <span className="hero__word" key={pi}>{[...part].map((c, i) => <span className="ch" key={i}>{c}</span>)}</span>
                      ))}
                    </Fragment>
                  ))}
                </span>
              ))}
            </h1>
            <p className="hero__role hero__fade">{profile.headline}</p>
            <p className="hero__lede hero__fade">{profile.intro}</p>
            <div className="hero__actions hero__fade">
              <button className="btn btn--solid" onClick={() => openAgent()} data-cursor="Ask">Ask my agent</button>
              <a className="btn" href={site.resume} download={site.resumeName} data-cursor="PDF">Download resume</a>
            </div>
          </div>
          <div className="hero__bottom"><p className="hero__scroll hero__fade"><i aria-hidden="true" />Scroll to fall in</p></div>
        </section>

        {/* ---------- ABOUT ---------- */}
        <section className="stage stage--left" id="about" data-sec>
          <div className="panel panel--about">
            <Kicker n={secN("about")} label="About" orbit="Wide orbit" />
            <h2 className="h2 reveal">{profile.aboutHeading}</h2>
            <div className="about__body">
              {profile.about.map((p) => <p key={p.slice(0, 18)}>{p}</p>)}
            </div>
            <dl className="facts-row">
              <div><dt>Based in</dt><dd>{profile.location}</dd></div>
              <div><dt>Now</dt><dd>{profile.role}</dd></div>
              <div><dt>Coordinates</dt><dd>{profile.coords}</dd></div>
            </dl>
          </div>
        </section>

        {/* ---------- EXPERIENCE ---------- */}
        <section className="stage stage--right" id="experience" data-sec>
          <div className="panel panel--wide">
            <Kicker n={secN("experience")} label="Experience" orbit={`${plural(experience.length, "orbit", "orbits")} so far`} />
            <h2 className="h2 reveal">Experience</h2>
            <ol className={`timeline${experience.length === 1 ? " timeline--one" : ""}`}>
              {experience.map((e, i) => (
                <li key={e.org + e.start} className={i === 0 ? "timeline__now" : ""}>
                  <p className="timeline__when">{e.start} to {e.end}</p>
                  <h3 className="h3">{e.role}</h3>
                  <p className="timeline__org">{e.org}, {e.place}</p>
                  <ul>{e.points.map((p) => <li key={p.slice(0, 24)}>{p}</li>)}</ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- FLAGSHIP ---------- */}
        <section className="stage stage--left" id="flagship" data-sec>
          <div className="panel panel--wide panel--omni">
            <div className="omni__head">
              <Kicker n={secN("flagship")} label="Flagship" orbit={`${plural(featured.parts.length, "body", "bodies")}, one system`} />
              <h2 className="h2 h2--xl reveal">{featured.title}</h2>
              <p className="lead">{featured.tagline}</p>
              <p className="omni__desc">{featured.description}</p>
              <p className="stack">{featured.stack.join("  /  ")}</p>
            </div>
            <div className="omni__side">
              <div className="agents" role="group" aria-label={`${featured.title} parts`}>
                {featured.parts.map((a, i) => (
                  <button key={a.name} className={`agent${agent === i ? " agent--on" : ""}`} aria-pressed={agent === i}
                    onClick={() => setAgent(i)} onMouseEnter={() => setAgent(i)} onFocus={() => setAgent(i)}>
                    <span className="agent__n">{pad2(i + 1)}</span>
                    <span className="agent__name">{a.name}</span>
                  </button>
                ))}
              </div>
              {featured.parts[agent] && (
                <p className="agents__role" aria-live="polite"><strong>{featured.parts[agent].name}.</strong> {featured.parts[agent].role}</p>
              )}
              <ul className="facts">{featured.facts.map((f) => <li key={f}>{f}</li>)}</ul>
              {featured.links.map((l) => (
                <a key={l.label} className="btn btn--solid" href={l.href} {...ext(l.href)} data-cursor="Open">{l.label}</a>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- PROJECTS ---------- */}
        <section className="reel" id="projects" data-sec>
          <div className="reel__head">
            <div>
              <Kicker n={secN("projects")} label="Projects" orbit="In the disk" />
              <h2 className="h2 reveal">{plural(projects.length, "body", "bodies")} in the disk</h2>
            </div>
            <div className="reel__meta">
              <ul className="legend">
                {CATEGORIES.map((c) => <li key={c.name}><i style={{ background: c.color }} />{c.name}</li>)}
              </ul>
              <p className="reel__count" aria-hidden="true"><b ref={(e) => { hud.current.count = e; }}>{pad2(card + 1)}</b> / {pad2(projects.length)}</p>
            </div>
          </div>
          <div className="reel__track">
            {projects.map((p, i) => (
              <article className={`card${i === card ? " card--on" : ""}`} key={p.title} style={{ ["--cat" as string]: categoryColor(p.category) }}>
                <header className="card__top">
                  <span className="card__n">{pad2(i + 1)}</span>
                  <span className="card__cat"><i />{p.category}</span>
                  <span className="card__year">{p.year}</span>
                </header>
                <h3 className="card__title">{p.title}</h3>
                {p.badge && <p className={`badge${p.award ? " badge--gold" : ""}`}>{p.badge}</p>}
                <p className="card__sum">{p.summary}</p>
                <p className="card__detail">{p.detail}</p>
                <footer className="card__foot">
                  {p.metric && <p className="card__metric"><b>{p.metric.value}</b><span>{p.metric.label}</span></p>}
                  <p className="stack">{p.stack.join("  /  ")}</p>
                  {p.links && p.links.length > 0 && (
                    <p className="card__links">
                      {p.links.map((l) => <a key={l.label + l.href} href={l.href} {...ext(l.href)} data-cursor="Open">{l.label}</a>)}
                    </p>
                  )}
                </footer>
              </article>
            ))}
            {site.moreWork && (
              <article className="card card--end">
                <p>{site.moreWork.text}</p>
                <a className="btn" href={site.moreWork.href} {...ext(site.moreWork.href)} data-cursor="Open">{site.moreWork.label}</a>
              </article>
            )}
          </div>
        </section>

        {/* ---------- RESEARCH (hidden when there are no publications) ---------- */}
        {publications.length > 0 && (
          <section className="stage stage--right" id="research" data-sec>
            <div className="panel panel--wide">
              <Kicker n={secN("research")} label="Research" orbit={plural(publications.length, "pulsar", "pulsars")} />
              <h2 className="h2 reveal">{research.heading}</h2>
              {research.lead && <p className="lead">{research.lead}</p>}
              <ol className={`pubs${publications.length > 4 ? " pubs--many" : ""}`}>
                {publications.map((p) => (
                  <li key={p.title} className={p.award ? "pub--award" : ""}>
                    <p className="pubs__venue"><span>{p.venue}</span><span>{p.year}</span></p>
                    <h3 className="pubs__title">{p.title}</h3>
                    <p className="pubs__meta">{p.publisher}. {p.where}.</p>
                    {p.note && <p className={p.award ? "badge badge--gold" : "pubs__note"}>{p.note}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* ---------- TOOLKIT ---------- */}
        <section className="stage stage--left" id="toolkit" data-sec>
          <div className="panel panel--wide">
            <Kicker n={secN("toolkit")} label="Toolkit" orbit="Near the inner edge" />
            <h2 className="h2 reveal">Toolkit</h2>
            <div className="skills">
              {skills.map((g) => (
                <div key={g.group}>
                  <h3 className="h4">{g.group}</h3>
                  <ul>{g.items.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ))}
            </div>
            {certifications.length > 0 && <>
              <h3 className="h4 certs__h">Certifications</h3>
              <ul className="certs">
                {certifications.map((c) => (
                  <li key={c.name}><span className="certs__name">{c.name}</span><span>{c.issuer}</span><span className="certs__date">{c.date}</span></li>
                ))}
              </ul>
            </>}
          </div>
        </section>

        {/* ---------- CONTACT ---------- */}
        <section className="stage stage--contact" id="contact" data-sec>
          <div className="contact">
            <Kicker n={secN("contact")} label="Contact" orbit="Photon sphere" />
            <h2 className="contact__h reveal">{contact.heading}</h2>
            <p className="contact__lead">{contact.lead}</p>
            <a className="contact__email" href={`mailto:${profile.email}`} data-cursor="Write">{EMAIL_USER}@<wbr />{EMAIL_HOST}</a>
            <div className="contact__row">
              <CopyButton />
              <a className="btn btn--solid" href={site.resume} download={site.resumeName}>Download resume</a>
            </div>
            {site.socials.length > 0 && (
              <div className="contact__links">
                {site.socials.map((l) => <a key={l.label} href={l.href} {...ext(l.href)}>{l.label}</a>)}
              </div>
            )}
          </div>
          <footer className="footer">
            <p>© {new Date().getFullYear()} {profile.name}. {profile.location}.</p>
            {site.footerNote && <p>{site.footerNote}</p>}
            <p>Black hole ray traced live in WebGL. Built with Three.js and GSAP.</p>
          </footer>
        </section>
      </main>
    </div>
  );
}

function Kicker({ n, label, orbit }: { n: number; label: string; orbit: string }) {
  return (
    <p className="kicker"><span className="kicker__n">{pad2(n)}</span><span>{label}</span><span className="kicker__o">{orbit}</span></p>
  );
}

function CopyButton() {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  return (
    <button className="btn" onClick={async () => {
      try { await navigator.clipboard.writeText(profile.email); setCopied(true); } catch { window.location.href = `mailto:${profile.email}`; }
    }}>
      {copied ? "Copied" : "Copy email"}
      <span className="sr-only" aria-live="polite">{copied ? "Email address copied" : ""}</span>
    </button>
  );
}

/* -------------------------------------------------------------- */
/* Scroll choreography                                             */
/* -------------------------------------------------------------- */
function buildScroll(mobile: boolean, reduce: boolean) {
  const reel = document.querySelector<HTMLElement>(".reel");
  const track = document.querySelector<HTMLElement>(".reel__track");
  if (reel && track && !mobile) {
    // with few projects the track may be narrower than the screen: never pan
    // backwards, and keep enough scroll for the camera's ride around the ring
    const dist = () => Math.max(0, track.scrollWidth - window.innerWidth + 120);
    const pan = gsap.to(track, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        id: "reel", trigger: reel, start: "top top", end: () => `+=${Math.max(dist() * 1.15, window.innerHeight * 1.6)}`, pin: true, scrub: reduce ? true : 0.5, invalidateOnRefresh: true,
        toggleClass: { targets: document.documentElement, className: "in-reel" },
      },
    });
    if (!reduce) {
      gsap.utils.toArray<HTMLElement>(".card").forEach((card) => {
        gsap.fromTo(card, { y: 60, opacity: 0.2 }, {
          y: 0, opacity: 1, ease: "power1.out",
          scrollTrigger: { trigger: card, containerAnimation: pan, start: "left 104%", end: "left 66%", scrub: true },
        });
      });
    }
  }

  if (reduce) return;

  gsap.utils.toArray<HTMLElement>(".reveal").forEach((h) => {
    const split = SplitText.create(h, { type: "words", mask: "words" });
    gsap.fromTo(split.words, { yPercent: 110 }, {
      yPercent: 0, duration: 1, stagger: 0.06, ease: "expo.out",
      scrollTrigger: { trigger: h, start: "top 90%", toggleActions: "play none none reverse" },
    });
  });

  gsap.utils.toArray<HTMLElement>(".stage").forEach((s) => {
    const panel = s.querySelector<HTMLElement>(".panel, .contact");
    if (!panel) return;
    const fromX = mobile ? 0 : s.classList.contains("stage--right") ? 48 : s.classList.contains("stage--left") ? -48 : 0;
    gsap.fromTo(panel, { x: fromX, y: 50, autoAlpha: 0 }, {
      x: 0, y: 0, autoAlpha: 1, duration: 1.1, ease: "power3.out",
      scrollTrigger: { trigger: panel, start: "top 92%", toggleActions: "play none none reverse" },
    });
  });

  gsap.fromTo(".contact", { scale: 1.06 }, {
    scale: 1, ease: "none",
    scrollTrigger: { trigger: "#contact", start: "top bottom", end: "bottom bottom", scrub: true },
  });

  // the hero stack fades as it scrolls, so it is gone before it reaches the top bar
  gsap.to(".hero__inner", {
    y: 50, autoAlpha: 0, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "52% top", scrub: true },
  });
  gsap.to(".hero__bottom", {
    autoAlpha: 0, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "20% top", scrub: true },
  });
}
