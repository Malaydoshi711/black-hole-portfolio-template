/** A low drone synthesised with WebAudio (no audio files). Its pitch sinks
 *  as you fall closer, like light being redshifted. Off until the visitor
 *  turns it on. */
export class Drone {
  private ctx?: AudioContext;
  private master?: GainNode;
  private filter?: BiquadFilterNode;
  private oscs: { o: OscillatorNode; f: number }[] = [];
  on = false;

  private init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 260;
    this.filter.Q.value = 2;
    this.filter.connect(this.master);

    // slow breathing on the filter
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();

    [[41.2, "sine", 0.5], [41.6, "sine", 0.4], [61.7, "triangle", 0.12], [82.4, "sawtooth", 0.035]].forEach(([f, type, g]) => {
      const o = ctx.createOscillator();
      o.type = type as OscillatorType;
      o.frequency.value = f as number;
      const gain = ctx.createGain();
      gain.gain.value = g as number;
      o.connect(gain).connect(this.filter!);
      o.start();
      this.oscs.push({ o, f: f as number });
    });

    // faint dark noise bed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    src.connect(ng).connect(this.filter);
    src.start();
  }

  toggle() {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") ctx.resume();
    this.on = !this.on;
    this.master!.gain.setTargetAtTime(this.on ? 0.5 : 0, ctx.currentTime, 0.6);
    return this.on;
  }

  /** clock: gravitational clock rate at the camera, 0..1 */
  setClock(clock: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const k = 0.55 + 0.45 * clock;
    this.oscs.forEach(({ o, f }) => o.frequency.setTargetAtTime(f * k, t, 0.5));
    this.filter!.frequency.setTargetAtTime(150 + 160 * clock, t, 0.5);
  }

  dispose() { this.ctx?.close(); }
}
