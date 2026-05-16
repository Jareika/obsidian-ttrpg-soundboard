import { App, TFile } from "obsidian";

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  fadeInMs?: number;
  loopEndTrimSeconds?: number;
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
  file: TFile;
  loop: boolean;
  state: "playing" | "paused";
  lastVolume: number; // target per-track volume before global master volume
}

interface GainPlaybackRecordBase extends PlaybackRecordBase {
  gain: GainNode;
}

interface BufferPlaybackRecord extends GainPlaybackRecordBase {
  kind: "buffer";
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
  startTime: number; // AudioContext time when the current segment started
  offset: number; // seconds already played before startTime (for resume)
  loopEndTrimSeconds: number;
}

interface MediaPlaybackRecord extends GainPlaybackRecordBase {
  kind: "media";
  element: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  endedHandler: (() => void) | null;
}

interface DirectMediaPlaybackRecord extends PlaybackRecordBase {
  kind: "media-direct";
  element: HTMLAudioElement;
  endedHandler: (() => void) | null;
  timeUpdateHandler: (() => void) | null;
  fadeTimer: number | null;
  loopEndTrimSeconds: number;
}

type PlaybackRecord = BufferPlaybackRecord | MediaPlaybackRecord | DirectMediaPlaybackRecord;

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
  private iosLockscreenCompatibilityMode = false;

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
        // Ignore listener errors so one bad listener does not break others.
      }
    });
  }

  // ===== Master volume / cache config =====

  setMasterVolume(v: number) {
    this.masterVolume = this.clamp01(v);

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }

    for (const rec of this.playing.values()) {
      if (rec.kind === "media-direct") {
        this.applyDirectElementVolume(rec, rec.lastVolume);
      }
    }
  }

  /**
   * Force direct HTMLAudioElement playback without routing through AudioContext.
   * This is intended as a compatibility mode for platforms where lock-screen
   * playback is more reliable without Web Audio.
   */
  setIOSLockscreenCompatibilityMode(enabled: boolean) {
    this.iosLockscreenCompatibilityMode = !!enabled;
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
   * Configure at which file size (in MB) playback switches to HTMLAudioElement.
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
      // The callback form is used here to keep compatibility simple.
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
    if (this.iosLockscreenCompatibilityMode) {
      return await this.playWithDirectMediaElement(file, opts);
    }

    const needsPreciseLoop =
      !!opts.loop && typeof opts.loopEndTrimSeconds === "number" && opts.loopEndTrimSeconds > 0;

    if (needsPreciseLoop) {
      return await this.playWithBuffer(file, opts);
    }

    if (this.isLargeFile(file)) {
      try {
        return await this.playWithMediaElement(file, opts);
      } catch {
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

    const trim =
      typeof opts.loopEndTrimSeconds === "number"
        ? Math.max(0, opts.loopEndTrimSeconds)
        : 0;

    if (loop && trim > 0) {
      source.loopStart = 0;
      const loopEnd = Math.max(0.001, buffer.duration - trim);
      source.loopEnd = Math.max(source.loopStart + 0.001, loopEnd);
    }

    gain.connect(this.masterGain!);
    source.connect(gain);

    const now = ctx.currentTime;
    const targetVol = this.clamp01(opts.volume ?? 1);
    const fadeIn = Math.max(0, opts.fadeInMs ?? 0) / 1000;

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
      loopEndTrimSeconds: trim,
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

    const element = window.activeDocument.createElement("audio");
    element.preload = "auto";
    element.src = this.app.vault.getResourcePath(file);
    element.loop = !!opts.loop;

    const node = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;

    node.connect(gain);
    gain.connect(this.masterGain!);

    const now = ctx.currentTime;
    const targetVol = this.clamp01(opts.volume ?? 1);
    const fadeIn = Math.max(0, opts.fadeInMs ?? 0) / 1000;

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

    try {
      await element.play();
    } catch (err) {
      this.playing.delete(id);
      this.cleanupMediaRecord(rec);
      throw err;
    }

    this.emit({ type: "start", filePath: file.path, id });

    return {
      id,
      stop: (sOpts?: StopOptions) => this.stopById(id, sOpts),
    };
  }

  private async playWithDirectMediaElement(file: TFile, opts: PlayOptions = {}) {
    const id = this.createId();
    const element = window.activeDocument.createElement("audio");
    element.preload = "auto";
    element.src = this.app.vault.getResourcePath(file);

    const loop = !!opts.loop;
    const trim =
      typeof opts.loopEndTrimSeconds === "number"
        ? Math.max(0, opts.loopEndTrimSeconds)
        : 0;

    // Native loop works only when no loop-end trim is required.
    element.loop = loop && trim <= 0;

    const targetVol = this.clamp01(opts.volume ?? 1);
    const fadeInMs = Math.max(0, opts.fadeInMs ?? 0);

    const rec: DirectMediaPlaybackRecord = {
      kind: "media-direct",
      id,
      element,
      file,
      loop,
      state: "playing",
      lastVolume: targetVol,
      endedHandler: null,
      timeUpdateHandler: null,
      fadeTimer: null,
      loopEndTrimSeconds: trim,
    };

    element.volume = fadeInMs > 0 ? 0 : this.toAppliedDirectVolume(targetVol);
    this.playing.set(id, rec);

    const endedHandler = () => {
      const existing = this.playing.get(id);
      if (!existing || existing.kind !== "media-direct") return;
      if (existing.state !== "playing") return;

      // Fallback loop restart when native loop is not used because of trim.
      if (existing.loop && existing.loopEndTrimSeconds > 0) {
        try {
          existing.element.currentTime = 0;
          void existing.element.play();
          return;
        } catch {
          // Fall through to normal stop handling.
        }
      }

      this.playing.delete(id);
      this.cleanupDirectMediaRecord(existing);

      this.emit({
        type: "stop",
        filePath: file.path,
        id,
        reason: "ended",
      });
    };
    rec.endedHandler = endedHandler;
    element.addEventListener("ended", endedHandler);

    if (loop && trim > 0) {
      const timeUpdateHandler = () => {
        if (rec.state !== "playing") return;

        const dur = rec.element.duration;
        if (!Number.isFinite(dur) || dur <= trim || trim <= 0) return;

        const restartAt = dur - trim;
        if (rec.element.currentTime >= restartAt) {
          try {
            rec.element.currentTime = 0;
            if (rec.element.paused) {
              void rec.element.play();
            }
          } catch {
            // Ignore seek/play failures here and let ended handling deal with it.
          }
        }
      };

      rec.timeUpdateHandler = timeUpdateHandler;
      element.addEventListener("timeupdate", timeUpdateHandler);
    }

    try {
      await element.play();
    } catch (err) {
      this.playing.delete(id);
      this.cleanupDirectMediaRecord(rec);
      throw err;
    }

    if (fadeInMs > 0) {
      this.animateDirectRecordToRaw(rec, targetVol, fadeInMs);
    }

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
    if (this.iosLockscreenCompatibilityMode) {
      return;
    }

    for (const f of files) {
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
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path && p.state === "playing",
    );
    if (!targets.length) return;

    const fadeMs = Math.max(0, fadeOutMs);

    await Promise.all(
      targets.map(
        (rec) =>
          new Promise<void>((resolve) => {
            if (rec.kind === "media-direct") {
              if (fadeMs > 0) {
                this.animateDirectRecordToRaw(rec, 0, fadeMs, () => {
                  this.pauseRecord(rec);
                  this.emit({
                    type: "pause",
                    filePath: rec.file.path,
                    id: rec.id,
                  });
                  resolve();
                });
              } else {
                this.pauseRecord(rec);
                this.emit({
                  type: "pause",
                  filePath: rec.file.path,
                  id: rec.id,
                });
                resolve();
              }
              return;
            }

            if (!this.ctx) {
              this.pauseRecord(rec);
              this.emit({
                type: "pause",
                filePath: rec.file.path,
                id: rec.id,
              });
              resolve();
              return;
            }

            const fadeSec = fadeMs / 1000;

            if (fadeSec > 0) {
              const n = this.ctx.currentTime;
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
              }, Math.max(1, fadeMs));
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

    const fadeMs = Math.max(0, fadeInMs);

    for (const rec of targets) {
      const target =
        rec.lastVolume && rec.lastVolume > 0 ? rec.lastVolume : 1;

      if (rec.kind === "media-direct") {
        this.resumeRecord(rec);

        if (fadeMs > 0) {
          rec.element.volume = 0;
          this.animateDirectRecordToRaw(rec, target, fadeMs);
        } else {
          this.applyDirectElementVolume(rec, target);
        }

        this.emit({
          type: "resume",
          filePath: rec.file.path,
          id: rec.id,
        });
        continue;
      }

      await this.ensureContext();
      const ctx = this.ctx!;
      const fadeSec = fadeMs / 1000;
      const now = ctx.currentTime;

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
    const v = this.clamp01(volume);

    for (const rec of this.playing.values()) {
      if (rec.file.path !== path) continue;

      if (rec.kind === "media-direct") {
        this.setDirectRecordTargetVolume(rec, v);
        continue;
      }

      if (!this.ctx) continue;
      const now = this.ctx.currentTime;
      rec.gain.gain.cancelScheduledValues(now);
      rec.gain.gain.setValueAtTime(v, now);
      rec.lastVolume = v;
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
   * Called when the plugin unloads.
   */
  shutdown() {
    for (const rec of this.playing.values()) {
      this.cleanupRecord(rec);
    }
    this.playing.clear();

    try {
      void this.ctx?.close();
    } catch {
      // Ignore errors while closing the context.
    }
    this.ctx = null;
    this.masterGain = null;
    this.clearBufferCache();
  }

  // ===== Internal helpers =====

  private clamp01(v: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private toAppliedDirectVolume(rawVolume: number): number {
    return this.clamp01(this.clamp01(rawVolume) * this.masterVolume);
  }

  private applyDirectElementVolume(rec: DirectMediaPlaybackRecord, rawVolume: number) {
    rec.element.volume = this.toAppliedDirectVolume(rawVolume);
  }

  private setDirectRecordTargetVolume(rec: DirectMediaPlaybackRecord, rawVolume: number) {
    rec.lastVolume = this.clamp01(rawVolume);
    this.applyDirectElementVolume(rec, rec.lastVolume);
  }

  private cancelDirectFade(rec: DirectMediaPlaybackRecord) {
    if (rec.fadeTimer != null) {
      window.clearInterval(rec.fadeTimer);
      rec.fadeTimer = null;
    }
  }

  private animateDirectRecordToRaw(
    rec: DirectMediaPlaybackRecord,
    targetRawVolume: number,
    durationMs: number,
    done?: () => void,
  ) {
    this.cancelDirectFade(rec);

    const totalMs = Math.max(0, durationMs);
    if (totalMs <= 0) {
      rec.element.volume = this.toAppliedDirectVolume(targetRawVolume);
      done?.();
      return;
    }

    const startApplied = this.clamp01(rec.element.volume);
    const startedAt = window.performance.now();

    const step = () => {
	  const elapsed = window.performance.now() - startedAt;
      const t = Math.min(1, elapsed / totalMs);
      const targetApplied = this.toAppliedDirectVolume(targetRawVolume);
      const next = startApplied + (targetApplied - startApplied) * t;
      rec.element.volume = this.clamp01(next);

      if (t >= 1) {
        this.cancelDirectFade(rec);
        done?.();
      }
    };

    step();
    rec.fadeTimer = window.setInterval(step, 33);
  }

  private stopById(id: string, sOpts?: StopOptions): Promise<void> {
    const rec = this.playing.get(id);
    if (!rec) return Promise.resolve();

    this.playing.delete(id);

    const fadeOutMs = Math.max(0, sOpts?.fadeOutMs ?? 0);
    const filePath = rec.file.path;

    if (rec.kind === "media-direct") {
      return new Promise<void>((resolve) => {
        if (fadeOutMs > 0) {
          this.animateDirectRecordToRaw(rec, 0, fadeOutMs, () => {
            this.cleanupRecord(rec);
            this.emit({
              type: "stop",
              filePath,
              id,
              reason: "stopped",
            });
            resolve();
          });
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

    const ctx = this.ctx;
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

    const fadeOut = fadeOutMs / 1000;

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
        // Ignore errors when stopping an already-stopped source.
      }
      rec.source = null;
      try {
        rec.gain.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
      return;
    }

    if (rec.kind === "media") {
      this.cleanupMediaRecord(rec);
      return;
    }

    this.cleanupDirectMediaRecord(rec);
  }

  private cleanupMediaRecord(rec: MediaPlaybackRecord) {
    try {
      if (rec.endedHandler) {
        rec.element.removeEventListener("ended", rec.endedHandler);
      }
    } catch {
      // Ignore listener cleanup errors.
    }
    rec.endedHandler = null;

    try {
      rec.element.pause();
    } catch {
      // Ignore pause errors.
    }

    try {
      rec.node.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    try {
      rec.gain.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    try {
      rec.element.removeAttribute("src");
      rec.element.load();
    } catch {
      // Ignore reset errors.
    }
  }

  private cleanupDirectMediaRecord(rec: DirectMediaPlaybackRecord) {
    this.cancelDirectFade(rec);

    try {
      if (rec.endedHandler) {
        rec.element.removeEventListener("ended", rec.endedHandler);
      }
    } catch {
      // Ignore listener cleanup errors.
    }
    rec.endedHandler = null;

    try {
      if (rec.timeUpdateHandler) {
        rec.element.removeEventListener("timeupdate", rec.timeUpdateHandler);
      }
    } catch {
      // Ignore listener cleanup errors.
    }
    rec.timeUpdateHandler = null;

    try {
      rec.element.pause();
    } catch {
      // Ignore pause errors.
    }

    try {
      rec.element.removeAttribute("src");
      rec.element.load();
    } catch {
      // Ignore reset errors.
    }
  }

  private pauseRecord(rec: PlaybackRecord) {
    if (rec.state !== "playing") return;

    if (rec.kind === "buffer") {
      if (!this.ctx || !rec.source) return;

      const elapsed = Math.max(0, this.ctx.currentTime - rec.startTime);
      const newOffset = rec.offset + elapsed;

      rec.offset = Math.max(0, Math.min(rec.buffer.duration, newOffset));
      rec.state = "paused";

      try {
        rec.source.stop();
      } catch {
        // Ignore errors if already stopped.
      }
      rec.source = null;
      return;
    }

    if (rec.kind === "media") {
      try {
        rec.element.pause();
      } catch {
        // Ignore pause errors.
      }
      rec.state = "paused";
      return;
    }

    this.cancelDirectFade(rec);
    try {
      rec.element.pause();
    } catch {
      // Ignore pause errors.
    }
    rec.state = "paused";
  }

  private resumeRecord(rec: PlaybackRecord) {
    if (rec.state !== "paused") return;

    if (rec.kind === "buffer") {
      if (!this.ctx) return;

      const buffer = rec.buffer;
      const maxOffset = Math.max(0, buffer.duration - 0.001);
      const offset = Math.max(0, Math.min(rec.offset, maxOffset));

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = rec.loop;

      if (rec.loop && rec.loopEndTrimSeconds > 0) {
        source.loopStart = 0;
        const loopEnd = Math.max(0.001, buffer.duration - rec.loopEndTrimSeconds);
        source.loopEnd = Math.max(source.loopStart + 0.001, loopEnd);
      }

      source.connect(rec.gain);

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
      rec.startTime = this.ctx.currentTime;

      source.start(0, offset);
      return;
    }

    if (rec.kind === "media") {
      rec.state = "playing";
      try {
        void rec.element.play();
      } catch {
        // Ignore play errors.
      }
      return;
    }

    rec.state = "playing";
    try {
      void rec.element.play();
    } catch {
      // Ignore play errors.
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