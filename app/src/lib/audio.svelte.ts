// Feedback sonoro: beeps ok/error post-impulso y metrónomo para ritmo de captura.
// Se sintetiza con Web Audio API (sin assets).

type Tone = { freq: number; durMs: number; type?: OscillatorType };

class AudioBus {
  enabled = $state(false);
  volume = $state(0.5);             // 0..1
  okTone = $state<Tone>({ freq: 880, durMs: 90, type: 'sine' });
  errorTone = $state<Tone>({ freq: 220, durMs: 220, type: 'square' });

  // Metrónomo
  metroEnabled = $state(false);
  metroBpm = $state(60);            // pulsos por minuto
  metroAccentEvery = $state(4);     // cada cuántos pulsos cambia tono
  metroTickIdx = 0;
  metroInterval?: ReturnType<typeof setInterval>;

  private ctx?: AudioContext;
  private ensure() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private playTone(t: Tone, gainMul = 1) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.value = t.freq;
    const peak = Math.max(0, Math.min(1, this.volume * gainMul));
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.005);
    g.gain.linearRampToValueAtTime(0, now + t.durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + t.durMs / 1000 + 0.02);
  }

  beepOk() { this.playTone(this.okTone); }
  beepError() { this.playTone(this.errorTone); }
  testBeep() {
    // Forzar reproducción aunque enabled=false (para previa en config)
    const wasEnabled = this.enabled;
    this.enabled = true;
    this.beepOk();
    this.enabled = wasEnabled;
  }

  startMetronome() {
    this.stopMetronome();
    if (!this.enabled || !this.metroEnabled) return;
    const periodMs = 60_000 / Math.max(20, Math.min(240, this.metroBpm));
    this.metroTickIdx = 0;
    this.metroInterval = setInterval(() => {
      const accent = this.metroAccentEvery > 0 && this.metroTickIdx % this.metroAccentEvery === 0;
      this.playTone({
        freq: accent ? 1200 : 700,
        durMs: 60,
        type: 'square',
      }, accent ? 0.9 : 0.55);
      this.metroTickIdx++;
    }, periodMs);
  }

  stopMetronome() {
    if (this.metroInterval) clearInterval(this.metroInterval);
    this.metroInterval = undefined;
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopMetronome();
    else if (this.metroEnabled) this.startMetronome();
  }
  toggleMetro() {
    this.metroEnabled = !this.metroEnabled;
    if (this.enabled && this.metroEnabled) this.startMetronome();
    else this.stopMetronome();
  }
}

export const audio = new AudioBus();
