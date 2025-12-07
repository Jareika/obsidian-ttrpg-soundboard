import { App, TFile } from "obsidian";

export interface PlayOptions {
  volume?: number; // 0..1
  loop?: boolean;
  fadeInMs?: number;
}

export interface StopOptions {
  fadeOutMs?: number;
}

export interface PlaybackEvent {
  type: "start" | "stop";
  filePath: string;
  id: string;
  reason?: "ended" | "stopped"; // ended = natural end of the file, stopped = stopped manually
}

type WindowWithWebAudio = Window & { webkitAudioContext?: typeof AudioContext };

export class AudioEngine {
  private app: App;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Small cache of decoded AudioBuffers, with a configurable upper limit in MB.
  private buffers = new Map<string, AudioBuffer>();
  private bufferUsage = new Map<string, number>(); // path -> approximate bytes
  private totalBufferedBytes = 0;
  private maxCachedBytes = 512 * 1024 * 1024; // default 512 MB

  private playing = new Map<
    string,
    {
      id: string;
      source: AudioBufferSourceNode;
      gain: GainNode;
      file: TFile;
      stopped: boolean;
    }
  >();
  private masterVolume = 1;
  private listeners = new Set<(e: PlaybackEvent) => void>();

  constructor(app: App) {
    this.app = app;
  }

  // ===== Public API =====

  on(cb: (e: PlaybackEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.masterVolume,
        this.ctx.currentTime,
      );
    }
  }

  /**
   * Configure the upper limit of the decoded-audio cache in megabytes.
   * 0 = disable caching completely (always decode from file, minimal RAM).
   */
  setCacheLimitMB(mb: number) {
    const clamped = Math.max(0, mb || 0);
    this.maxCachedBytes = clamped * 1024 * 1024;

    if (this.maxCachedBytes === 0) {
      this.clearBufferCache();
    } else {
      this.enforceCacheLimit();
    }
  }

  /**
   * Drop all cached decoded AudioBuffers.
   * Already playing sounds keep working; only the reuse-cache is cleared.
   */
  clearBufferCache() {
    this.buffers.clear();
    this.bufferUsage.clear();
    this.totalBufferedBytes = 0;
  }

  async ensureContext() {
    if (!this.ctx) {
      const w = window as WindowWithWebAudio;
      const Ctx = (window.AudioContext ?? w.webkitAudioContext) as
        | typeof AudioContext
        | undefined;
      if (!Ctx) throw new Error("Web Audio API not available");
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // Some browsers may refuse to resume the context; ignore.
      }
    }
  }

  async loadBuffer(file: TFile): Promise<AudioBuffer> {
    const key = file.path;

    // If caching is enabled and we have a buffer, reuse it (and mark as recently used).
    if (this.maxCachedBytes > 0) {
      const cached = this.buffers.get(key);
      if (cached) {
        this.touchBufferKey(key);
        return cached;
      }
    }

    const bin = await this.app.vault.readBinary(file);
    await this.ensureContext();
    const ctx = this.ctx!;
    const arrBuf =
      bin instanceof ArrayBuffer ? bin : new Uint8Array(bin).buffer;

    const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
    });

    if (this.maxCachedBytes > 0) {
      const approxBytes =
        audioBuffer.length * audioBuffer.numberOfChannels * 4; // 32-bit float
      this.buffers.set(key, audioBuffer);
      this.bufferUsage.set(key, approxBytes);
      this.totalBufferedBytes += approxBytes;
      this.touchBufferKey(key);
      this.enforceCacheLimit();
    }

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
      this.emit({
        type: "stop",
        filePath: file.path,
        id,
        reason: "ended",
      });
    };

    return {
      id,
      stop: (sOpts?: StopOptions) => this.stopById(id, sOpts),
    };
  }

  async stopByFile(file: TFile, fadeOutMs = 0) {
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path,
    );
    await Promise.all(
      targets.map((t) => this.stopById(t.id, { fadeOutMs })),
    );
  }

  async stopAll(fadeOutMs = 0) {
    const ids = [...this.playing.keys()];
    await Promise.all(ids.map((id) => this.stopById(id, { fadeOutMs })));
  }

  async preload(files: TFile[]) {
    for (const f of files) {
      try {
        await this.loadBuffer(f);
      } catch (err) {
        console.error("TTRPG Soundboard: preload failed", f.path, err);
      }
    }
  }

  /**
   * Set the volume (0..1) for all currently playing instances
   * of a given file path (this does not touch the global master gain).
   */
  setVolumeForPath(path: string, volume: number) {
    if (!this.ctx) return;
    const v = Math.max(0, Math.min(1, volume));
    const now = this.ctx.currentTime;

    for (const rec of this.playing.values()) {
      if (rec.file.path === path) {
        rec.gain.gain.cancelScheduledValues(now);
        rec.gain.gain.setValueAtTime(v, now);
      }
    }
  }

  getPlayingFilePaths(): string[] {
    const set = new Set<string>();
    for (const v of this.playing.values()) set.add(v.file.path);
    return [...set];
  }

  /**
   * Called when the plugin unloads – closes the AudioContext and drops caches.
   */
  shutdown() {
    try {
      void this.ctx?.close();
    } catch {
      // Ignore errors while closing the context.
    }
    this.ctx = null;
    this.masterGain = null;
    this.clearBufferCache();
    this.playing.clear();
  }

  // ===== Internal helpers =====

  private emit(e: PlaybackEvent) {
    this.listeners.forEach((fn) => {
      try {
        void fn(e);
      } catch {
        // Ignore listener errors so one bad listener does not break others
      }
    });
  }

  private stopById(id: string, sOpts?: StopOptions): Promise<void> {
    const rec = this.playing.get(id);
    if (!rec || rec.stopped) return Promise.resolve();
    rec.stopped = true;
    const ctx = this.ctx!;
    const fadeOut = (sOpts?.fadeOutMs ?? 0) / 1000;
    const n = ctx.currentTime;

    return new Promise<void>((resolve) => {
      if (fadeOut > 0) {
        rec.gain.gain.cancelScheduledValues(n);
        const cur = rec.gain.gain.value;
        rec.gain.gain.setValueAtTime(cur, n);
        rec.gain.gain.linearRampToValueAtTime(0, n + fadeOut);
        window.setTimeout(() => {
          try {
            rec.source.stop();
          } catch {
            // Ignore errors when stopping an already-stopped source
          }
          this.playing.delete(id);
          this.emit({
            type: "stop",
            filePath: rec.file.path,
            id,
            reason: "stopped",
          });
          resolve();
        }, Math.max(1, sOpts?.fadeOutMs ?? 0));
      } else {
        try {
          rec.source.stop();
        } catch {
          // Ignore errors when stopping an already-stopped source
        }
        this.playing.delete(id);
        this.emit({
          type: "stop",
          filePath: rec.file.path,
          id,
          reason: "stopped",
        });
        resolve();
      }
    });
  }

  private touchBufferKey(key: string) {
    const buf = this.buffers.get(key);
    if (!buf) return;
    const size = this.bufferUsage.get(key) ?? 0;

    // Reinsert to the end so Map iteration order behaves like LRU.
    this.buffers.delete(key);
    this.bufferUsage.delete(key);
    this.buffers.set(key, buf);
    this.bufferUsage.set(key, size);
  }

  private enforceCacheLimit() {
    if (this.maxCachedBytes <= 0) {
      this.clearBufferCache();
      return;
    }
    if (this.totalBufferedBytes <= this.maxCachedBytes) return;

    // Evict least-recently-used entries until we are under the limit.
    for (const key of this.buffers.keys()) {
      if (this.totalBufferedBytes <= this.maxCachedBytes) break;
      const size = this.bufferUsage.get(key) ?? 0;
      this.buffers.delete(key);
      this.bufferUsage.delete(key);
      this.totalBufferedBytes -= size;
    }

    if (this.totalBufferedBytes < 0) this.totalBufferedBytes = 0;
  }
}