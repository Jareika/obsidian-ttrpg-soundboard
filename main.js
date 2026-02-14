"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TTRPGSoundboardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian9 = require("obsidian");

// audio/AudioEngine.ts
var AudioEngine = class {
  constructor(app) {
    this.ctx = null;
    this.masterGain = null;
    // Small cache of decoded AudioBuffers, with a configurable upper limit in MB.
    this.buffers = /* @__PURE__ */ new Map();
    this.bufferUsage = /* @__PURE__ */ new Map();
    // path -> approximate bytes
    this.totalBufferedBytes = 0;
    this.maxCachedBytes = 512 * 1024 * 1024;
    // default 512 MB
    this.mediaElementThresholdBytes = 25 * 1024 * 1024;
    this.playing = /* @__PURE__ */ new Map();
    this.masterVolume = 1;
    this.listeners = /* @__PURE__ */ new Set();
    this.app = app;
  }
  // ===== Event subscription =====
  on(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(e) {
    this.listeners.forEach((fn) => {
      try {
        void fn(e);
      } catch (e2) {
      }
    });
  }
  // ===== Master volume / cache config =====
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.masterVolume,
        this.ctx.currentTime
      );
    }
  }
  /**
   * Configure the upper limit of the decoded-audio cache in megabytes.
   * 0 = disable caching completely (always decode from file, minimal RAM).
   */
  setCacheLimitMB(mb) {
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
  setMediaElementThresholdMB(mb) {
    const clamped = Math.max(0, Number.isFinite(mb) ? mb : 0);
    this.mediaElementThresholdBytes = Math.round(clamped * 1024 * 1024);
  }
  // ===== Audio context / buffer loading =====
  async ensureContext() {
    var _a;
    if (!this.ctx) {
      const w = window;
      const Ctx = (_a = window.AudioContext) != null ? _a : w.webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio API not available");
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (e) {
      }
    }
  }
  isLargeFile(file) {
    var _a, _b;
    if (this.mediaElementThresholdBytes <= 0) return false;
    const size = (_b = (_a = file.stat) == null ? void 0 : _a.size) != null ? _b : 0;
    return size > this.mediaElementThresholdBytes;
  }
  async loadBuffer(file) {
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
    const ctx = this.ctx;
    const arrBuf = bin instanceof ArrayBuffer ? bin : new Uint8Array(bin).buffer;
    const audioBuffer = await new Promise((resolve, reject) => {
      void ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
    });
    if (this.maxCachedBytes > 0) {
      const approxBytes = audioBuffer.length * audioBuffer.numberOfChannels * 4;
      this.buffers.set(key, audioBuffer);
      this.bufferUsage.set(key, approxBytes);
      this.totalBufferedBytes += approxBytes;
      this.touchBufferKey(key);
      this.enforceCacheLimit();
    }
    return audioBuffer;
  }
  // ===== Playback control =====
  async play(file, opts = {}) {
    const needsPreciseLoop = !!opts.loop && typeof opts.loopEndTrimSeconds === "number" && opts.loopEndTrimSeconds > 0;
    if (needsPreciseLoop) {
      return await this.playWithBuffer(file, opts);
    }
    if (this.isLargeFile(file)) {
      try {
        return await this.playWithMediaElement(file, opts);
      } catch (e) {
        return await this.playWithBuffer(file, opts);
      }
    }
    return await this.playWithBuffer(file, opts);
  }
  async playWithBuffer(file, opts = {}) {
    var _a, _b;
    await this.ensureContext();
    const buffer = await this.loadBuffer(file);
    const ctx = this.ctx;
    const id = this.createId();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const loop = !!opts.loop;
    source.loop = loop;
    const trim = typeof opts.loopEndTrimSeconds === "number" ? Math.max(0, opts.loopEndTrimSeconds) : 0;
    if (loop && trim > 0) {
      source.loopStart = 0;
      const loopEnd = Math.max(1e-3, buffer.duration - trim);
      source.loopEnd = Math.max(source.loopStart + 1e-3, loopEnd);
    }
    gain.connect(this.masterGain);
    source.connect(gain);
    const now = ctx.currentTime;
    const targetVol = Math.max(0, Math.min(1, (_a = opts.volume) != null ? _a : 1));
    const fadeIn = ((_b = opts.fadeInMs) != null ? _b : 0) / 1e3;
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetVol, now + fadeIn);
    } else {
      gain.gain.setValueAtTime(targetVol, now);
    }
    const rec = {
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
      lastVolume: targetVol
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
        reason: "ended"
      });
    };
    source.start();
    this.emit({ type: "start", filePath: file.path, id });
    return {
      id,
      stop: (sOpts) => this.stopById(id, sOpts)
    };
  }
  async playWithMediaElement(file, opts = {}) {
    var _a, _b;
    await this.ensureContext();
    const ctx = this.ctx;
    const id = this.createId();
    const element = document.createElement("audio");
    element.preload = "auto";
    element.src = this.app.vault.getResourcePath(file);
    element.loop = !!opts.loop;
    const node = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.masterGain);
    const now = ctx.currentTime;
    const targetVol = Math.max(0, Math.min(1, (_a = opts.volume) != null ? _a : 1));
    const fadeIn = ((_b = opts.fadeInMs) != null ? _b : 0) / 1e3;
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetVol, now + fadeIn);
    } else {
      gain.gain.setValueAtTime(targetVol, now);
    }
    const rec = {
      kind: "media",
      id,
      element,
      node,
      gain,
      file,
      loop: !!opts.loop,
      state: "playing",
      lastVolume: targetVol,
      endedHandler: null
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
        reason: "ended"
      });
    };
    rec.endedHandler = endedHandler;
    element.addEventListener("ended", endedHandler);
    await element.play();
    this.emit({ type: "start", filePath: file.path, id });
    return {
      id,
      stop: (sOpts) => this.stopById(id, sOpts)
    };
  }
  async stopByFile(file, fadeOutMs = 0) {
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path
    );
    await Promise.all(
      targets.map((t) => this.stopById(t.id, { fadeOutMs }))
    );
  }
  async stopAll(fadeOutMs = 0) {
    const ids = [...this.playing.keys()];
    await Promise.all(ids.map((id) => this.stopById(id, { fadeOutMs })));
  }
  async preload(files) {
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
  async pauseByFile(file, fadeOutMs = 0) {
    if (!this.ctx) return;
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path && p.state === "playing"
    );
    if (!targets.length) return;
    const ctx = this.ctx;
    const fadeSec = (fadeOutMs != null ? fadeOutMs : 0) / 1e3;
    await Promise.all(
      targets.map(
        (rec) => new Promise((resolve) => {
          if (!ctx) {
            this.pauseRecord(rec);
            this.emit({
              type: "pause",
              filePath: rec.file.path,
              id: rec.id
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
                id: rec.id
              });
              resolve();
            }, Math.max(1, fadeOutMs));
          } else {
            this.pauseRecord(rec);
            this.emit({
              type: "pause",
              filePath: rec.file.path,
              id: rec.id
            });
            resolve();
          }
        })
      )
    );
  }
  /**
   * Resume all paused instances of the given file.
   * If fadeInMs > 0, a short fade-in is applied from volume 0.
   */
  async resumeByFile(file, fadeInMs = 0) {
    const targets = [...this.playing.values()].filter(
      (p) => p.file.path === file.path && p.state === "paused"
    );
    if (!targets.length) return;
    await this.ensureContext();
    const ctx = this.ctx;
    const fadeSec = (fadeInMs != null ? fadeInMs : 0) / 1e3;
    for (const rec of targets) {
      const now = ctx.currentTime;
      const target = rec.lastVolume && rec.lastVolume > 0 ? rec.lastVolume : 1;
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
        id: rec.id
      });
    }
  }
  /**
   * Set the volume (0..1) for all active instances of a given file path.
   * This does not touch the global master gain.
   */
  setVolumeForPath(path, volume) {
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
  getPlayingFilePaths() {
    const set = /* @__PURE__ */ new Set();
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
  getPathPlaybackState(path) {
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
    var _a;
    try {
      void ((_a = this.ctx) == null ? void 0 : _a.close());
    } catch (e) {
    }
    this.ctx = null;
    this.masterGain = null;
    this.clearBufferCache();
    this.playing.clear();
  }
  // ===== Internal helpers =====
  createId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  stopById(id, sOpts) {
    var _a;
    const rec = this.playing.get(id);
    if (!rec) return Promise.resolve();
    this.playing.delete(id);
    const ctx = this.ctx;
    const fadeOutMs = (_a = sOpts == null ? void 0 : sOpts.fadeOutMs) != null ? _a : 0;
    const fadeOut = fadeOutMs / 1e3;
    const filePath = rec.file.path;
    if (!ctx) {
      this.cleanupRecord(rec);
      this.emit({
        type: "stop",
        filePath,
        id,
        reason: "stopped"
      });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
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
            reason: "stopped"
          });
          resolve();
        }, Math.max(1, fadeOutMs));
      } else {
        this.cleanupRecord(rec);
        this.emit({
          type: "stop",
          filePath,
          id,
          reason: "stopped"
        });
        resolve();
      }
    });
  }
  cleanupRecord(rec) {
    var _a;
    if (rec.kind === "buffer") {
      try {
        (_a = rec.source) == null ? void 0 : _a.stop();
      } catch (e) {
      }
      rec.source = null;
      return;
    }
    if (rec.kind === "media") {
      this.cleanupMediaRecord(rec);
    }
  }
  cleanupMediaRecord(rec) {
    try {
      if (rec.endedHandler) {
        rec.element.removeEventListener("ended", rec.endedHandler);
      }
    } catch (e) {
    }
    rec.endedHandler = null;
    try {
      rec.element.pause();
    } catch (e) {
    }
    try {
      rec.node.disconnect();
    } catch (e) {
    }
    try {
      rec.gain.disconnect();
    } catch (e) {
    }
    try {
      rec.element.removeAttribute("src");
      rec.element.load();
    } catch (e) {
    }
  }
  pauseRecord(rec) {
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
      } catch (e) {
      }
      rec.source = null;
      return;
    }
    if (rec.kind === "media") {
      try {
        rec.element.pause();
      } catch (e) {
      }
      rec.state = "paused";
    }
  }
  resumeRecord(rec) {
    if (!this.ctx) return;
    if (rec.state !== "paused") return;
    if (rec.kind === "buffer") {
      const ctx = this.ctx;
      const buffer = rec.buffer;
      if (!buffer) return;
      const maxOffset = Math.max(0, buffer.duration - 1e-3);
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
          reason: "ended"
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
      } catch (e) {
      }
    }
  }
  touchBufferKey(key) {
    var _a;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const size = (_a = this.bufferUsage.get(key)) != null ? _a : 0;
    this.buffers.delete(key);
    this.bufferUsage.delete(key);
    this.buffers.set(key, buf);
    this.bufferUsage.set(key, size);
  }
  enforceCacheLimit() {
    var _a;
    if (this.maxCachedBytes <= 0) {
      this.clearBufferCache();
      return;
    }
    if (this.totalBufferedBytes <= this.maxCachedBytes) return;
    for (const key of this.buffers.keys()) {
      if (this.totalBufferedBytes <= this.maxCachedBytes) break;
      const size = (_a = this.bufferUsage.get(key)) != null ? _a : 0;
      this.buffers.delete(key);
      this.bufferUsage.delete(key);
      this.totalBufferedBytes -= size;
    }
    if (this.totalBufferedBytes < 0) this.totalBufferedBytes = 0;
  }
};

// ui/SoundboardView.ts
var import_obsidian3 = require("obsidian");

// ui/PerSoundSettingsModal.ts
var import_obsidian = require("obsidian");
var PerSoundSettingsModal = class extends import_obsidian.Modal {
  constructor(app, plugin, filePath) {
    super(app);
    this.plugin = plugin;
    this.filePath = filePath;
    this.titleEl.setText("Sound settings");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const pref = this.plugin.getSoundPref(this.filePath);
    const defaultLoop = this.plugin.getDefaultLoopForPath(this.filePath);
    const isAmbience = this.plugin.isAmbiencePath(this.filePath);
    let fadeInStr = typeof pref.fadeInMs === "number" ? String(pref.fadeInMs) : "";
    let fadeOutStr = typeof pref.fadeOutMs === "number" ? String(pref.fadeOutMs) : "";
    let vol = typeof pref.volume === "number" ? pref.volume : 1;
    const originalVol = vol;
    let loop = typeof pref.loop === "boolean" ? pref.loop : defaultLoop;
    let crossfadeStr = typeof pref.crossfadeMs === "number" ? String(pref.crossfadeMs) : "";
    new import_obsidian.Setting(contentEl).setName("Fade in (ms)").setDesc("Leave empty to use the global default.").addText(
      (ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeInMs)).setValue(fadeInStr).onChange((v) => {
        fadeInStr = v;
      })
    );
    new import_obsidian.Setting(contentEl).setName("Fade out (ms)").setDesc("Leave empty to use the global default.").addText(
      (ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeOutMs)).setValue(fadeOutStr).onChange((v) => {
        fadeOutStr = v;
      })
    );
    new import_obsidian.Setting(contentEl).setName("Volume").setDesc("0\u20131, multiplied by the master volume.").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(vol).onChange((v) => {
        vol = v;
        this.plugin.applyEffectiveVolumeForSingle(this.filePath, vol);
      })
    );
    new import_obsidian.Setting(contentEl).setName("Loop by default").addToggle(
      (tg) => tg.setValue(loop).onChange((v) => {
        loop = v;
      })
    );
    if (isAmbience) {
      new import_obsidian.Setting(contentEl).setName("Crossfade (ms)").setDesc("When looping, restart earlier by this amount to skip silence at the end. Leave empty for default.").addText(
        (ti) => ti.setPlaceholder("E.g. 1500").setValue(crossfadeStr).onChange((v) => {
          crossfadeStr = v;
        })
      );
    }
    new import_obsidian.Setting(contentEl).setName("Insert note button").setDesc("Insert a Markdown button for this sound into the active note.").addButton(
      (b) => b.setButtonText("Insert button").onClick(() => {
        this.plugin.insertSoundButtonIntoActiveNote(this.filePath);
      })
    );
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Restore defaults").onClick(async () => {
        delete pref.fadeInMs;
        delete pref.fadeOutMs;
        delete pref.volume;
        delete pref.loop;
        delete pref.crossfadeMs;
        this.plugin.setSoundPref(this.filePath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.plugin.applyEffectiveVolumeForSingle(this.filePath, 1);
        this.close();
      })
    ).addButton(
      (b) => b.setCta().setButtonText("Save").onClick(async () => {
        const fi = fadeInStr.trim() === "" ? void 0 : Number(fadeInStr);
        const fo = fadeOutStr.trim() === "" ? void 0 : Number(fadeOutStr);
        const cf = crossfadeStr.trim() === "" ? void 0 : Number(crossfadeStr);
        if (fi != null && Number.isNaN(fi)) return;
        if (fo != null && Number.isNaN(fo)) return;
        if (cf != null && Number.isNaN(cf)) return;
        pref.fadeInMs = fi;
        pref.fadeOutMs = fo;
        pref.volume = vol;
        if (loop === defaultLoop) {
          delete pref.loop;
        } else {
          pref.loop = loop;
        }
        if (isAmbience) {
          if (cf == null || cf <= 0) delete pref.crossfadeMs;
          else pref.crossfadeMs = cf;
        }
        this.plugin.setSoundPref(this.filePath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton(
      (b) => b.setButtonText("Cancel").onClick(() => {
        this.plugin.applyEffectiveVolumeForSingle(this.filePath, originalVol);
        this.close();
      })
    );
  }
};

// ui/PlaylistSettingsModal.ts
var import_obsidian2 = require("obsidian");
var PlaylistSettingsModal = class extends import_obsidian2.Modal {
  constructor(app, plugin, folderPath) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
    this.titleEl.setText("Playlist settings");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const pref = this.plugin.getPlaylistPref(this.folderPath);
    let fadeInStr = typeof pref.fadeInMs === "number" ? String(pref.fadeInMs) : "";
    let fadeOutStr = typeof pref.fadeOutMs === "number" ? String(pref.fadeOutMs) : "";
    let vol = typeof pref.volume === "number" ? pref.volume : 1;
    const originalVol = vol;
    let loop = !!pref.loop;
    let shuffle = !!pref.shuffle;
    new import_obsidian2.Setting(contentEl).setName("Fade in (ms)").setDesc("Leave empty to use the global default.").addText(
      (ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeInMs)).setValue(fadeInStr).onChange((v) => {
        fadeInStr = v;
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Fade out (ms)").setDesc("Leave empty to use the global default.").addText(
      (ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeOutMs)).setValue(fadeOutStr).onChange((v) => {
        fadeOutStr = v;
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Volume").setDesc("0\u20131, multiplied by the master volume.").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(vol).onChange((v) => {
        vol = v;
        this.plugin.updateVolumeForPlaylistFolder(this.folderPath, v);
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Loop playlist").addToggle(
      (tg) => tg.setValue(loop).onChange((v) => {
        loop = v;
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Shuffle").setDesc("If enabled, playback order is shuffled. On each loop restart, it is reshuffled.").addToggle(
      (tg) => tg.setValue(shuffle).onChange((v) => {
        shuffle = v;
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Insert playlist button").setDesc("Insert a Markdown button for this playlist into the active note.").addButton(
      (b) => b.setButtonText("Insert button").onClick(() => {
        this.plugin.insertPlaylistButtonIntoActiveNote(this.folderPath);
      })
    );
    new import_obsidian2.Setting(contentEl).addButton(
      (b) => b.setButtonText("Restore defaults").onClick(async () => {
        delete pref.fadeInMs;
        delete pref.fadeOutMs;
        delete pref.volume;
        delete pref.loop;
        delete pref.shuffle;
        this.plugin.setPlaylistPref(this.folderPath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.plugin.updateVolumeForPlaylistFolder(this.folderPath, 1);
        this.close();
      })
    ).addButton(
      (b) => b.setCta().setButtonText("Save").onClick(async () => {
        const fi = fadeInStr.trim() === "" ? void 0 : Number(fadeInStr);
        const fo = fadeOutStr.trim() === "" ? void 0 : Number(fadeOutStr);
        if (fi != null && Number.isNaN(fi)) return;
        if (fo != null && Number.isNaN(fo)) return;
        pref.fadeInMs = fi;
        pref.fadeOutMs = fo;
        pref.volume = vol;
        pref.loop = loop;
        if (shuffle) pref.shuffle = true;
        else delete pref.shuffle;
        this.plugin.setPlaylistPref(this.folderPath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton(
      (b) => b.setButtonText("Cancel").onClick(() => {
        this.plugin.updateVolumeForPlaylistFolder(this.folderPath, originalVol);
        this.close();
      })
    );
  }
};

// ui/SoundboardView.ts
var VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";
var SoundboardView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.state = {};
    this.playingFiles = /* @__PURE__ */ new Set();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TTRPG_SOUNDBOARD;
  }
  getDisplayText() {
    return "Soundboard";
  }
  getIcon() {
    return "music";
  }
  onOpen() {
    this.contentEl.addClass("ttrpg-sb-view");
    this.playingFiles = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on((e) => {
      if (e.type === "start") {
        this.playingFiles.add(e.filePath);
      } else if (e.type === "stop") {
        this.playingFiles.delete(e.filePath);
      }
      this.updatePlayingVisuals();
    });
    this.render();
  }
  onClose() {
    var _a;
    this.contentEl.removeClass("ttrpg-sb-view");
    (_a = this.unsubEngine) == null ? void 0 : _a.call(this);
    this.unsubEngine = void 0;
  }
  getState() {
    var _a;
    return {
      folderA: this.state.folderA,
      folderB: this.state.folderB,
      folderC: this.state.folderC,
      folderD: this.state.folderD,
      activeSlot: (_a = this.state.activeSlot) != null ? _a : "A"
    };
  }
  async setState(state) {
    const next = {
      folderA: state.folderA,
      folderB: state.folderB,
      folderC: state.folderC,
      folderD: state.folderD,
      activeSlot: state.activeSlot,
      folder: state.folder
    };
    const legacyFolder = state.folder;
    if (!next.folderA && !next.folderB && legacyFolder) {
      next.folderA = legacyFolder;
      next.activeSlot = "A";
    }
    this.state = next;
    this.render();
    await Promise.resolve();
  }
  setLibrary(library) {
    this.library = library;
    this.render();
  }
  async saveViewState() {
    await this.leaf.setViewState({
      type: VIEW_TYPE_TTRPG_SOUNDBOARD,
      state: this.getState(),
      active: true
    });
  }
  getActiveFolderPath() {
    var _a, _b, _c, _d, _e;
    const slot = (_a = this.state.activeSlot) != null ? _a : "A";
    if (slot === "A") return (_b = this.state.folderA) != null ? _b : "";
    if (slot === "B") return (_c = this.state.folderB) != null ? _c : "";
    if (slot === "C") return (_d = this.state.folderC) != null ? _d : "";
    return (_e = this.state.folderD) != null ? _e : "";
  }
  render() {
    var _a, _b, _c, _d, _e, _f;
    const { contentEl } = this;
    contentEl.empty();
    const library = this.library;
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });
    const rowFolders1 = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    let rowFolders2 = null;
    if (this.plugin.settings.toolbarFourFolders) {
      rowFolders2 = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    }
    const rowControls = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    const topFolders = (_a = library == null ? void 0 : library.topFolders) != null ? _a : [];
    const rootFolder = library == null ? void 0 : library.rootFolder;
    const rootRegex = rootFolder != null && rootFolder !== "" ? new RegExp(`^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`) : null;
    const makeLabel = (f) => rootRegex ? f.replace(rootRegex, "") || f : f;
    const folderA = (_b = this.state.folderA) != null ? _b : "";
    const folderB = (_c = this.state.folderB) != null ? _c : "";
    const folderC = (_d = this.state.folderC) != null ? _d : "";
    const folderD = (_e = this.state.folderD) != null ? _e : "";
    const activeSlot = (_f = this.state.activeSlot) != null ? _f : "A";
    const createFolderSelectTwo = (parent, currentValue, slot) => {
      const wrap = parent.createDiv({ cls: "ttrpg-sb-folder-select" });
      const select = wrap.createEl("select");
      select.createEl("option", { text: "All folders", value: "" });
      for (const f of topFolders) {
        select.createEl("option", { text: makeLabel(f), value: f });
      }
      select.value = currentValue || "";
      if (activeSlot === slot) wrap.addClass("active");
      select.onchange = async () => {
        const v = select.value || void 0;
        if (slot === "A") this.state.folderA = v;
        else this.state.folderB = v;
        this.state.activeSlot = slot;
        await this.saveViewState();
        this.render();
      };
      return select;
    };
    const createFolderSlotFour = (parent, currentValue, slot, goLeft) => {
      const wrap = parent.createDiv({ cls: "ttrpg-sb-folder-select" });
      if (activeSlot === slot) wrap.addClass("active");
      let select;
      let goBtn;
      if (goLeft) {
        goBtn = wrap.createEl("button", {
          cls: "ttrpg-sb-icon-btn ttrpg-sb-folder-go",
          attr: { type: "button", "aria-label": "Show this folder" }
        });
        goBtn.textContent = "Go";
        select = wrap.createEl("select");
      } else {
        select = wrap.createEl("select");
        goBtn = wrap.createEl("button", {
          cls: "ttrpg-sb-icon-btn ttrpg-sb-folder-go",
          attr: { type: "button", "aria-label": "Show this folder" }
        });
        goBtn.textContent = "Go";
      }
      select.createEl("option", { text: "All folders", value: "" });
      for (const f of topFolders) {
        select.createEl("option", { text: makeLabel(f), value: f });
      }
      select.value = currentValue || "";
      select.onchange = async () => {
        const v = select.value || void 0;
        if (slot === "A") this.state.folderA = v;
        else if (slot === "B") this.state.folderB = v;
        else if (slot === "C") this.state.folderC = v;
        else this.state.folderD = v;
        await this.saveViewState();
      };
      goBtn.onclick = async () => {
        this.state.activeSlot = slot;
        await this.saveViewState();
        this.render();
      };
    };
    if (this.plugin.settings.toolbarFourFolders) {
      createFolderSlotFour(rowFolders1, folderA, "A", false);
      createFolderSlotFour(rowFolders1, folderB, "B", true);
      if (rowFolders2) {
        createFolderSlotFour(rowFolders2, folderC, "C", false);
        createFolderSlotFour(rowFolders2, folderD, "D", true);
      }
    } else {
      createFolderSelectTwo(rowFolders1, folderA, "A");
      const switchBtn = rowFolders1.createEl("button", {
        cls: "ttrpg-sb-icon-btn",
        attr: { type: "button", "aria-label": "Switch folder view" },
        text: "\u21C4"
      });
      switchBtn.onclick = async () => {
        var _a2;
        const current = (_a2 = this.state.activeSlot) != null ? _a2 : "A";
        const nextSlot = current === "A" ? "B" : "A";
        this.state.activeSlot = nextSlot;
        await this.saveViewState();
        this.render();
      };
      createFolderSelectTwo(rowFolders1, folderB, "B");
    }
    const stopAllBtn = rowControls.createEl("button", {
      cls: "ttrpg-sb-stop-all",
      text: "Stop all"
    });
    stopAllBtn.onclick = () => {
      void this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);
    };
    const masterGroup = rowControls.createDiv({ cls: "ttrpg-sb-slider-group" });
    masterGroup.createSpan({ cls: "ttrpg-sb-slider-label", text: "Master" });
    const volInput = masterGroup.createEl("input", { type: "range" });
    volInput.min = "0";
    volInput.max = "1";
    volInput.step = "0.01";
    volInput.value = String(this.plugin.settings.masterVolume);
    volInput.oninput = () => {
      const v = Number(volInput.value);
      this.plugin.settings.masterVolume = v;
      this.plugin.engine.setMasterVolume(v);
      void this.plugin.saveSettings();
    };
    const ambGroup = rowControls.createDiv({ cls: "ttrpg-sb-slider-group" });
    ambGroup.createSpan({ cls: "ttrpg-sb-slider-label", text: "Ambience" });
    const ambInput = ambGroup.createEl("input", { type: "range" });
    ambInput.min = "0";
    ambInput.max = "1";
    ambInput.step = "0.01";
    ambInput.value = String(this.plugin.settings.ambienceVolume);
    ambInput.oninput = () => {
      const v = Number(ambInput.value);
      this.plugin.settings.ambienceVolume = v;
      this.plugin.updateVolumesForPlayingAmbience();
      void this.plugin.saveSettings();
    };
    const activeFolder = this.getActiveFolderPath();
    const useSimple = this.plugin.isSimpleViewForFolder(activeFolder);
    const container = contentEl.createDiv({
      cls: useSimple ? "ttrpg-sb-simple-list" : "ttrpg-sb-grid"
    });
    if (!library) {
      container.createDiv({ text: "No files found. Check settings." });
      return;
    }
    const folder = activeFolder;
    if (!folder) {
      for (const file of library.allSingles) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
      this.updatePlayingVisuals();
      return;
    }
    const content = library.byFolder[folder];
    if (!content) {
      container.createDiv({ text: "Folder contents not found." });
      return;
    }
    const renderGroup = (kind) => {
      if (kind === "playlists") {
        for (const pl of content.playlists) {
          if (useSimple) this.renderPlaylistRow(container, pl);
          else this.renderPlaylistCard(container, pl);
        }
        return;
      }
      const isAmb = kind === "ambience";
      const files = content.files.filter((f) => this.plugin.isAmbiencePath(f.path) === isAmb);
      for (const file of files) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
    };
    if (!this.plugin.settings.arrangementEnabled) {
      for (const file of content.files) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
      for (const pl of content.playlists) {
        if (useSimple) this.renderPlaylistRow(container, pl);
        else this.renderPlaylistCard(container, pl);
      }
    } else {
      const order = this.getArrangementOrder();
      for (const k of order) renderGroup(k);
    }
    this.updatePlayingVisuals();
  }
  getArrangementOrder() {
    const fallback = ["sounds", "ambience", "playlists"];
    const chosen = [
      this.plugin.settings.arrangementFirst,
      this.plugin.settings.arrangementSecond,
      this.plugin.settings.arrangementThird
    ].filter((v) => v !== "default");
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const v of chosen) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    for (const v of fallback) {
      if (!seen.has(v)) out.push(v);
    }
    return out;
  }
  renderSingleCard(container, file) {
    var _a;
    const card = container.createDiv({ cls: "ttrpg-sb-card" });
    const isAmbience = this.plugin.isAmbiencePath(file.path);
    if (isAmbience) card.addClass("ambience");
    card.createDiv({ cls: "ttrpg-sb-title", text: file.basename });
    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile",
      attr: { "aria-label": file.basename }
    });
    if (isAmbience) tile.addClass("ambience");
    const thumb = this.findThumbFor(file);
    if (thumb) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(thumb)})`;
    }
    const pref = this.plugin.getSoundPref(file.path);
    const loopEndTrimSeconds = this.plugin.getLoopEndTrimSecondsForPath(file.path);
    tile.onclick = async () => {
      var _a2, _b;
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = (_a2 = pref.volume) != null ? _a2 : 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: this.plugin.getEffectiveLoopForPath(file.path),
        fadeInMs: (_b = pref.fadeInMs) != null ? _b : this.plugin.settings.defaultFadeInMs,
        loopEndTrimSeconds
      });
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": "false",
        type: "button"
      }
    });
    (0, import_obsidian3.setIcon)(loopBtn, "repeat");
    const paintLoop = () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      loopBtn.toggleClass("active", effective);
      loopBtn.setAttr("aria-pressed", String(effective));
    };
    paintLoop();
    loopBtn.onclick = async () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      pref.loop = !effective;
      this.plugin.setSoundPref(file.path, pref);
      await this.plugin.saveSettings();
      paintLoop();
    };
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.path = file.path;
    if (this.playingFiles.has(file.path)) stopBtn.classList.add("playing");
    stopBtn.onclick = async () => {
      var _a2;
      await this.plugin.engine.stopByFile(file, (_a2 = pref.fadeOutMs) != null ? _a2 : this.plugin.settings.defaultFadeOutMs);
    };
    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String((_a = pref.volume) != null ? _a : 1);
    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };
    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
  }
  renderSingleRow(container, file) {
    var _a;
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row" });
    row.dataset.path = file.path;
    const isAmbience = this.plugin.isAmbiencePath(file.path);
    if (isAmbience) row.addClass("ambience");
    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({ cls: "ttrpg-sb-simple-title", text: file.basename });
    const durationEl = main.createSpan({ cls: "ttrpg-sb-simple-duration", text: "" });
    this.plugin.requestDurationFormatted(file, (txt) => {
      if (!durationEl.isConnected) return;
      durationEl.setText(txt);
    });
    const pref = this.plugin.getSoundPref(file.path);
    const loopEndTrimSeconds = this.plugin.getLoopEndTrimSecondsForPath(file.path);
    main.onclick = async () => {
      var _a2, _b;
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = (_a2 = pref.volume) != null ? _a2 : 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: this.plugin.getEffectiveLoopForPath(file.path),
        fadeInMs: (_b = pref.fadeInMs) != null ? _b : this.plugin.settings.defaultFadeInMs,
        loopEndTrimSeconds
      });
    };
    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });
    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": "false",
        type: "button"
      }
    });
    (0, import_obsidian3.setIcon)(loopBtn, "repeat");
    const paintLoop = () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      loopBtn.toggleClass("active", effective);
      loopBtn.setAttr("aria-pressed", String(effective));
    };
    paintLoop();
    loopBtn.onclick = async () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      pref.loop = !effective;
      this.plugin.setSoundPref(file.path, pref);
      await this.plugin.saveSettings();
      paintLoop();
    };
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.path = file.path;
    stopBtn.onclick = async () => {
      var _a2;
      await this.plugin.engine.stopByFile(file, (_a2 = pref.fadeOutMs) != null ? _a2 : this.plugin.settings.defaultFadeOutMs);
    };
    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String((_a = pref.volume) != null ? _a : 1);
    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };
    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
    if (this.playingFiles.has(file.path)) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  findThumbFor(file) {
    var _a, _b;
    const base = file.basename;
    if (this.plugin.settings.thumbnailFolderEnabled && this.plugin.settings.thumbnailFolderPath.trim()) {
      const folder = (0, import_obsidian3.normalizePath)(this.plugin.settings.thumbnailFolderPath.trim());
      const candidates2 = ["png", "jpg", "jpeg", "webp"].map((ext) => `${folder}/${base}.${ext}`);
      for (const p of candidates2) {
        const af = this.app.vault.getAbstractFileByPath(p);
        if (af && af instanceof import_obsidian3.TFile) return af;
      }
      return null;
    }
    const parent = (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const candidates = ["png", "jpg", "jpeg", "webp"].map((ext) => `${parent}/${base}.${ext}`);
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof import_obsidian3.TFile) return af;
    }
    return null;
  }
  renderPlaylistCard(container, pl) {
    const card = container.createDiv({ cls: "ttrpg-sb-card playlist" });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });
    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile playlist",
      attr: { "aria-label": pl.name }
    });
    if (pl.cover) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(pl.cover)})`;
    }
    tile.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };
    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();
    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) stopBtn.classList.add("playing");
  }
  renderPlaylistRow(container, pl) {
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row playlist" });
    row.dataset.playlist = pl.path;
    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({ cls: "ttrpg-sb-simple-title", text: pl.name });
    main.createSpan({ cls: "ttrpg-sb-simple-duration", text: `${pl.tracks.length} tracks` });
    main.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };
    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });
    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };
    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();
    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  updatePlayingVisuals() {
    const btns = this.contentEl.querySelectorAll(".ttrpg-sb-stop[data-path]");
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
    const rows = this.contentEl.querySelectorAll(".ttrpg-sb-simple-row[data-path]");
    rows.forEach((r) => {
      const p = r.dataset.path || "";
      r.toggleClass("playing", this.playingFiles.has(p));
    });
    const pbtns = this.contentEl.querySelectorAll(".ttrpg-sb-stop[data-playlist]");
    pbtns.forEach((b) => {
      const p = b.dataset.playlist || "";
      const active = this.plugin.isPlaylistActive(p);
      b.toggleClass("playing", active);
    });
    const plRows = this.contentEl.querySelectorAll(".ttrpg-sb-simple-row[data-playlist]");
    plRows.forEach((r) => {
      const p = r.dataset.playlist || "";
      const active = this.plugin.isPlaylistActive(p);
      r.toggleClass("playing", active);
    });
  }
};

// ui/NowPlayingView.ts
var import_obsidian4 = require("obsidian");
var VIEW_TYPE_TTRPG_NOWPLAYING = "ttrpg-soundboard-nowplaying";
var NowPlayingView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.playingPaths = /* @__PURE__ */ new Set();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TTRPG_NOWPLAYING;
  }
  getDisplayText() {
    return "Now playing";
  }
  getIcon() {
    return "music-2";
  }
  onOpen() {
    this.contentEl.addClass("ttrpg-sb-view");
    this.playingPaths = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on(() => {
      this.playingPaths = new Set(this.plugin.engine.getPlayingFilePaths());
      this.render();
    });
    this.render();
  }
  onClose() {
    var _a;
    this.contentEl.removeClass("ttrpg-sb-view");
    (_a = this.unsubEngine) == null ? void 0 : _a.call(this);
    this.unsubEngine = void 0;
  }
  getState() {
    return {};
  }
  async setState(_state) {
    await Promise.resolve();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const grid = contentEl.createDiv({ cls: "ttrpg-sb-now-grid" });
    if (this.playingPaths.size === 0) {
      grid.createDiv({ text: "No sounds are playing." });
      return;
    }
    for (const path of this.playingPaths) {
      this.renderCard(grid, path);
    }
  }
  renderCard(grid, path) {
    var _a, _b, _c, _d;
    const af = this.app.vault.getAbstractFileByPath(path);
    const file = af instanceof import_obsidian4.TFile ? af : null;
    const name = (_b = (_a = file == null ? void 0 : file.basename) != null ? _a : path.split("/").pop()) != null ? _b : path;
    const state = this.plugin.engine.getPathPlaybackState(path);
    const isPaused = state === "paused";
    const activePlaylistPath = this.plugin.getActivePlaylistPathForTrackPath(path);
    const isAmbience = this.plugin.isAmbiencePath(path);
    const card = grid.createDiv({ cls: "ttrpg-sb-now-card" });
    if (isPaused) card.addClass("paused");
    if (activePlaylistPath) card.addClass("playlist");
    else if (isAmbience) card.addClass("ambience");
    card.createDiv({ cls: "ttrpg-sb-now-title", text: name });
    const controls = card.createDiv({ cls: "ttrpg-sb-now-controls" });
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop playing",
      text: "Stop"
    });
    stopBtn.onclick = async () => {
      if (file) {
        await this.plugin.engine.stopByFile(file, this.plugin.settings.defaultFadeOutMs);
      }
    };
    const pauseBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: isPaused ? "Resume" : "Pause"
    });
    pauseBtn.onclick = async () => {
      if (!file) return;
      if (isPaused) {
        await this.plugin.engine.resumeByFile(file, this.plugin.settings.defaultFadeInMs);
      } else {
        await this.plugin.engine.pauseByFile(file, this.plugin.settings.defaultFadeOutMs);
      }
    };
    const volSlider = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";
    if (activePlaylistPath) {
      const pref = this.plugin.getPlaylistPref(activePlaylistPath);
      volSlider.value = String((_c = pref.volume) != null ? _c : 1);
      volSlider.oninput = () => {
        const v = Number(volSlider.value);
        this.plugin.setPlaylistVolumeFromSlider(activePlaylistPath, v);
      };
    } else {
      const pref = this.plugin.getSoundPref(path);
      volSlider.value = String((_d = pref.volume) != null ? _d : 1);
      this.plugin.registerVolumeSliderForPath(path, volSlider);
      volSlider.oninput = () => {
        const v = Number(volSlider.value);
        this.plugin.setVolumeForPathFromSlider(path, v, volSlider);
      };
    }
  }
};

// settings.ts
var import_obsidian6 = require("obsidian");

// ui/StyleSettingsModal.ts
var import_obsidian5 = require("obsidian");
var STYLE_GROUPS = ["sounds", "ambience", "playlists"];
var STYLE_PROPS = ["cardBg", "cardBorder", "tileBorder"];
function cloneStyleSettings(v) {
  return {
    sounds: { ...v.sounds },
    ambience: { ...v.ambience },
    playlists: { ...v.playlists }
  };
}
function isHexColor(v) {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}
var StyleSettingsModal = class extends import_obsidian5.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.titleEl.setText("Soundboard style");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const working = cloneStyleSettings(this.plugin.settings.style);
    this.renderGroupSounds(contentEl, working);
    this.renderGroupAmbience(contentEl, working);
    this.renderGroupPlaylists(contentEl, working);
    new import_obsidian5.Setting(contentEl).addButton(
      (b) => b.setButtonText("Restore defaults").onClick(async () => {
        for (const g of STYLE_GROUPS) {
          for (const p of STYLE_PROPS) {
            working[g][p] = "";
          }
        }
        this.plugin.settings.style = working;
        await this.plugin.saveSettings();
        this.plugin.applyCssVars();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton(
      (b) => b.setCta().setButtonText("Save").onClick(async () => {
        this.plugin.settings.style = working;
        await this.plugin.saveSettings();
        this.plugin.applyCssVars();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
  renderGroupSounds(parent, working) {
    new import_obsidian5.Setting(parent).setName("Sounds").setHeading();
    this.addColorSetting(parent, working, "sounds", "cardBg");
    this.addColorSetting(parent, working, "sounds", "cardBorder");
    this.addColorSetting(parent, working, "sounds", "tileBorder");
  }
  renderGroupAmbience(parent, working) {
    new import_obsidian5.Setting(parent).setName("Ambience").setHeading();
    this.addColorSetting(parent, working, "ambience", "cardBg");
    this.addColorSetting(parent, working, "ambience", "cardBorder");
    this.addColorSetting(parent, working, "ambience", "tileBorder");
  }
  renderGroupPlaylists(parent, working) {
    new import_obsidian5.Setting(parent).setName("Playlists").setHeading();
    this.addColorSetting(parent, working, "playlists", "cardBg");
    this.addColorSetting(parent, working, "playlists", "cardBorder");
    this.addColorSetting(parent, working, "playlists", "tileBorder");
  }
  addColorSetting(parent, working, group, prop) {
    var _a;
    const setting = new import_obsidian5.Setting(parent);
    if (prop === "cardBg") setting.setName("Card background");
    else if (prop === "cardBorder") setting.setName("Card border");
    else setting.setName("Tile border");
    setting.setDesc("Pick a color.");
    const statusEl = setting.descEl.createEl("div");
    const refreshStatus = () => {
      var _a2;
      const stored2 = ((_a2 = working[group][prop]) != null ? _a2 : "").trim();
      statusEl.setText(stored2 ? `Current: ${stored2}` : "Current: (uses theme default)");
    };
    refreshStatus();
    const stored = ((_a = working[group][prop]) != null ? _a : "").trim();
    const pickerValue = isHexColor(stored) ? stored : "#000000";
    let picker = null;
    let suppressPickerChange = false;
    setting.addColorPicker((cp) => {
      picker = cp;
      cp.setValue(pickerValue);
      cp.onChange((v) => {
        if (suppressPickerChange) return;
        working[group][prop] = String(v != null ? v : "").trim();
        refreshStatus();
      });
    });
    setting.addButton(
      (b) => b.setButtonText("Clear").onClick(() => {
        working[group][prop] = "";
        refreshStatus();
        if (picker) {
          suppressPickerChange = true;
          picker.setValue("#000000");
          suppressPickerChange = false;
        }
      })
    );
  }
};

// settings.ts
var DEFAULT_SETTINGS = {
  rootFolder: "Soundbar",
  includeRootFiles: false,
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3e3,
  defaultFadeOutMs: 3e3,
  allowOverlap: true,
  masterVolume: 1,
  mediaElementThresholdMB: 25,
  ambienceVolume: 1,
  simpleView: false,
  folderViewModes: {},
  tileHeightPx: 100,
  noteIconSizePx: 40,
  toolbarFourFolders: false,
  maxAudioCacheMB: 512,
  // default 512 MB of decoded audio
  thumbnailFolderEnabled: false,
  thumbnailFolderPath: "",
  arrangementEnabled: false,
  arrangementFirst: "default",
  arrangementSecond: "default",
  arrangementThird: "default",
  style: {
    sounds: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: ""
    },
    ambience: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: ""
    },
    playlists: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: ""
    }
  }
};
var SoundboardSettingTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    var _a, _b;
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian6.Setting(containerEl).setName("Library").setHeading();
    new import_obsidian6.Setting(containerEl).setName("Root folder").setDesc("Only subfolders under this folder are listed as options.").addText(
      (ti) => ti.setPlaceholder("Soundbar").setValue(this.plugin.settings.rootFolder).onChange((v) => {
        this.plugin.settings.rootFolder = v.trim();
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Include files directly in root").setDesc(
      "If enabled, files directly in the root folder are listed (otherwise only in subfolders)."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.includeRootFiles).onChange((v) => {
        this.plugin.settings.includeRootFiles = v;
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Folders (legacy, comma separated)").setDesc("Used only when the root folder is empty.").addText(
      (ti) => ti.setValue(this.plugin.settings.folders.join(", ")).onChange((v) => {
        this.plugin.settings.folders = v.split(",").map((s) => s.trim()).filter(Boolean);
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Allowed extensions").setDesc("E.g., mp3, ogg, wav, m4a, flac.").addText(
      (ti) => ti.setValue(this.plugin.settings.extensions.join(", ")).onChange((v) => {
        this.plugin.settings.extensions = v.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Playback").setHeading();
    new import_obsidian6.Setting(containerEl).setName("Fade in (ms)").addText(
      (ti) => ti.setValue(String(this.plugin.settings.defaultFadeInMs)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Fade out (ms)").addText(
      (ti) => ti.setValue(String(this.plugin.settings.defaultFadeOutMs)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Allow overlap").setDesc("Play multiple sounds at the same time.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.allowOverlap).onChange((v) => {
        this.plugin.settings.allowOverlap = v;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Master volume").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.masterVolume).onChange((v) => {
        var _a2;
        this.plugin.settings.masterVolume = v;
        (_a2 = this.plugin.engine) == null ? void 0 : _a2.setMasterVolume(v);
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Threshold for faster large\u2011file audio playback (mb)").setDesc(
      "Files larger than this threshold are played via the htmlaudioelement for faster startup without full decoding. Set to 0 to disable."
    ).addSlider(
      (s) => s.setLimits(0, 512, 1).setValue(this.plugin.settings.mediaElementThresholdMB).setDynamicTooltip().onChange((v) => {
        var _a2;
        this.plugin.settings.mediaElementThresholdMB = v;
        (_a2 = this.plugin.engine) == null ? void 0 : _a2.setMediaElementThresholdMB(v);
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Decoded audio cache.").setDesc(
      "Upper limit in megabytes for in-memory decoded audio buffers. 0 disables caching (minimal random access memory, more decoding)."
    ).addSlider(
      (s) => s.setLimits(0, 2048, 16).setValue(this.plugin.settings.maxAudioCacheMB).setDynamicTooltip().onChange((v) => {
        var _a2;
        this.plugin.settings.maxAudioCacheMB = v;
        (_a2 = this.plugin.engine) == null ? void 0 : _a2.setCacheLimitMB(v);
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Appearance").setHeading();
    new import_obsidian6.Setting(containerEl).setName("Soundboard style").setDesc("Configure card/tile/button colors for sounds, ambience and playlists.").addButton(
      (b) => b.setButtonText("Open style editor").onClick(() => {
        new StyleSettingsModal(this.app, this.plugin).open();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Four pinned folder slots").setDesc(
      "If enabled, show four folder dropdowns in the soundboard toolbar (two rows) instead of two with a switch button."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.toolbarFourFolders).onChange((v) => {
        this.plugin.settings.toolbarFourFolders = v;
        void this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Simple list view (global default)").setDesc(
      "Global default: if no per-folder override exists, folders are shown either as grid or simple list."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.simpleView).onChange((v) => {
        this.plugin.settings.simpleView = v;
        void this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Arrangement").setHeading();
    new import_obsidian6.Setting(containerEl).setName("Enable arrangement").setDesc("If enabled, the soundboard groups sounds by category and shows them in your chosen order.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.arrangementEnabled).onChange((v) => {
        this.plugin.settings.arrangementEnabled = v;
        void this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    const addArrDropdown = (name, key) => {
      new import_obsidian6.Setting(containerEl).setName(name).setDesc("Default means: remaining groups are appended in the default order.").addDropdown((dd) => {
        dd.addOption("default", "Default");
        dd.addOption("sounds", "Sounds");
        dd.addOption("ambience", "Ambience");
        dd.addOption("playlists", "Playlists");
        dd.setValue(this.plugin.settings[key]);
        dd.onChange((val) => {
          if (val === "default" || val === "sounds" || val === "ambience" || val === "playlists") {
            this.plugin.settings[key] = val;
            void this.plugin.saveSettings();
            this.plugin.refreshViews();
          }
        });
      });
    };
    addArrDropdown("First group", "arrangementFirst");
    addArrDropdown("Second group", "arrangementSecond");
    addArrDropdown("Third group", "arrangementThird");
    new import_obsidian6.Setting(containerEl).setName("Per-folder view mode").setHeading();
    containerEl.createEl("p", {
      text: "For each folder you can override the global default: inherit, grid, or simple list."
    });
    const lib = this.plugin.library;
    const topFolders = (_a = lib == null ? void 0 : lib.topFolders) != null ? _a : [];
    const rootFolder = lib == null ? void 0 : lib.rootFolder;
    const rootRegex = rootFolder != null && rootFolder !== "" ? new RegExp(
      `^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`
    ) : null;
    const makeLabel = (f) => rootRegex ? f.replace(rootRegex, "") || f : f;
    if (topFolders.length === 0) {
      containerEl.createEl("p", {
        text: "No top-level folders detected yet. Make sure your root folder exists and contains subfolders."
      });
    } else {
      for (const folderPath of topFolders) {
        const label = makeLabel(folderPath);
        const map = (_b = this.plugin.settings.folderViewModes) != null ? _b : {};
        const override = map[folderPath];
        const setting = new import_obsidian6.Setting(containerEl).setName(label).setDesc(folderPath);
        const globalIsSimple = this.plugin.settings.simpleView;
        const inheritLabel = globalIsSimple ? "Inherit (simple list)" : "Inherit (grid)";
        setting.addDropdown((dd) => {
          dd.addOption("inherit", inheritLabel);
          dd.addOption("grid", "Grid");
          dd.addOption("simple", "Simple list");
          const current = override != null ? override : "inherit";
          dd.setValue(current);
          dd.onChange((val) => {
            if (val === "inherit" || val === "grid" || val === "simple") {
              this.plugin.setFolderViewMode(folderPath, val);
            }
          });
        });
      }
    }
    new import_obsidian6.Setting(containerEl).setName("Tile height (px)").setDesc("Adjust thumbnail tile height for the grid.").addSlider(
      (s) => s.setLimits(30, 300, 1).setValue(this.plugin.settings.tileHeightPx).onChange((v) => {
        this.plugin.settings.tileHeightPx = v;
        this.plugin.applyCssVars();
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Note button icon size (px)").setDesc("Height of images used in note buttons.").addSlider(
      (s) => s.setLimits(16, 128, 1).setValue(this.plugin.settings.noteIconSizePx).onChange((v) => {
        this.plugin.settings.noteIconSizePx = v;
        this.plugin.applyCssVars();
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Thumbnails").setHeading();
    const thumbFolderSetting = new import_obsidian6.Setting(containerEl).setName("Thumbnail folder path").setDesc(
      "Vault path to the folder containing thumbnails. When enabled, thumbnails are looked up only in this folder (by matching base filename)."
    ).addText(
      (ti) => ti.setPlaceholder("Soundbar/_thumbnails").setValue(this.plugin.settings.thumbnailFolderPath).onChange((v) => {
        this.plugin.settings.thumbnailFolderPath = v.trim();
        void this.plugin.saveSettings();
        this.plugin.rescan();
        this.plugin.refreshViews();
      })
    );
    thumbFolderSetting.setDisabled(!this.plugin.settings.thumbnailFolderEnabled);
    new import_obsidian6.Setting(containerEl).setName("Use shared thumbnail folder").setDesc(
      "If enabled, the plugin looks for thumbnails in the shared folder instead of next to audio files."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.thumbnailFolderEnabled).onChange((v) => {
        this.plugin.settings.thumbnailFolderEnabled = v;
        void this.plugin.saveSettings();
        thumbFolderSetting.setDisabled(!v);
        this.plugin.rescan();
        this.plugin.refreshViews();
      })
    );
  }
};

// util/fileDiscovery.ts
var import_obsidian7 = require("obsidian");
var IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
var AMBIENCE_FOLDER_NAME = "ambience";
function listSubfolders(app, rootFolder) {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof import_obsidian7.TFolder)) return [];
  const subs = af.children.filter((c) => c instanceof import_obsidian7.TFolder).map((c) => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}
function buildLibrary(app, opts) {
  var _a;
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(
      app,
      opts.rootFolder,
      opts.exts,
      !!opts.includeRootFiles,
      opts.thumbnailFolder
    );
  }
  const folders = ((_a = opts.foldersLegacy) != null ? _a : []).filter(Boolean);
  return buildLibraryFromFolders(app, folders, opts.exts, opts.thumbnailFolder);
}
function buildLibraryFromRoot(app, rootFolder, extensions, includeRootFiles, thumbnailFolder) {
  const root = normalizeFolder(rootFolder);
  const top = listSubfolders(app, root);
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const byFolder = {};
  const allSingles = [];
  if (includeRootFiles) {
    const rootSingles = filesDirectlyIn(app, root, exts);
    allSingles.push(...rootSingles);
  }
  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(
      app,
      folder,
      exts,
      thumbnailFolder
    );
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }
  return { rootFolder: root, topFolders: top, byFolder, allSingles };
}
function buildLibraryFromFolders(app, folders, extensions, thumbnailFolder) {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const top = folders.map((f) => normalizeFolder(f)).filter(Boolean);
  const byFolder = {};
  const allSingles = [];
  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(
      app,
      folder,
      exts,
      thumbnailFolder
    );
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }
  return { rootFolder: void 0, topFolders: top, byFolder, allSingles };
}
function filesDirectlyIn(app, folderPath, exts) {
  var _a;
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian7.TFolder)) return [];
  const out = [];
  for (const ch of af.children) {
    if (ch instanceof import_obsidian7.TFile) {
      const ext = (_a = ch.extension) == null ? void 0 : _a.toLowerCase();
      if (ext && exts.has(ext)) out.push(ch);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function directChildPlaylistsAndAmbienceSingles(app, folderPath, exts, thumbnailFolder) {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian7.TFolder)) return { playlists: [], ambienceSingles: [] };
  const subs = af.children.filter((c) => c instanceof import_obsidian7.TFolder);
  const playlists = [];
  const ambienceSingles = [];
  for (const sub of subs) {
    const isAmbience = sub.name.toLowerCase() === AMBIENCE_FOLDER_NAME.toLowerCase();
    const tracks = collectAudioRecursive(sub, exts);
    if (tracks.length === 0) continue;
    if (isAmbience) {
      ambienceSingles.push(...tracks);
      continue;
    }
    const cover = findCoverImage(app, sub, thumbnailFolder);
    playlists.push({
      path: sub.path,
      name: sub.name,
      parent: folderPath,
      tracks,
      cover
    });
  }
  playlists.sort((a, b) => a.name.localeCompare(b.name));
  ambienceSingles.sort((a, b) => a.path.localeCompare(b.path));
  return { playlists, ambienceSingles };
}
function collectAudioRecursive(folder, exts) {
  const out = [];
  const walk = (f) => {
    var _a;
    for (const ch of f.children) {
      if (ch instanceof import_obsidian7.TFile) {
        const ext = (_a = ch.extension) == null ? void 0 : _a.toLowerCase();
        if (ext && exts.has(ext)) out.push(ch);
      } else if (ch instanceof import_obsidian7.TFolder) {
        walk(ch);
      }
    }
  };
  walk(folder);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
function findCoverImage(app, playlistFolder, thumbnailFolder) {
  if (thumbnailFolder && thumbnailFolder.trim()) {
    return findImageByBaseName(app, thumbnailFolder, playlistFolder.name);
  }
  for (const ext of IMG_EXTS) {
    const cand = playlistFolder.children.find(
      (ch) => ch instanceof import_obsidian7.TFile && ch.name.toLowerCase() === `cover.${ext}`
    );
    if (cand instanceof import_obsidian7.TFile) return cand;
  }
  const imgs = playlistFolder.children.filter(
    (ch) => ch instanceof import_obsidian7.TFile && !!ch.extension && IMG_EXTS.includes(ch.extension.toLowerCase())
  );
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}
function findImageByBaseName(app, folderPath, baseName) {
  const folder = normalizeFolder(folderPath);
  for (const ext of IMG_EXTS) {
    const candPath = `${folder}/${baseName}.${ext}`;
    const af = app.vault.getAbstractFileByPath(candPath);
    if (af instanceof import_obsidian7.TFile) return af;
  }
  return void 0;
}
function normalizeFolder(p) {
  if (!p) return "";
  return (0, import_obsidian7.normalizePath)(p);
}

// ui/QuickPlayModal.ts
var import_obsidian8 = require("obsidian");
var QuickPlayModal = class extends import_obsidian8.FuzzySuggestModal {
  constructor(app, plugin, items) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.setPlaceholder("Search sound to play\u2026");
  }
  getItems() {
    return this.items;
  }
  getItemText(item) {
    if (item.context && item.context !== "(root)") {
      return `${item.label} \u2014 ${item.context}`;
    }
    return item.label;
  }
  onChooseItem(item) {
    void this.plugin.playFromQuickPicker(item.file);
  }
};

// main.ts
function unknownToError(err, fallbackMessage = "Unknown error") {
  var _a;
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return new Error(String(err));
  }
  if (typeof err === "symbol") {
    return new Error((_a = err.description) != null ? _a : err.toString());
  }
  if (typeof err === "object" && err !== null) {
    const maybeMsg = err.message;
    if (typeof maybeMsg === "string" && maybeMsg.trim()) {
      return new Error(maybeMsg);
    }
  }
  if (err == null) return new Error(fallbackMessage);
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return new Error(json);
  } catch (e) {
  }
  return new Error(fallbackMessage);
}
function hasSetLibrary(v) {
  return !!v && typeof v === "object" && typeof v["setLibrary"] === "function";
}
var TTRPGSoundboardPlugin = class extends import_obsidian9.Plugin {
  constructor() {
    super(...arguments);
    this.soundPrefs = {};
    this.playlistPrefs = {};
    this.durations = {};
    this.library = { topFolders: [], byFolder: {}, allSingles: [] };
    // Playlist runtime state
    this.playlistStates = /* @__PURE__ */ new Map();
    this.playIdToPlaylist = /* @__PURE__ */ new Map();
    // Note buttons inside markdown documents
    this.noteButtons = /* @__PURE__ */ new Set();
    // Registry of volume sliders per file path (soundboard view + now playing)
    this.volumeSliders = /* @__PURE__ */ new Map();
    this.rescanTimer = null;
    // Duration metadata loading queue
    this.pendingDuration = /* @__PURE__ */ new Map();
    this.currentDurationLoads = 0;
    this.maxConcurrentDurationLoads = 3;
    // Remember the last active MarkdownView so we can insert buttons
    // even if the user clicks in the soundboard sidebar.
    this.lastMarkdownView = null;
  }
  async onload() {
    await this.loadAll();
    this.applyCssVars();
    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);
    this.engine.setMediaElementThresholdMB(this.settings.mediaElementThresholdMB);
    this.engine.setCacheLimitMB(this.settings.maxAudioCacheMB);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf == null ? void 0 : leaf.view;
        if (view instanceof import_obsidian9.MarkdownView) {
          this.lastMarkdownView = view;
        }
      })
    );
    const current = this.app.workspace.getActiveViewOfType(import_obsidian9.MarkdownView);
    if (current) this.lastMarkdownView = current;
    this.engineNoteUnsub = this.engine.on((e) => {
      if (e.type === "stop") {
        const playlistPath = this.playIdToPlaylist.get(e.id);
        if (playlistPath) {
          this.playIdToPlaylist.delete(e.id);
          const st = this.playlistStates.get(playlistPath);
          if (e.reason === "ended") {
            void this.onPlaylistTrackEndedNaturally(playlistPath);
          } else if (st) {
            st.handle = void 0;
            st.active = false;
            st.currentTrackPath = void 0;
          }
        }
      }
      this.updateNoteButtonsPlayingState();
    });
    this.registerView(VIEW_TYPE_TTRPG_SOUNDBOARD, (leaf) => new SoundboardView(leaf, this));
    this.registerView(VIEW_TYPE_TTRPG_NOWPLAYING, (leaf) => new NowPlayingView(leaf, this));
    this.addRibbonIcon("music", "Open soundboard", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-soundboard-view",
      name: "Open soundboard view",
      callback: () => {
        void this.activateView();
      }
    });
    this.addCommand({
      id: "stop-all-sounds",
      name: "Stop all sounds",
      callback: () => {
        void this.engine.stopAll(this.settings.defaultFadeOutMs);
      }
    });
    this.addCommand({
      id: "preload-audio",
      name: "Preload audio buffers",
      callback: async () => {
        const files = this.getAllAudioFilesInLibrary();
        await this.engine.preload(files);
        new import_obsidian9.Notice(`TTRPG Soundboard: preloaded ${files.length} files.`);
      }
    });
    this.addCommand({
      id: "clear-audio-cache",
      name: "Clear decoded audio cache (free RAM)",
      callback: () => {
        this.engine.clearBufferCache();
        new import_obsidian9.Notice("Cleared decoded audio cache.");
      }
    });
    this.addCommand({
      id: "reload-audio-list",
      name: "Reload audio list",
      callback: () => this.rescan()
    });
    this.addCommand({
      id: "quick-play-sound",
      name: "Quick play sound (modal)",
      callback: () => {
        const items = this.buildQuickPlayItems();
        if (!items.length) {
          new import_obsidian9.Notice("No audio files found in library.");
          return;
        }
        new QuickPlayModal(this.app, this, items).open();
      }
    });
    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof import_obsidian9.TFile) {
          const newPath = file.path;
          const sp = this.soundPrefs[oldPath];
          if (sp) {
            this.soundPrefs[newPath] = sp;
            delete this.soundPrefs[oldPath];
          }
          const pp = this.playlistPrefs[oldPath];
          if (pp) {
            this.playlistPrefs[newPath] = pp;
            delete this.playlistPrefs[oldPath];
          }
          const dur = this.durations[oldPath];
          if (dur) {
            this.durations[newPath] = dur;
            delete this.durations[oldPath];
          }
          void this.saveSettings();
        }
        this.rescanDebounced();
      })
    );
    this.addSettingTab(new SoundboardSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.refreshViews();
    });
    this.registerMarkdownPostProcessor((el) => {
      this.processNoteButtons(el);
    });
    this.rescan();
  }
  onunload() {
    var _a, _b, _c;
    void ((_a = this.engine) == null ? void 0 : _a.stopAll(0));
    (_b = this.engineNoteUnsub) == null ? void 0 : _b.call(this);
    this.noteButtons.clear();
    this.volumeSliders.clear();
    this.playlistStates.clear();
    this.playIdToPlaylist.clear();
    (_c = this.engine) == null ? void 0 : _c.shutdown();
  }
  // ===== CSS helper =====
  applyCssVars() {
    var _a, _b;
    const h = Math.max(30, Math.min(400, Number((_a = this.settings.tileHeightPx) != null ? _a : 100)));
    document.documentElement.style.setProperty("--ttrpg-tile-height", `${h}px`);
    const iconSize = Math.max(12, Math.min(200, Number((_b = this.settings.noteIconSizePx) != null ? _b : 40)));
    document.documentElement.style.setProperty("--ttrpg-note-icon-size", `${iconSize}px`);
    const setOrRemove = (name, value) => {
      const v = (value != null ? value : "").trim();
      if (!v) document.documentElement.style.removeProperty(name);
      else document.documentElement.style.setProperty(name, v);
    };
    const st = this.settings.style;
    setOrRemove("--ttrpg-sb-card-bg-sounds", st.sounds.cardBg);
    setOrRemove("--ttrpg-sb-card-border-sounds", st.sounds.cardBorder);
    setOrRemove("--ttrpg-sb-tile-border-sounds", st.sounds.tileBorder);
    setOrRemove("--ttrpg-sb-btn-bg-sounds", st.sounds.buttonBg);
    setOrRemove("--ttrpg-sb-btn-border-sounds", st.sounds.buttonBorder);
    setOrRemove("--ttrpg-sb-btn-color-sounds", st.sounds.buttonColor);
    setOrRemove("--ttrpg-sb-card-bg-ambience", st.ambience.cardBg);
    setOrRemove("--ttrpg-sb-card-border-ambience", st.ambience.cardBorder);
    setOrRemove("--ttrpg-sb-tile-border-ambience", st.ambience.tileBorder);
    setOrRemove("--ttrpg-sb-btn-bg-ambience", st.ambience.buttonBg);
    setOrRemove("--ttrpg-sb-btn-border-ambience", st.ambience.buttonBorder);
    setOrRemove("--ttrpg-sb-btn-color-ambience", st.ambience.buttonColor);
    setOrRemove("--ttrpg-sb-card-bg-playlists", st.playlists.cardBg);
    setOrRemove("--ttrpg-sb-card-border-playlists", st.playlists.cardBorder);
    setOrRemove("--ttrpg-sb-tile-border-playlists", st.playlists.tileBorder);
    setOrRemove("--ttrpg-sb-btn-bg-playlists", st.playlists.buttonBg);
    setOrRemove("--ttrpg-sb-btn-border-playlists", st.playlists.buttonBorder);
    setOrRemove("--ttrpg-sb-btn-color-playlists", st.playlists.buttonColor);
  }
  getLoopEndTrimSecondsForPath(path) {
    if (!this.isAmbiencePath(path)) return 0;
    const pref = this.getSoundPref(path);
    const ms = pref.crossfadeMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return 0;
    return ms / 1e3;
  }
  // ===== View activation / library wiring =====
  async activateView() {
    const { workspace } = this.app;
    let sbLeaf;
    const sbLeaves = workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    if (sbLeaves.length) {
      sbLeaf = sbLeaves[0];
    } else {
      sbLeaf = workspace.getRightLeaf(false);
      if (sbLeaf) {
        await sbLeaf.setViewState({
          type: VIEW_TYPE_TTRPG_SOUNDBOARD,
          active: true
        });
      }
    }
    if (sbLeaf) {
      void workspace.revealLeaf(sbLeaf);
      await this.rebindLeafIfNeeded(sbLeaf);
    }
    const npLeaves = workspace.getLeavesOfType(VIEW_TYPE_TTRPG_NOWPLAYING);
    if (!npLeaves.length) {
      const right = workspace.getRightLeaf(true);
      if (right) {
        await right.setViewState({
          type: VIEW_TYPE_TTRPG_NOWPLAYING,
          active: false
        });
      }
    }
  }
  rescan() {
    var _a;
    const thumbFolder = this.settings.thumbnailFolderEnabled && this.settings.thumbnailFolderPath.trim() ? this.settings.thumbnailFolderPath.trim() : void 0;
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: ((_a = this.settings.rootFolder) == null ? void 0 : _a.trim()) ? void 0 : this.settings.folders,
      exts: this.settings.extensions,
      includeRootFiles: this.settings.includeRootFiles,
      thumbnailFolder: thumbFolder
    });
    this.refreshViews();
  }
  refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    for (const leaf of leaves) {
      void this.rebindLeafIfNeeded(leaf);
    }
  }
  async rebindLeafIfNeeded(leaf) {
    const view1 = leaf.view;
    if (hasSetLibrary(view1)) {
      view1.setLibrary(this.library);
      return;
    }
    try {
      await leaf.setViewState({
        type: VIEW_TYPE_TTRPG_SOUNDBOARD,
        active: true
      });
      const view2 = leaf.view;
      if (hasSetLibrary(view2)) {
        view2.setLibrary(this.library);
      }
    } catch (err) {
      console.error("TTRPG Soundboard: could not rebind view:", err);
    }
  }
  rescanDebounced(delay = 300) {
    if (this.rescanTimer) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(() => this.rescan(), delay);
  }
  // ===== Per-sound / per-playlist prefs =====
  getSoundPref(path) {
    var _a, _b;
    return (_b = (_a = this.soundPrefs)[path]) != null ? _b : _a[path] = {};
  }
  setSoundPref(path, pref) {
    this.soundPrefs[path] = pref;
  }
  getPlaylistPref(folderPath) {
    var _a, _b;
    return (_b = (_a = this.playlistPrefs)[folderPath]) != null ? _b : _a[folderPath] = {};
  }
  setPlaylistPref(folderPath, pref) {
    this.playlistPrefs[folderPath] = pref;
  }
  // ===== Loop defaults (Ambience auto-loop) =====
  getDefaultLoopForPath(path) {
    return this.isAmbiencePath(path);
  }
  getEffectiveLoopForPath(path) {
    const pref = this.getSoundPref(path);
    if (typeof pref.loop === "boolean") return pref.loop;
    return this.getDefaultLoopForPath(path);
  }
  // ===== Persistence =====
  async loadAll() {
    var _a, _b, _c, _d;
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(_a = data == null ? void 0 : data.settings) != null ? _a : {} };
    this.soundPrefs = (_b = data == null ? void 0 : data.soundPrefs) != null ? _b : {};
    this.playlistPrefs = (_c = data == null ? void 0 : data.playlistPrefs) != null ? _c : {};
    this.durations = (_d = data == null ? void 0 : data.durations) != null ? _d : {};
  }
  async saveSettings() {
    const data = {
      settings: this.settings,
      soundPrefs: this.soundPrefs,
      playlistPrefs: this.playlistPrefs,
      durations: this.durations
    };
    await this.saveData(data);
    this.applyCssVars();
  }
  getAllAudioFilesInLibrary() {
    const unique = /* @__PURE__ */ new Map();
    for (const f of this.library.allSingles) unique.set(f.path, f);
    for (const top of this.library.topFolders) {
      const fc = this.library.byFolder[top];
      if (!fc) continue;
      for (const pl of fc.playlists) {
        for (const t of pl.tracks) unique.set(t.path, t);
      }
    }
    return [...unique.values()];
  }
  // ===== Ambience + volume helpers =====
  isAmbiencePath(path) {
    const parts = path.toLowerCase().split("/");
    return parts.includes("ambience");
  }
  /**
   * Apply an effective volume (0..1) for all currently playing instances
   * of a given path, taking the global ambience volume into account.
   */
  applyEffectiveVolumeForSingle(path, rawVolume) {
    const v = Math.max(0, Math.min(1, rawVolume));
    const isAmb = this.isAmbiencePath(path);
    const effective = v * (isAmb ? this.settings.ambienceVolume : 1);
    this.engine.setVolumeForPath(path, effective);
  }
  /**
   * Called when the global ambience slider changes.
   * Adjusts volume of all currently playing ambience sounds.
   */
  updateVolumesForPlayingAmbience() {
    var _a;
    const playingPaths = this.engine.getPlayingFilePaths();
    for (const path of playingPaths) {
      if (!this.isAmbiencePath(path)) continue;
      const base = (_a = this.getSoundPref(path).volume) != null ? _a : 1;
      this.applyEffectiveVolumeForSingle(path, base);
    }
  }
  /**
   * Adjust volume for all currently playing tracks inside a playlist folder.
   * This does NOT change any saved per-sound volume preferences.
   */
  updateVolumeForPlaylistFolder(folderPath, rawVolume) {
    const playingPaths = this.engine.getPlayingFilePaths();
    const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
    const v = Math.max(0, Math.min(1, rawVolume));
    for (const path of playingPaths) {
      if (path === folderPath || path.startsWith(prefix)) {
        this.applyEffectiveVolumeForSingle(path, v);
      }
    }
  }
  setPlaylistVolumeFromSlider(playlistPath, rawVolume) {
    const v = Math.max(0, Math.min(1, rawVolume));
    const pref = this.getPlaylistPref(playlistPath);
    pref.volume = v;
    this.setPlaylistPref(playlistPath, pref);
    this.updateVolumeForPlaylistFolder(playlistPath, v);
    void this.saveSettings();
  }
  // ===== Simple view (grid vs list) =====
  isSimpleViewForFolder(folderPath) {
    var _a;
    const key = folderPath || "";
    const override = (_a = this.settings.folderViewModes) == null ? void 0 : _a[key];
    if (override === "grid") return false;
    if (override === "simple") return true;
    return this.settings.simpleView;
  }
  setFolderViewMode(folderPath, mode) {
    var _a;
    const key = folderPath || "";
    const map = (_a = this.settings.folderViewModes) != null ? _a : {};
    if (mode === "inherit") {
      delete map[key];
    } else {
      map[key] = mode;
    }
    this.settings.folderViewModes = map;
    void this.saveSettings();
    this.refreshViews();
  }
  // ===== Volume slider registry (soundboard view + now playing) =====
  registerVolumeSliderForPath(path, el) {
    if (!path) return;
    let set = this.volumeSliders.get(path);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.volumeSliders.set(path, set);
    }
    set.add(el);
  }
  /**
   * Called from UI sliders when the user changes a volume.
   * - updates the saved per-sound preference
   * - applies the effective volume to all currently playing instances
   * - synchronises all sliders for this path in all open views
   */
  setVolumeForPathFromSlider(path, rawVolume, source) {
    const v = Math.max(0, Math.min(1, rawVolume));
    const pref = this.getSoundPref(path);
    pref.volume = v;
    this.setSoundPref(path, pref);
    this.applyEffectiveVolumeForSingle(path, v);
    this.syncVolumeSlidersForPath(path, v, source);
    void this.saveSettings();
  }
  syncVolumeSlidersForPath(path, volume, source) {
    const set = this.volumeSliders.get(path);
    if (!set) return;
    for (const el of Array.from(set)) {
      if (!el.isConnected) {
        set.delete(el);
        continue;
      }
      if (source && el === source) continue;
      el.value = String(volume);
    }
    if (set.size === 0) {
      this.volumeSliders.delete(path);
    }
  }
  // ===== Duration metadata (simple view) =====
  /**
   * Request a formatted duration string for a file, using a persistent cache
   * and a small queue of HTMLAudio metadata loaders.
   */
  requestDurationFormatted(file, cb) {
    const seconds = this.getCachedDurationSeconds(file);
    if (seconds != null) {
      cb(this.formatDuration(seconds));
      return;
    }
    const path = file.path;
    let job = this.pendingDuration.get(path);
    const wrapped = (secs) => {
      cb(this.formatDuration(secs));
    };
    if (!job) {
      job = {
        file,
        callbacks: /* @__PURE__ */ new Set(),
        loading: false
      };
      this.pendingDuration.set(path, job);
    }
    job.callbacks.add(wrapped);
    this.startNextDurationJobs();
  }
  getCachedDurationSeconds(file) {
    const entry = this.durations[file.path];
    if (!entry) return null;
    const stat = file.stat;
    if (!stat) return null;
    if (entry.mtime === stat.mtime && entry.size === stat.size) {
      return entry.seconds;
    }
    return null;
  }
  startNextDurationJobs() {
    if (this.currentDurationLoads >= this.maxConcurrentDurationLoads) {
      return;
    }
    const entries = Array.from(this.pendingDuration.entries());
    for (const [path, job] of entries) {
      if (this.currentDurationLoads >= this.maxConcurrentDurationLoads) {
        break;
      }
      if (job.loading) continue;
      job.loading = true;
      this.currentDurationLoads++;
      void this.loadDurationWithHtmlAudio(job.file).then((seconds) => {
        const stat = job.file.stat;
        if (stat) {
          this.durations[path] = {
            seconds,
            mtime: stat.mtime,
            size: stat.size
          };
        }
        for (const cb of job.callbacks) {
          try {
            cb(seconds);
          } catch (e) {
          }
        }
        job.callbacks.clear();
        void this.saveSettings();
      }).catch(() => {
        for (const cb of job.callbacks) {
          try {
            cb(0);
          } catch (e) {
          }
        }
        job.callbacks.clear();
      }).finally(() => {
        this.pendingDuration.delete(path);
        this.currentDurationLoads--;
        this.startNextDurationJobs();
      });
    }
  }
  async loadDurationWithHtmlAudio(file) {
    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = this.app.vault.getResourcePath(file);
        const cleanup = () => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          audio.src = "";
        };
        audio.onloadedmetadata = () => {
          const secs = Number.isFinite(audio.duration) ? audio.duration : 0;
          cleanup();
          resolve(secs);
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error("Failed to load audio metadata"));
        };
      } catch (err) {
        reject(unknownToError(err));
      }
    });
  }
  formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  // ===== Quick-play modal helpers =====
  buildQuickPlayItems() {
    const files = this.getAllAudioFilesInLibrary().slice();
    files.sort((a, b) => a.path.localeCompare(b.path));
    const byName = /* @__PURE__ */ new Map();
    for (const file of files) {
      const name = file.basename;
      if (byName.has(name)) continue;
      const context = this.buildContextForFile(file);
      byName.set(name, {
        file,
        label: name,
        context
      });
    }
    const items = Array.from(byName.values());
    items.sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) return byLabel;
      return a.context.localeCompare(b.context);
    });
    return items;
  }
  buildContextForFile(file) {
    const path = file.path;
    const root = this.library.rootFolder;
    let rel = path;
    if (root && (path === root || path.startsWith(root + "/"))) {
      rel = path.slice(root.length + 1);
    }
    const lastSlash = rel.lastIndexOf("/");
    const folderPart = lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
    return folderPart || "(root)";
  }
  async playFromQuickPicker(file) {
    var _a;
    const path = file.path;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = (_a = pref.volume) != null ? _a : 1;
    const effective = baseVol * (isAmb ? this.settings.ambienceVolume : 1);
    const fadeInMs = pref.fadeInMs != null ? pref.fadeInMs : this.settings.defaultFadeInMs;
    const loopEndTrimSeconds = this.getLoopEndTrimSecondsForPath(path);
    if (!this.settings.allowOverlap) {
      await this.engine.stopByFile(file, 0);
    }
    await this.engine.play(file, {
      volume: effective,
      loop: this.getEffectiveLoopForPath(path),
      fadeInMs,
      loopEndTrimSeconds
    });
  }
  // ===== Playlist runtime control (for UI + playlist note buttons) =====
  isPlaylistActive(playlistPath) {
    const st = this.playlistStates.get(playlistPath);
    return !!(st == null ? void 0 : st.active);
  }
  getActivePlaylistPathForTrackPath(trackPath) {
    for (const st of this.playlistStates.values()) {
      if (st.active && st.currentTrackPath === trackPath) return st.path;
    }
    return null;
  }
  async startPlaylist(pl, selectionIndices) {
    var _a;
    const trackCount = pl.tracks.length;
    if (trackCount === 0) return;
    const st = this.ensurePlaylistState(pl);
    const indices = this.normalizeSelectionIndices(selectionIndices, trackCount);
    if (!indices.length) return;
    const pref = this.getPlaylistPref(pl.path);
    st.indices = pref.shuffle ? this.shuffleArray(indices) : indices;
    st.position = 0;
    const fadeOutMs = (_a = pref.fadeOutMs) != null ? _a : this.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch (e) {
      }
      st.handle = void 0;
    }
    await this.playPlaylistIndex(pl, st, 0);
  }
  async stopPlaylist(playlistPath) {
    var _a;
    const st = this.playlistStates.get(playlistPath);
    if (!st || !st.handle) {
      if (st) {
        st.active = false;
        st.currentTrackPath = void 0;
      }
      return;
    }
    const pref = this.getPlaylistPref(playlistPath);
    const fadeOutMs = (_a = pref.fadeOutMs) != null ? _a : this.settings.defaultFadeOutMs;
    try {
      await st.handle.stop({ fadeOutMs });
    } catch (e) {
    }
    st.handle = void 0;
    st.active = false;
    st.currentTrackPath = void 0;
  }
  async nextInPlaylist(pl) {
    var _a, _b, _c;
    const trackCount = pl.tracks.length;
    if (!trackCount) return;
    const st = this.ensurePlaylistState(pl);
    const pref = this.getPlaylistPref(pl.path);
    if (st.indices.length === 1 && trackCount > 1) {
      const cur = (_b = (_a = st.indices[st.position]) != null ? _a : st.indices[0]) != null ? _b : 0;
      const full = this.buildFullTrackIndexList(trackCount);
      if (pref.shuffle) {
        const rest = full.filter((i) => i !== cur);
        st.indices = [cur, ...this.shuffleArray(rest)];
        st.position = 0;
      } else {
        st.indices = full;
        st.position = Math.max(0, Math.min(trackCount - 1, cur));
      }
    }
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      if (pref.shuffle) st.indices = this.shuffleArray(st.indices);
      st.position = 0;
    }
    const fadeOutMs = (_c = pref.fadeOutMs) != null ? _c : this.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch (e) {
      }
      st.handle = void 0;
    }
    const nextPos = (st.position + 1) % st.indices.length;
    await this.playPlaylistIndex(pl, st, nextPos);
  }
  async prevInPlaylist(pl) {
    var _a, _b, _c;
    const trackCount = pl.tracks.length;
    if (!trackCount) return;
    const st = this.ensurePlaylistState(pl);
    const pref = this.getPlaylistPref(pl.path);
    if (st.indices.length === 1 && trackCount > 1) {
      const cur = (_b = (_a = st.indices[st.position]) != null ? _a : st.indices[0]) != null ? _b : 0;
      const full = this.buildFullTrackIndexList(trackCount);
      if (pref.shuffle) {
        const rest = full.filter((i) => i !== cur);
        st.indices = [cur, ...this.shuffleArray(rest)];
        st.position = 0;
      } else {
        st.indices = full;
        st.position = Math.max(0, Math.min(trackCount - 1, cur));
      }
    }
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      if (pref.shuffle) st.indices = this.shuffleArray(st.indices);
      st.position = 0;
    }
    const fadeOutMs = (_c = pref.fadeOutMs) != null ? _c : this.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch (e) {
      }
      st.handle = void 0;
    }
    const prevPos = (st.position - 1 + st.indices.length) % st.indices.length;
    await this.playPlaylistIndex(pl, st, prevPos);
  }
  ensurePlaylistState(pl) {
    let st = this.playlistStates.get(pl.path);
    if (!st) {
      st = {
        path: pl.path,
        indices: [],
        position: 0,
        active: false
      };
      this.playlistStates.set(pl.path, st);
    }
    const trackCount = pl.tracks.length;
    if (st.indices.length) {
      const maxIndex = trackCount - 1;
      st.indices = st.indices.filter((i) => i >= 0 && i <= maxIndex);
      if (!st.indices.length) {
        st.indices = this.buildFullTrackIndexList(trackCount);
        st.position = 0;
      } else if (st.position >= st.indices.length) {
        st.position = 0;
      }
    }
    return st;
  }
  buildFullTrackIndexList(count) {
    if (count <= 0) return [];
    const arr = [];
    for (let i = 0; i < count; i++) arr.push(i);
    return arr;
  }
  normalizeSelectionIndices(selection, trackCount) {
    if (trackCount <= 0) return [];
    if (!selection || !selection.length) {
      return this.buildFullTrackIndexList(trackCount);
    }
    const maxIndex = trackCount - 1;
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const idx of selection) {
      if (idx < 0 || idx > maxIndex) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      out.push(idx);
    }
    if (!out.length) {
      return this.buildFullTrackIndexList(trackCount);
    }
    return out;
  }
  shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  async playPlaylistIndex(pl, st, position) {
    var _a, _b;
    const trackCount = pl.tracks.length;
    if (!trackCount) {
      st.active = false;
      st.handle = void 0;
      st.currentTrackPath = void 0;
      return;
    }
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      st.position = 0;
    }
    if (position < 0 || position >= st.indices.length) {
      position = 0;
    }
    const trackIdx = st.indices[position];
    if (trackIdx < 0 || trackIdx >= trackCount) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      st.position = 0;
      if (!st.indices.length) {
        st.active = false;
        st.handle = void 0;
        st.currentTrackPath = void 0;
        return;
      }
      await this.playPlaylistIndex(pl, st, 0);
      return;
    }
    const file = pl.tracks[trackIdx];
    const pref = this.getPlaylistPref(pl.path);
    const rawVol = (_a = pref.volume) != null ? _a : 1;
    const effectiveVol = rawVol * (this.isAmbiencePath(file.path) ? this.settings.ambienceVolume : 1);
    const fadeInMs = (_b = pref.fadeInMs) != null ? _b : this.settings.defaultFadeInMs;
    st.position = position;
    st.active = true;
    st.currentTrackPath = file.path;
    try {
      const handle = await this.engine.play(file, {
        volume: effectiveVol,
        loop: false,
        fadeInMs
      });
      st.handle = handle;
      this.playIdToPlaylist.set(handle.id, pl.path);
    } catch (err) {
      console.error("TTRPG Soundboard: failed to play playlist track", pl.path, err);
      st.active = false;
      st.handle = void 0;
      st.currentTrackPath = void 0;
    }
  }
  async onPlaylistTrackEndedNaturally(playlistPath) {
    const pl = this.findPlaylistByPath(playlistPath);
    if (!pl) return;
    const st = this.playlistStates.get(playlistPath);
    if (!st || !st.active) return;
    const trackCount = pl.tracks.length;
    if (!trackCount) {
      st.active = false;
      st.handle = void 0;
      st.currentTrackPath = void 0;
      return;
    }
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      st.position = 0;
    }
    const pref = this.getPlaylistPref(playlistPath);
    const lastPos = st.indices.length - 1;
    const atLast = st.position >= lastPos;
    if (atLast) {
      if (pref.loop) {
        if (pref.shuffle) {
          st.indices = this.shuffleArray(st.indices);
        }
        await this.playPlaylistIndex(pl, st, 0);
      } else {
        st.handle = void 0;
        st.active = false;
        st.currentTrackPath = void 0;
      }
    } else {
      await this.playPlaylistIndex(pl, st, st.position + 1);
    }
  }
  findPlaylistByPath(playlistPath) {
    if (!this.library) return null;
    for (const f of this.library.topFolders) {
      const c = this.library.byFolder[f];
      if (!c) continue;
      const pl = c.playlists.find((p) => p.path === playlistPath);
      if (pl) return pl;
    }
    return null;
  }
  parsePlaylistRangeSpec(rangeSpec, trackCount) {
    if (trackCount <= 0) return [];
    if (!rangeSpec || !rangeSpec.trim()) {
      return this.buildFullTrackIndexList(trackCount);
    }
    const spec = rangeSpec.trim();
    const rangeMatch = spec.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start1 = parseInt(rangeMatch[1], 10);
      const end1 = parseInt(rangeMatch[2], 10);
      if (Number.isNaN(start1) || Number.isNaN(end1)) {
        return [];
      }
      const start = Math.min(start1, end1);
      const end = Math.max(start1, end1);
      const indices = [];
      for (let i = start; i <= end; i++) {
        const zero = i - 1;
        if (zero >= 0 && zero < trackCount) {
          indices.push(zero);
        }
      }
      return indices;
    }
    const singleMatch = spec.match(/^(\d+)$/);
    if (singleMatch) {
      const n = parseInt(singleMatch[1], 10);
      if (Number.isNaN(n)) return [];
      const zero = n - 1;
      if (zero < 0 || zero >= trackCount) return [];
      return [zero];
    }
    return [];
  }
  async handlePlaylistButtonClick(playlistPath, rangeSpec) {
    const pl = this.findPlaylistByPath(playlistPath);
    if (!pl) {
      new import_obsidian9.Notice(`TTRPG Soundboard: playlist not found: ${playlistPath}`);
      return;
    }
    const indices = this.parsePlaylistRangeSpec(rangeSpec, pl.tracks.length);
    if (!indices.length) {
      new import_obsidian9.Notice("Playlist range does not match any tracks.");
      return;
    }
    await this.startPlaylist(pl, indices);
  }
  // ===== Note buttons inside markdown =====
  /**
   * Transform markdown patterns like:
   *   [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg)
   *   [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg "thumbs/rain.png")
   *   [BossFight](ttrpg-playlist:Soundbar/Dungeon/BossFight#1-4)
   * into clickable buttons that trigger playback.
   */
  processNoteButtons(root) {
    var _a, _b, _c, _d;
    const anchors = root.querySelectorAll(
      'a[href^="ttrpg-sound:"], a[href^="ttrpg-playlist:"]'
    );
    for (const a of Array.from(anchors)) {
      const hrefAttr = (_b = (_a = a.getAttribute("data-href")) != null ? _a : a.getAttribute("href")) != null ? _b : "";
      if (!hrefAttr) continue;
      const label = a.textContent || "";
      if (hrefAttr.startsWith("ttrpg-sound:")) {
        const raw = hrefAttr.slice("ttrpg-sound:".length);
        const path = raw.replace(/^\/+/, "");
        const button = document.createElement("button");
        button.classList.add("ttrpg-sb-stop");
        button.dataset.path = path;
        const thumbPath = (_c = a.getAttribute("title")) == null ? void 0 : _c.trim();
        if (thumbPath) {
          const af = this.app.vault.getAbstractFileByPath(thumbPath);
          if (af instanceof import_obsidian9.TFile) {
            const img = document.createElement("img");
            img.src = this.app.vault.getResourcePath(af);
            img.alt = label;
            button.appendChild(img);
            button.title = label;
            button.classList.add("ttrpg-sb-note-thumb");
          } else {
            button.textContent = label;
          }
        } else {
          button.textContent = label;
        }
        button.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void this.handleNoteButtonClick(path);
        };
        this.noteButtons.add(button);
        a.replaceWith(button);
      } else if (hrefAttr.startsWith("ttrpg-playlist:")) {
        const raw = hrefAttr.slice("ttrpg-playlist:".length);
        const [rawPlaylistPath, rangeSpec] = raw.split("#", 2);
        const playlistPath = rawPlaylistPath.replace(/^\/+/, "");
        const button = document.createElement("button");
        button.classList.add("ttrpg-sb-stop");
        button.dataset.playlistPath = playlistPath;
        if (rangeSpec) {
          button.dataset.playlistRange = rangeSpec.trim();
        }
        button.textContent = label || playlistPath;
        button.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void this.handlePlaylistButtonClick(playlistPath, rangeSpec);
        };
        this.noteButtons.add(button);
        a.replaceWith(button);
      }
    }
    const pattern = /\[([^\]]+)\]\((ttrpg-sound|ttrpg-playlist):([^")]+)(?:\s+"([^"]+)")?\)/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.includes("ttrpg-")) {
        const parent = node.parentElement;
        if (parent && (parent.tagName === "CODE" || parent.tagName === "PRE")) {
          continue;
        }
        textNodes.push(node);
      }
    }
    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent) continue;
      const original = (_d = textNode.nodeValue) != null ? _d : "";
      let lastIndex = 0;
      const frag = document.createDocumentFragment();
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(original)) !== null) {
        const [full, label, kind, rawPath, thumbPathRaw] = match;
        const before = original.slice(lastIndex, match.index);
        if (before) {
          frag.appendChild(document.createTextNode(before));
        }
        if (kind === "ttrpg-sound") {
          const path = rawPath.replace(/^\/+/, "");
          const button = document.createElement("button");
          button.classList.add("ttrpg-sb-stop");
          button.dataset.path = path;
          const thumbPath = thumbPathRaw == null ? void 0 : thumbPathRaw.trim();
          if (thumbPath) {
            const af = this.app.vault.getAbstractFileByPath(thumbPath);
            if (af instanceof import_obsidian9.TFile) {
              const img = document.createElement("img");
              img.src = this.app.vault.getResourcePath(af);
              img.alt = label;
              button.appendChild(img);
              button.title = label;
              button.classList.add("ttrpg-sb-note-thumb");
            } else {
              button.textContent = label;
            }
          } else {
            button.textContent = label;
          }
          button.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void this.handleNoteButtonClick(path);
          };
          this.noteButtons.add(button);
          frag.appendChild(button);
        } else {
          const [rawPlaylistPath, rangeSpec] = rawPath.split("#", 2);
          const playlistPath = rawPlaylistPath.replace(/^\/+/, "");
          const button = document.createElement("button");
          button.classList.add("ttrpg-sb-stop");
          button.dataset.playlistPath = playlistPath;
          if (rangeSpec) {
            button.dataset.playlistRange = rangeSpec.trim();
          }
          button.textContent = label;
          button.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void this.handlePlaylistButtonClick(playlistPath, rangeSpec);
          };
          this.noteButtons.add(button);
          frag.appendChild(button);
        }
        lastIndex = match.index + full.length;
      }
      const after = original.slice(lastIndex);
      if (after) {
        frag.appendChild(document.createTextNode(after));
      }
      parent.replaceChild(frag, textNode);
    }
    if (this.noteButtons.size > 0) {
      this.updateNoteButtonsPlayingState();
    }
  }
  async handleNoteButtonClick(path) {
    var _a, _b, _c;
    const af = this.app.vault.getAbstractFileByPath(path);
    if (!(af instanceof import_obsidian9.TFile)) {
      new import_obsidian9.Notice(`TTRPG Soundboard: file not found: ${path}`);
      return;
    }
    const file = af;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = (_a = pref.volume) != null ? _a : 1;
    const effective = baseVol * (isAmb ? this.settings.ambienceVolume : 1);
    const loopEndTrimSeconds = this.getLoopEndTrimSecondsForPath(path);
    const playing = new Set(this.engine.getPlayingFilePaths());
    if (playing.has(path)) {
      await this.engine.stopByFile(file, (_b = pref.fadeOutMs) != null ? _b : this.settings.defaultFadeOutMs);
    } else {
      if (!this.settings.allowOverlap) {
        await this.engine.stopByFile(file, 0);
      }
      await this.engine.play(file, {
        volume: effective,
        loop: this.getEffectiveLoopForPath(path),
        fadeInMs: (_c = pref.fadeInMs) != null ? _c : this.settings.defaultFadeInMs,
        loopEndTrimSeconds
      });
    }
    this.updateNoteButtonsPlayingState();
  }
  updateNoteButtonsPlayingState() {
    if (!this.engine) return;
    const playingPaths = new Set(this.engine.getPlayingFilePaths());
    for (const btn of Array.from(this.noteButtons)) {
      if (!btn.isConnected) {
        this.noteButtons.delete(btn);
        continue;
      }
      const filePath = btn.dataset.path;
      const playlistPath = btn.dataset.playlistPath;
      let active = false;
      if (filePath) {
        active = playingPaths.has(filePath);
      } else if (playlistPath) {
        active = this.isPlaylistActive(playlistPath);
      }
      btn.classList.toggle("playing", active);
    }
  }
  // ===== Insert buttons into active note (from settings modals) =====
  insertSoundButtonIntoActiveNote(filePath) {
    var _a, _b;
    const mdView = (_a = this.lastMarkdownView) != null ? _a : this.app.workspace.getActiveViewOfType(import_obsidian9.MarkdownView);
    if (!mdView) {
      new import_obsidian9.Notice("No active editor to insert button.");
      return;
    }
    const editor = mdView.editor;
    if (!editor) {
      new import_obsidian9.Notice("No editor found for the current view.");
      return;
    }
    const af = this.app.vault.getAbstractFileByPath(filePath);
    const label = af instanceof import_obsidian9.TFile ? af.basename : (_b = filePath.split("/").pop()) != null ? _b : filePath;
    const text = `[${label}](ttrpg-sound:${filePath})`;
    editor.replaceSelection(text);
  }
  insertPlaylistButtonIntoActiveNote(playlistPath) {
    var _a;
    const mdView = (_a = this.lastMarkdownView) != null ? _a : this.app.workspace.getActiveViewOfType(import_obsidian9.MarkdownView);
    if (!mdView) {
      new import_obsidian9.Notice("No active editor to insert button.");
      return;
    }
    const editor = mdView.editor;
    if (!editor) {
      new import_obsidian9.Notice("No editor found for the current view.");
      return;
    }
    const pl = this.findPlaylistByPath(playlistPath);
    if (!pl) {
      new import_obsidian9.Notice(`TTRPG Soundboard: playlist not found: ${playlistPath}`);
      return;
    }
    const count = pl.tracks.length;
    if (!count) {
      new import_obsidian9.Notice("Playlist has no tracks.");
      return;
    }
    const label = pl.name;
    const spec = count === 1 ? "1" : `1-${count}`;
    const text = `[${label}](ttrpg-playlist:${playlistPath}#${spec})`;
    editor.replaceSelection(text);
  }
};
