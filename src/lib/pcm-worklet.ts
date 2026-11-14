/**
 * The AudioWorklet that turns the recorder's microphone stream into 16 kHz mono 16 bit frames for
 * Deepgram (spec 0021 step 2). Its source is a string so the page can load it from a Blob URL (no
 * extra file to serve) and the test can run the very same code against fake globals. It keeps
 * nothing: every frame goes to the main thread and is gone. No audio is stored.
 */
export const PCM_WORKLET_NAME = "pcm-16k-frames";
/** Output rate Deepgram is told about (`sample_rate` in the socket URL). */
export const PCM_SAMPLE_RATE = 16000;
/** Samples per posted frame: 1600 is 100 ms at 16 kHz. */
export const PCM_FRAME_SAMPLES = 1600;

export const PCM_WORKLET_SOURCE = `
class Pcm16kFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${PCM_SAMPLE_RATE};
    this.pos = 0;
    this.out = new Int16Array(${PCM_FRAME_SAMPLES});
    this.n = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const frames = channels[0].length;
    const mono = new Float32Array(frames);
    for (let c = 0; c < channels.length; c++) {
      for (let i = 0; i < frames; i++) mono[i] += channels[c][i] / channels.length;
    }
    while (this.pos < frames) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = mono[i];
      const b = i + 1 < frames ? mono[i + 1] : mono[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.out[this.n++] = s < 0 ? s * 32768 : s * 32767;
      if (this.n === ${PCM_FRAME_SAMPLES}) {
        const buf = this.out.buffer;
        this.port.postMessage(buf, [buf]);
        this.out = new Int16Array(${PCM_FRAME_SAMPLES});
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= frames;
    return true;
  }
}
registerProcessor("${PCM_WORKLET_NAME}", Pcm16kFrames);
`;
