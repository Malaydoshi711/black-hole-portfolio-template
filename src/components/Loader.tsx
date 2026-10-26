import { forwardRef, useMemo } from "react";

/** Boot screen: "acquiring signal" while a gravitational-wave chirp draws
 *  itself in. Progress and exit are driven from App through GSAP. */
const Loader = forwardRef<HTMLDivElement>(function Loader(_, ref) {
  const { d, mx } = useMemo(chirp, []);
  return (
    <div className="loader" ref={ref} role="status" aria-live="polite">
      <div className="loader__inner">
        <p className="loader__label"><i aria-hidden="true" /> Acquiring signal</p>
        <svg className="loader__wave" viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
          <line className="loader__axis" x1="0" y1="110" x2="1000" y2="110" />
          {[0.25, 0.5, 0.75].map((x) => <line key={x} className="loader__grid" x1={x * 1000} y1="20" x2={x * 1000} y2="200" />)}
          <path className="loader__trace loader__trace--ghost" d={d} pathLength={1} />
          <path className="loader__trace" d={d} pathLength={1} />
          <circle className="loader__merger" cx={mx} cy="110" r="5" />
        </svg>
        <div className="loader__foot">
          <p className="loader__step">Calibrating the lens</p>
          <p className="loader__count"><span className="loader__num">000</span><span>%</span></p>
        </div>
      </div>
    </div>
  );
});

/** inspiral (frequency and amplitude rise), merger, ringdown */
function chirp() {
  const n = 1400;
  const tc = 0.8;
  const pts: string[] = [];
  let phase = 0;
  let last = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let y: number;
    if (t < tc) {
      const tau = Math.max(tc - t, 0.004);
      const f = 3.2 * Math.pow(tau / tc, -3 / 8);
      phase += f * (t - last) * Math.PI * 2 * 9;
      const amp = Math.min(1, 0.12 * Math.pow(tau / tc, -1 / 4) * (1 + 0.6 * Math.pow(t / tc, 8)));
      y = Math.sin(phase) * amp;
    } else {
      const s = t - tc;
      phase += 9 * (t - last) * Math.PI * 2 * 9 * 0.9;
      y = Math.sin(phase) * Math.exp(-s / 0.018);
    }
    last = t;
    pts.push(`${(t * 1000).toFixed(1)},${(110 - y * 88).toFixed(1)}`);
  }
  return { d: `M${pts.join("L")}`, mx: tc * 1000 };
}

export default Loader;
