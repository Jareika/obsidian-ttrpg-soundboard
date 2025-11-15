import { App, TFile } from "obsidian";

export interface PlayOptions {
  volume?: number;   // 0..1
  loop?: boolean;
  fadeInMs?: number;
}
export interface StopOptions { fadeOutMs?: number; }

export interface PlaybackEvent {
  type: "start" | "stop";
  filePath: string;
  id: string;
  reason?: "ended" | "stopped"; // ended = natürliches Ende, stopped = manuell/Stop
}

type WindowWithWebAudio = Window & { webkitAudioContext?: typeof AudioContext };

export class AudioEngine {
  private app: App;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private playing = new Map<string, { id: string; source: AudioBufferSourceNode; gain: GainNode; file: TFile; stopped: boolean }>();
  private masterVolume = 1;
  private listeners = new Set<(e: PlaybackEvent) => void>();

  constructor(app: App) { this.app = app; }

  on(cb: (e: PlaybackEvent) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private emit(e: PlaybackEvent) {
    // Intendiert nicht gewartet – Kennzeichnung mit void, um Linter-Anforderung zu erfüllen
    this.listeners.forEach(fn => {
      try { void fn(e); } catch (_err) { /* ignore listener error */ }
    });
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  async ensureContext() {
    if (!this.ctx) {
      const w = window as WindowWithWebAudio;
      const Ctx = (window.AudioContext ?? w.webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) throw new Error("Web Audio API not available");
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch (_e) { /* ignore resume error */ }
    }
  }

  async loadBuffer(file: TFile): Promise<AudioBuffer> {
    const key = file.path;
    if (this.buffers.has(key)) return this.buffers.get(key)!;

    const bin = await this.app.vault.readBinary(file);
    await this.ensureContext();
    const ctx = this.ctx!;
    const arrBuf = bin instanceof ArrayBuffer ? bin : new Uint8Array(bin).buffer;

    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      // slice(0) — sicheres, kopiertes ArrayBuffer für iOS/Safari
      ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
    });
    this.buffers.set(key, audioBuffer);
    return audioBuffer;
  }

  async play(file: TFile, opts: PlayOptions = {}) {
    await this.ensureContext();
    const buffer = await this.loadBuffer(file);
    const ctx = this.ctx!;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = !!opts.loop;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(gain);
    gain.connect(this.masterGain!);

    const now = ctx.currentTime;
    const targetVol = Math.max(0, Math.min(1, opts.volume ?? 1));
    const fadeIn = (opts.fadeInMs ?? 0) / 1000;
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetVol, now + fadeIn);
    } else {
      gain.gain.setValueAtTime(targetVol, now);
    }

    source.start();

    const rec = { id, source, gain, file, stopped: false };
    this.playing.set(id, rec);
    this.emit({ type: "start", filePath: file.path, id });

    source.onended = () => {
      const r = this.playing.get(id);
      if (!r || r.stopped) return;
      this.playing.delete(id);
      this.emit({ type: "stop", filePath: file.path, id, reason: "ended" });
    };

    return {
      id,
      stop: (sOpts?: StopOptions) => this.stopById(id, sOpts),
    };
  }

  private stopById(id: string, sOpts?: StopOptions): Promise<void> {
    const rec = this.playing.get(id);
    if (!rec || rec.stopped) return Promise.resolve();
    rec.stopped = true;
    const ctx = this.ctx!;
    const fadeOut = ((sOpts?.fadeOutMs ?? 0) / 1000);
    const n = ctx.currentTime;

    return new Promise<void>((resolve) => {
      if (fadeOut > 0) {
        rec.gain.gain.cancelScheduledValues(n);
        const cur = rec.gain.gain.value;
        rec.gain.gain.setValueAtTime(cur, n);
        rec.gain.gain.linearRampToValueAtTime(0, n + fadeOut);
        window.setTimeout(() => {
          try { rec.source.stop(); } catch (_e) { /* ignore stop error */ }
          this.playing.delete(id);
          this.emit({ type: "stop", filePath: rec.file.path, id, reason: "stopped" });
          resolve();
        }, Math.max(1, sOpts?.fadeOutMs ?? 0));
      } else {
        try { rec.source.stop(); } catch (_e) { /* ignore stop error */ }
        this.playing.delete(id);
        this.emit({ type: "stop", filePath: rec.file.path, id, reason: "stopped" });
        resolve();
      }
    });
  }

  async stopByFile(file: TFile, fadeOutMs = 0) {
    const targets = [...this.playing.values()].filter(p => p.file.path === file.path);
    await Promise.all(targets.map(t => this.stopById(t.id, { fadeOutMs })));
  }

  async stopAll(fadeOutMs = 0) {
    const ids = [...this.playing.keys()];
    await Promise.all(ids.map(id => this.stopById(id, { fadeOutMs })));
  }

  async preload(files: TFile[]) {
    for (const f of files) {
      try { await this.loadBuffer(f); } catch (err) { console.warn("Preload failed", f.path, err); }
    }
  }

  getPlayingFilePaths(): string[] {
    const set = new Set<string>();
    for (const v of this.playing.values()) set.add(v.file.path);
    return [...set];
  }
}