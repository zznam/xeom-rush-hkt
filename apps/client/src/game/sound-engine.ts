/**
 * SoundEngine — procedural Web Audio API sounds for Xe Ôm Rush.
 * All sounds are generated with oscillators + gain envelopes; no external audio files needed.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineRunning: boolean = false;

  private getCtx(): AudioContext | null {
    if (typeof window === 'undefined' || !window.AudioContext) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    // Resume if suspended (browsers require user gesture before audio)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Play a tone burst: oscillator type, freq (Hz), duration (s), volume (0–1). */
  private playTone(
    type: OscillatorType,
    freq: number,
    duration: number,
    volume: number = 0.3,
    startTime: number = 0,
  ): void {
    const ctx = this.getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);

    gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration + 0.05);
  }

  /**
   * Engine hum — continuous sawtooth oscillator whose pitch scales with speed.
   * Call every render frame with current speed value [0, maxSpeed].
   */
  public engineHum(speed: number, maxSpeed: number = 200): void {
    const ctx = this.getCtx();
    if (!ctx) return;

    const minFreq = 80;
    const maxFreq = 380;
    const t = Math.min(speed / maxSpeed, 1);
    const freq = minFreq + t * (maxFreq - minFreq);

    if (!this.engineRunning) {
      this.engineOsc = ctx.createOscillator();
      this.engineGain = ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineGain.gain.setValueAtTime(0.04, ctx.currentTime);
      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(ctx.destination);
      this.engineOsc.start();
      this.engineRunning = true;
    }

    if (this.engineOsc) {
      this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.1);
    }
  }

  /** Silence the engine hum (e.g., when player disconnects). */
  public stopEngine(): void {
    if (this.engineOsc) {
      try { this.engineOsc.stop(); } catch (_) {}
      this.engineOsc = null;
    }
    this.engineGain = null;
    this.engineRunning = false;
  }

  /** Pickup chime — ascending C5 → E5 → G5. */
  public playPickup(): void {
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => this.playTone('sine', freq, 0.12, 0.35, i * 0.10));
  }

  /** Dropoff fanfare — triumphant arpeggio C5 → E5 → G5 → C6. */
  public playDropoff(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => this.playTone('sine', freq, 0.18, 0.4, i * 0.09));
  }

  /** Honk — short harsh buzz at ~300 Hz. */
  public playHonk(): void {
    this.playTone('square', 300, 0.2, 0.5);
    this.playTone('square', 260, 0.2, 0.3, 0.05);
  }

  /** Rush Hour sting — dramatic 4-note ascending fanfare on horns (sawtooth). */
  public playRushHourSting(): void {
    const notes = [392, 523.25, 659.25, 783.99]; // G4, C5, E5, G5
    notes.forEach((freq, i) => this.playTone('sawtooth', freq, 0.35, 0.45, i * 0.15));
    // Add a sustaining final chord
    this.playTone('sawtooth', 783.99, 0.8, 0.3, 0.6);
  }

  /** VIP announcement — regal 3-note fanfare. */
  public playVIPAnnounce(): void {
    const notes = [659.25, 880, 1046.5]; // E5, A5, C6
    notes.forEach((freq, i) => this.playTone('triangle', freq, 0.4, 0.5, i * 0.15));
  }
}

export const soundEngine = new SoundEngine();
