import { App, TFile } from "obsidian";

export interface PlayOptions {
  volume?: number; // 0..1
  loop?: boolean;
  fadeInMs?: number;
}

export interface StopOptions {
  fadeOutMs?: number;
}

export type PlaybackEvent =
  | {
      type: "start";
      filePath: string;
      id: string;
    }
  | {
      type: "stop";
      filePath: string;
      id: string;
      reason?: "ended" | "stopped";
    }
  | {
      type: "pause";
      filePath: string;
      id: string;
    }
  | {
      type: "resume";
      filePath: string;
      id: string;
    };

type WindowWithWebAudio = Window & { webkitAudioContext?: typeof AudioContext };

interface PlaybackRecordBase {
  id: string;
  gain: GainNode;
  file: TFile;
  loop: boolean;
  state: "playing" | "paused";
  lastVolume: number; // last non-zero volume used for fades / resume
}

interface BufferPlaybackRecord extends PlaybackRecordBase {
  kind: "buffer";
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
  startTime: number; // AudioContext time when the current segment started
  offset: number; // seconds already played before startTime (for resume)
}

interface MediaPlaybackRecord extends PlaybackRecordBase {
  kind: "media";
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  endedHandler: (() => void) | null;
}

type PlaybackRecord = BufferPlaybackRecord | MediaPlaybackRecord;

export type PathPlaybackState = "none" | "playing" | "paused" | "mixed";

export class AudioEngine {
  private app: App;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Small cache of decoded AudioBuffers, with a configurable upper limit in MB.
  private buffers = new Map<string, AudioBuffer>();
  private bufferUsage = new Map<string, number>(); // path -> approximate bytes
  private totalBufferedBytes = 0;
  private maxCachedBytes = 512 * 1024 * 1024; // default 512 MB
  
  private mediaElementThresholdBytes = 25 * 1024 * 1024;
  private playing = new Map<string, PlaybackRecord>();
  private masterVolume = 1;
  private listeners = new Set<(e: PlaybackEvent) => void>();

  constructor(app: App) {
    this.app = app;
  }

  // ===== Event subscription =====

  on(cb: (e: PlaybackEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: PlaybackEvent) {
    this.listeners.forEach((fn) => {
      try {
        void fn(e);
      } catch {
        // Ignore listener errors so one bad listener does not break others
      }
    });
  }

  // ===== Master volume / cache config =====

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
  
  /**
   * Configure at which file size (in MB) playback switches to HTMLAudioElement (MediaElement).
   * 0 disables MediaElement playback completely (always decode to AudioBuffer).
   */
  setMediaElementThresholdMB(mb: number) {
    const clamped = Math.max(0, Number.isFinite(mb) ? mb : 0);
    this.mediaElementThresholdBytes = Math.round(clamped * 1024 * 1024);
  }

  // ===== Audio context / buffer loading =====

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

  private isLargeFile(file: TFile): boolean {
    if (this.mediaElementThresholdBytes <= 0) return false;
    const size = file.stat?.size ?? 0;
    return size > this.mediaElementThresholdBytes;
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
      // decodeAudioData also returns a Promise in modern browsers.
      // Here we intentionally use the callback signature and ignore that Promise.
      void ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
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

  // ===== Playback control =====

  async play(file: TFile, opts: PlayOptions = {}) {
    if (this.isLargeFile(file)) {
      try {
        return await this.playWithMediaElement(file, opts);
      } catch {
        // Fallback to buffer playback (for rare cases where a format cannot be played via <audio>)
        return await this.playWithBuffer(file, opts);
      }
    }
    return await this.playWithBuffer(file, opts);
  }

  private async playWithBuffer(file: TFile, opts: PlayOptions = {}) {
    await this.ensureContext();
    const buffer = await this.loadBuffer(file);
    const ctx = this.ctx!;
    const id = this.createId();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    const loop = !!opts.loop;
    source.loop = loop;

    gain.connect(this.masterGain!);
    source.connect(gain);

    const now = ctx.currentTime;
    const targetVol = Math.max(0, Math.min(1, opts.volume ?? 1));
    const fadeIn = (opts.fadeInMs ?? 0) / 1000;

    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetVol, now + fadeIn);
    } else {
      gain.gain.setValueAtTime(targetVol, now);
    }

    const rec: BufferPlaybackRecord = {
      kind: "buffer",
      id,
      source,
      gain,
      file,
      buffer,
      loop,
      state: "playing",
      startTime: now,
      offset: 0,
      lastVolume: targetVol,
    };
    this.playing.set(id, rec);

    source.onended = () => {
      const existing = this.playing.get(id);
      if (!existing) return;
      if (existing.state !== "playing") return;

      this.playing.delete(id);
      this.emit({
        type: "stop",
        filePath: file.path,
        id,
        reason: "ended",
      });
    };

    source.start();

    this.emit({ type: "start", filePath: file.path, id });

    return {
      id,
      stop: (sOpts?: StopOptions) => this.stopById(id, sOpts),
    };
  }

  private async playWithMediaElement(file: TFile, opts: PlayOptions = {}) {
    await this.ensureContext();
    const ctx = this.ctx!;
    const id = this.createId();

    const element = document.createElement("audio");
    element.preload = "auto";
    element.src = this.app.vault.getResourcePath(file);
    element.loop = !!opts.loop;

    const node = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;

    node.connect(gain);
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

    const rec: MediaPlaybackRecord = {
      kind: "media",
      id,
      element,
      node,
      gain,
      file,
      loop: !!opts.loop,
      state: "playing",
      lastVolume: targetVol,
      endedHandler: null,
    };
    this.playing.set(id, rec);

    const endedHandler = () => {
      const existing = this.playing.get(id);
      if (!existing) return;
      if (existing.state !== "playing") return;

      this.playing.delete(id);
      this.cleanupMediaRecord(rec);

      this.emit({
        type: "stop",
        filePath: file.path,
        id,
        reason: "ended",
      });
    };
    rec.endedHandler = endedHandler;
    element.addEventListener("ended", endedHandler);

    await element.play();

    this.emit({ type: "start", filePath: file.path, id });

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
      // Large files are streamed via <audio>, so decoding them here would defeat the purpose.
      if (this.isLargeFile(f)) continue;

      try {
        await this.loadBuffer(f);
      } catch (err) {
        console.error("TTRPG Soundboard: preload failed", f.path, err);
      }
    }
  }

  /**
   * Pause all currently playing instances of the given file.
   * If fadeOutMs > 0, a short fade-out is applied before pausing.
   */
  async pauseByFile(file: TFile, fadeOutMs = 0) {
    if (!this.ctx) return;
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path && p.state === "playing",
    );
    if (!targets.length) return;

    const ctx = this.ctx;
    const fadeSec = (fadeOutMs ?? 0) / 1000;

    await Promise.all(
      targets.map(
        (rec) =>
          new Promise<void>((resolve) => {
            if (!ctx) {
              this.pauseRecord(rec);
              this.emit({
                type: "pause",
                filePath: rec.file.path,
                id: rec.id,
              });
              resolve();
              return;
            }

            if (fadeSec > 0) {
              const n = ctx.currentTime;
              const cur = rec.gain.gain.value;
              rec.lastVolume = cur > 0 ? cur : rec.lastVolume || 1;

              rec.gain.gain.cancelScheduledValues(n);
              rec.gain.gain.setValueAtTime(cur, n);
              rec.gain.gain.linearRampToValueAtTime(0, n + fadeSec);

              window.setTimeout(() => {
                this.pauseRecord(rec);
                this.emit({
                  type: "pause",
                  filePath: rec.file.path,
                  id: rec.id,
                });
                resolve();
              }, Math.max(1, fadeOutMs));
            } else {
              this.pauseRecord(rec);
              this.emit({
                type: "pause",
                filePath: rec.file.path,
                id: rec.id,
              });
              resolve();
            }
          }),
      ),
    );
  }

  /**
   * Resume all paused instances of the given file.
   * If fadeInMs > 0, a short fade-in is applied from volume 0.
   */
  async resumeByFile(file: TFile, fadeInMs = 0) {
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path && p.state === "paused",
    );
    if (!targets.length) return;

    await this.ensureContext();
    const ctx = this.ctx!;
    const fadeSec = (fadeInMs ?? 0) / 1000;

    for (const rec of targets) {
      const now = ctx.currentTime;
      const target =
        rec.lastVolume && rec.lastVolume > 0 ? rec.lastVolume : 1;

      if (fadeSec > 0) {
        rec.gain.gain.cancelScheduledValues(now);
        rec.gain.gain.setValueAtTime(0, now);
        rec.gain.gain.linearRampToValueAtTime(target, now + fadeSec);
      } else {
        rec.gain.gain.cancelScheduledValues(now);
        rec.gain.gain.setValueAtTime(target, now);
      }
      rec.lastVolume = target;

      this.resumeRecord(rec);
      this.emit({
        type: "resume",
        filePath: rec.file.path,
        id: rec.id,
      });
    }
  }

  /**
   * Set the volume (0..1) for all active instances of a given file path.
   * This does not touch the global master gain.
   */
  setVolumeForPath(path: string, volume: number) {
    if (!this.ctx) return;
    const v = Math.max(0, Math.min(1, volume));
    const now = this.ctx.currentTime;

    for (const rec of this.playing.values()) {
      if (rec.file.path === path) {
        rec.gain.gain.cancelScheduledValues(now);
        rec.gain.gain.setValueAtTime(v, now);
        rec.lastVolume = v;
      }
    }
  }

  /**
   * Returns a unique list of file paths that have at least one
   * active playback record (playing or paused).
   */
  getPlayingFilePaths(): string[] {
    const set = new Set<string>();
    for (const v of this.playing.values()) set.add(v.file.path);
    return [...set];
  }

  /**
   * Summarised playback state for a given file path:
   * - "none"    = no active sessions
   * - "playing" = at least one playing, none paused
   * - "paused"  = at least one paused, none playing
   * - "mixed"   = both playing and paused sessions exist
   */
  getPathPlaybackState(path: string): PathPlaybackState {
    let hasPlaying = false;
    let hasPaused = false;

    for (const rec of this.playing.values()) {
      if (rec.file.path !== path) continue;
      if (rec.state === "playing") hasPlaying = true;
      else if (rec.state === "paused") hasPaused = true;
    }

    if (!hasPlaying && !hasPaused) return "none";
    if (hasPlaying && !hasPaused) return "playing";
    if (!hasPlaying && hasPaused) return "paused";
    return "mixed";
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

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private stopById(id: string, sOpts?: StopOptions): Promise<void> {
    const rec = this.playing.get(id);
    if (!rec) return Promise.resolve();

    this.playing.delete(id);

    const ctx = this.ctx;
    const fadeOutMs = sOpts?.fadeOutMs ?? 0;
    const fadeOut = fadeOutMs / 1000;
    const filePath = rec.file.path;

    if (!ctx) {
      this.cleanupRecord(rec);
      this.emit({
        type: "stop",
        filePath,
        id,
        reason: "stopped",
      });
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const n = ctx.currentTime;

      if (fadeOut > 0) {
        rec.gain.gain.cancelScheduledValues(n);
        const cur = rec.gain.gain.value;
        rec.gain.gain.setValueAtTime(cur, n);
        rec.gain.gain.linearRampToValueAtTime(0, n + fadeOut);

        window.setTimeout(() => {
          this.cleanupRecord(rec);
          this.emit({
            type: "stop",
            filePath,
            id,
            reason: "stopped",
          });
          resolve();
        }, Math.max(1, fadeOutMs));
      } else {
        this.cleanupRecord(rec);
        this.emit({
          type: "stop",
          filePath,
          id,
          reason: "stopped",
        });
        resolve();
      }
    });
  }

  private cleanupRecord(rec: PlaybackRecord) {
    if (rec.kind === "buffer") {
      try {
        rec.source?.stop();
      } catch {
        // Ignore errors when stopping an already-stopped source
      }
      rec.source = null;
      return;
    }

    if (rec.kind === "media") {
      this.cleanupMediaRecord(rec);
    }
  }

  private cleanupMediaRecord(rec: MediaPlaybackRecord) {
    try {
      if (rec.endedHandler) {
        rec.element.removeEventListener("ended", rec.endedHandler);
      }
    } catch {
      // ignore
    }
    rec.endedHandler = null;

    try {
      rec.element.pause();
    } catch {
      // ignore
    }

    try {
      rec.node.disconnect();
    } catch {
      // ignore
    }

    try {
      rec.gain.disconnect();
    } catch {
      // ignore
    }

    try {
      rec.element.removeAttribute("src");
      rec.element.load();
    } catch {
      // ignore
    }
  }

  private pauseRecord(rec: PlaybackRecord) {
    if (!this.ctx) return;
    if (rec.state !== "playing") return;

    if (rec.kind === "buffer") {
      if (!rec.source) return;

      const ctx = this.ctx;
      const elapsed = Math.max(0, ctx.currentTime - rec.startTime);
      const newOffset = rec.offset + elapsed;

      rec.offset = Math.max(0, Math.min(rec.buffer.duration, newOffset));
      rec.state = "paused";

      try {
        rec.source.stop();
      } catch {
        // Ignore errors if already stopped
      }
      rec.source = null;
      return;
    }

    if (rec.kind === "media") {
      try {
        rec.element.pause();
      } catch {
        // ignore
      }
      rec.state = "paused";
    }
  }

  private resumeRecord(rec: PlaybackRecord) {
    if (!this.ctx) return;
    if (rec.state !== "paused") return;

    if (rec.kind === "buffer") {
      const ctx = this.ctx;
      const buffer = rec.buffer;
      if (!buffer) return;

      // Clamp offset near the end of the buffer
      const maxOffset = Math.max(0, buffer.duration - 0.001);
      const offset = Math.max(0, Math.min(rec.offset, maxOffset));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = rec.loop;

      const gain = rec.gain;
      source.connect(gain);

      const id = rec.id;

      source.onended = () => {
        const existing = this.playing.get(id);
        if (!existing) return;
        if (existing.state !== "playing") return;

        this.playing.delete(id);
        this.emit({
          type: "stop",
          filePath: existing.file.path,
          id,
          reason: "ended",
        });
      };

      rec.source = source;
      rec.state = "playing";
      rec.startTime = ctx.currentTime;

      source.start(0, offset);
      return;
    }

    if (rec.kind === "media") {
      rec.state = "playing";
      try {
        void rec.element.play();
      } catch {
        // ignore
      }
    }
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