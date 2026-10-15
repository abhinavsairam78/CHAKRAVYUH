// Lite voiceprint in the browser: MFCC statistics + median pitch of the caller's voice, computed
// with the Web Audio API. A stand-in for the pretrained ECAPA-TDNN embedding used in production;
// it is one linking signal among several, and the dashboard shows its score.
(function () {
  const MELS = 26, CEPS = 12;

  function melFilters(sampleRate, bins) {
    const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
    const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
    const lo = hz2mel(80), hi = hz2mel(4000);
    const pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (MELS + 1)));
    const binOf = (f) => Math.floor((f / (sampleRate / 2)) * (bins - 1));
    return Array.from({ length: MELS }, (_, m) => {
      const [a, b, c] = [binOf(pts[m]), binOf(pts[m + 1]), binOf(pts[m + 2])];
      const w = [];
      for (let k = a; k <= c; k++) w.push([k, k <= b ? (k - a) / Math.max(1, b - a) : (c - k) / Math.max(1, c - b)]);
      return w;
    });
  }

  function pitch(buf, sr) {
    const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
    let energy = 0;
    for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
    if (!energy) return null;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
      const r = s / energy;
      if (r > best) { best = r; bestLag = lag; }
    }
    return best > 0.45 ? sr / bestLag : null;
  }

  class VoiceprintCapture {
    async start(stream) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 2048;
      this.an.smoothingTimeConstant = 0;
      src.connect(this.an);
      this.filters = melFilters(this.ctx.sampleRate, this.an.frequencyBinCount);
      this.time = new Float32Array(this.an.fftSize);
      this.freq = new Float32Array(this.an.frequencyBinCount);
      this.sum = new Float64Array(CEPS);
      this.sq = new Float64Array(CEPS);
      this.frames = 0;
      this.f0 = [];
      this.paused = false;
      this.level = 0;
      this.timer = setInterval(() => this.frame(), 40);
    }

    frame() {
      this.an.getFloatTimeDomainData(this.time);
      let rms = 0;
      for (const v of this.time) rms += v * v;
      rms = Math.sqrt(rms / this.time.length);
      this.level = rms;
      if (this.paused || rms < 0.012) return;
      this.an.getFloatFrequencyData(this.freq);
      const logMel = this.filters.map((w) => Math.log(1e-10 + w.reduce((s, [k, wt]) => s + wt * 10 ** (this.freq[k] / 10), 0)));
      for (let c = 1; c <= CEPS; c++) {
        let v = 0;
        for (let m = 0; m < MELS; m++) v += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / MELS);
        this.sum[c - 1] += v;
        this.sq[c - 1] += v * v;
      }
      this.frames++;
      const f = pitch(this.time.subarray(0, 1024), this.ctx.sampleRate);
      if (f) this.f0.push(f);
    }

    result() {
      clearInterval(this.timer);
      this.ctx?.close();
      if (this.frames < 25) return null;
      const mean = [...this.sum].map((s) => s / this.frames);
      const std = [...this.sq].map((s, i) => Math.sqrt(Math.max(0, s / this.frames - mean[i] ** 2)));
      const f0 = this.f0.sort((a, b) => a - b)[Math.floor(this.f0.length / 2)] || null;
      return { kind: 'mfcc-lite', vector: [...mean, ...std].map((v) => Number(v.toFixed(3))), f0: f0 && Math.round(f0), frames: this.frames };
    }
  }

  window.VoiceprintCapture = VoiceprintCapture;
})();
