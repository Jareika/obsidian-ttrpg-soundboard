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
var import_obsidian8 = require("obsidian");

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
      ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
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
    var _a, _b;
    await this.ensureContext();
    const buffer = await this.loadBuffer(file);
    const ctx = this.ctx;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const loop = !!opts.loop;
    source.loop = loop;
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
          if (!ctx || !rec.source) {
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
  stopById(id, sOpts) {
    var _a;
    const rec = this.playing.get(id);
    if (!rec) return Promise.resolve();
    this.playing.delete(id);
    const ctx = this.ctx;
    const fadeOut = ((_a = sOpts == null ? void 0 : sOpts.fadeOutMs) != null ? _a : 0) / 1e3;
    const filePath = rec.file.path;
    const source = rec.source;
    const gain = rec.gain;
    if (!ctx || !source) {
      this.emit({
        type: "stop",
        filePath,
        id,
        reason: "stopped"
      });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      var _a2;
      const n = ctx.currentTime;
      if (fadeOut > 0) {
        gain.gain.cancelScheduledValues(n);
        const cur = gain.gain.value;
        gain.gain.setValueAtTime(cur, n);
        gain.gain.linearRampToValueAtTime(0, n + fadeOut);
        window.setTimeout(() => {
          try {
            source.stop();
          } catch (e) {
          }
          this.emit({
            type: "stop",
            filePath,
            id,
            reason: "stopped"
          });
          resolve();
        }, Math.max(1, (_a2 = sOpts == null ? void 0 : sOpts.fadeOutMs) != null ? _a2 : 0));
      } else {
        try {
          source.stop();
        } catch (e) {
        }
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
  pauseRecord(rec) {
    if (!this.ctx) return;
    if (rec.state !== "playing" || !rec.source) return;
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
  }
  resumeRecord(rec) {
    if (!this.ctx) return;
    if (rec.state !== "paused") return;
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
    let fadeInStr = typeof pref.fadeInMs === "number" ? String(pref.fadeInMs) : "";
    let fadeOutStr = typeof pref.fadeOutMs === "number" ? String(pref.fadeOutMs) : "";
    let vol = typeof pref.volume === "number" ? pref.volume : 1;
    const originalVol = vol;
    let loop = !!pref.loop;
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
    new import_obsidian.Setting(contentEl).setName("Insert note button").setDesc(
      "Insert a Markdown button for this sound into the active note."
    ).addButton(
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
        if (fi != null && Number.isNaN(fi)) return;
        if (fo != null && Number.isNaN(fo)) return;
        pref.fadeInMs = fi;
        pref.fadeOutMs = fo;
        pref.volume = vol;
        pref.loop = loop;
        this.plugin.setSoundPref(this.filePath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton(
      (b) => b.setButtonText("Cancel").onClick(() => {
        this.plugin.applyEffectiveVolumeForSingle(
          this.filePath,
          originalVol
        );
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
    new import_obsidian2.Setting(contentEl).setName("Insert playlist button").setDesc(
      "Insert a Markdown button for this playlist into the active note."
    ).addButton(
      (b) => b.setButtonText("Insert button").onClick(() => {
        this.plugin.insertPlaylistButtonIntoActiveNote(
          this.folderPath
        );
      })
    );
    new import_obsidian2.Setting(contentEl).addButton(
      (b) => b.setButtonText("Restore defaults").onClick(async () => {
        delete pref.fadeInMs;
        delete pref.fadeOutMs;
        delete pref.volume;
        delete pref.loop;
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
        this.plugin.setPlaylistPref(this.folderPath, pref);
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        this.close();
      })
    ).addButton(
      (b) => b.setButtonText("Cancel").onClick(() => {
        this.plugin.updateVolumeForPlaylistFolder(
          this.folderPath,
          originalVol
        );
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
      // legacy "folder" is no longer saved
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
    const rootRegex = rootFolder != null && rootFolder !== "" ? new RegExp(
      `^${rootFolder.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}/?`
    ) : null;
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
        select.createEl("option", {
          text: makeLabel(f),
          value: f
        });
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
        select.createEl("option", {
          text: makeLabel(f),
          value: f
        });
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
      void this.plugin.engine.stopAll(
        this.plugin.settings.defaultFadeOutMs
      );
    };
    const masterGroup = rowControls.createDiv({
      cls: "ttrpg-sb-slider-group"
    });
    masterGroup.createSpan({
      cls: "ttrpg-sb-slider-label",
      text: "Master"
    });
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
    const ambGroup = rowControls.createDiv({
      cls: "ttrpg-sb-slider-group"
    });
    ambGroup.createSpan({
      cls: "ttrpg-sb-slider-label",
      text: "Ambience"
    });
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
    for (const file of content.files) {
      if (useSimple) this.renderSingleRow(container, file);
      else this.renderSingleCard(container, file);
    }
    for (const pl of content.playlists) {
      if (useSimple) this.renderPlaylistRow(container, pl);
      else this.renderPlaylistCard(container, pl);
    }
    this.updatePlayingVisuals();
  }
  // ===================== Singles (grid view) =====================
  renderSingleCard(container, file) {
    var _a;
    const card = container.createDiv({ cls: "ttrpg-sb-card" });
    card.createDiv({ cls: "ttrpg-sb-title", text: file.basename });
    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile",
      attr: { "aria-label": file.basename }
    });
    const thumb = this.findThumbFor(file);
    if (thumb) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(
        thumb
      )})`;
    }
    const pref = this.plugin.getSoundPref(file.path);
    const isAmbience = this.plugin.isAmbiencePath(file.path);
    tile.onclick = async () => {
      var _a2, _b;
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = (_a2 = pref.volume) != null ? _a2 : 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: (_b = pref.fadeInMs) != null ? _b : this.plugin.settings.defaultFadeInMs
      });
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": String(!!pref.loop),
        type: "button"
      }
    });
    (0, import_obsidian3.setIcon)(loopBtn, "repeat");
    const paintLoop = () => {
      loopBtn.toggleClass("active", !!pref.loop);
      loopBtn.setAttr("aria-pressed", String(!!pref.loop));
    };
    paintLoop();
    loopBtn.onclick = async () => {
      pref.loop = !pref.loop;
      this.plugin.setSoundPref(file.path, pref);
      await this.plugin.saveSettings();
      paintLoop();
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.path = file.path;
    if (this.playingFiles.has(file.path)) stopBtn.classList.add("playing");
    stopBtn.onclick = async () => {
      var _a2;
      await this.plugin.engine.stopByFile(
        file,
        (_a2 = pref.fadeOutMs) != null ? _a2 : this.plugin.settings.defaultFadeOutMs
      );
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
      this.plugin.setVolumeForPathFromSlider(
        file.path,
        v,
        inlineVol
      );
    };
    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(
      this.app,
      this.plugin,
      file.path
    ).open();
  }
  // ===================== Singles (simple list view) =====================
  renderSingleRow(container, file) {
    var _a;
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row" });
    row.dataset.path = file.path;
    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({
      cls: "ttrpg-sb-simple-title",
      text: file.basename
    });
    const durationEl = main.createSpan({
      cls: "ttrpg-sb-simple-duration",
      text: ""
    });
    this.plugin.requestDurationFormatted(file, (txt) => {
      if (!durationEl.isConnected) return;
      durationEl.setText(txt);
    });
    const pref = this.plugin.getSoundPref(file.path);
    const isAmbience = this.plugin.isAmbiencePath(file.path);
    main.onclick = async () => {
      var _a2, _b;
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = (_a2 = pref.volume) != null ? _a2 : 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: (_b = pref.fadeInMs) != null ? _b : this.plugin.settings.defaultFadeInMs
      });
    };
    const controls = row.createDiv({
      cls: "ttrpg-sb-simple-controls"
    });
    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": String(!!pref.loop),
        type: "button"
      }
    });
    (0, import_obsidian3.setIcon)(loopBtn, "repeat");
    const paintLoop = () => {
      loopBtn.toggleClass("active", !!pref.loop);
      loopBtn.setAttr("aria-pressed", String(!!pref.loop));
    };
    paintLoop();
    loopBtn.onclick = async () => {
      pref.loop = !pref.loop;
      this.plugin.setSoundPref(file.path, pref);
      await this.plugin.saveSettings();
      paintLoop();
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.path = file.path;
    stopBtn.onclick = async () => {
      var _a2;
      await this.plugin.engine.stopByFile(
        file,
        (_a2 = pref.fadeOutMs) != null ? _a2 : this.plugin.settings.defaultFadeOutMs
      );
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
      this.plugin.setVolumeForPathFromSlider(
        file.path,
        v,
        inlineVol
      );
    };
    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(
      this.app,
      this.plugin,
      file.path
    ).open();
    if (this.playingFiles.has(file.path)) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  findThumbFor(file) {
    var _a, _b;
    const parent = (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const base = file.basename;
    const candidates = ["png", "jpg", "jpeg", "webp"].map(
      (ext) => `${parent}/${base}.${ext}`
    );
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof import_obsidian3.TFile) return af;
    }
    return null;
  }
  // ===================== Playlists =====================
  renderPlaylistCard(container, pl) {
    const card = container.createDiv({
      cls: "ttrpg-sb-card playlist"
    });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });
    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile playlist",
      attr: { "aria-label": pl.name }
    });
    if (pl.cover) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(
        pl.cover
      )})`;
    }
    tile.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };
    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(
      this.app,
      this.plugin,
      pl.path
    ).open();
    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) stopBtn.classList.add("playing");
  }
  renderPlaylistRow(container, pl) {
    const row = container.createDiv({
      cls: "ttrpg-sb-simple-row playlist"
    });
    row.dataset.playlist = pl.path;
    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({
      cls: "ttrpg-sb-simple-title",
      text: pl.name
    });
    main.createSpan({
      cls: "ttrpg-sb-simple-duration",
      text: `${pl.tracks.length} tracks`
    });
    main.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };
    const controls = row.createDiv({
      cls: "ttrpg-sb-simple-controls"
    });
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };
    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(
      this.app,
      this.plugin,
      pl.path
    ).open();
    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  updatePlayingVisuals() {
    const btns = this.contentEl.querySelectorAll(
      ".ttrpg-sb-stop[data-path]"
    );
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
    const rows = this.contentEl.querySelectorAll(
      ".ttrpg-sb-simple-row[data-path]"
    );
    rows.forEach((r) => {
      const p = r.dataset.path || "";
      r.toggleClass("playing", this.playingFiles.has(p));
    });
    const pbtns = this.contentEl.querySelectorAll(
      ".ttrpg-sb-stop[data-playlist]"
    );
    pbtns.forEach((b) => {
      const p = b.dataset.playlist || "";
      const active = this.plugin.isPlaylistActive(p);
      b.toggleClass("playing", active);
    });
    const plRows = this.contentEl.querySelectorAll(
      ".ttrpg-sb-simple-row[data-playlist]"
    );
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
    this.playingPaths = new Set(
      this.plugin.engine.getPlayingFilePaths()
    );
    this.unsubEngine = this.plugin.engine.on(() => {
      this.playingPaths = new Set(
        this.plugin.engine.getPlayingFilePaths()
      );
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
    var _a, _b, _c;
    const af = this.app.vault.getAbstractFileByPath(path);
    const file = af instanceof import_obsidian4.TFile ? af : null;
    const name = (_b = (_a = file == null ? void 0 : file.basename) != null ? _a : path.split("/").pop()) != null ? _b : path;
    const state = this.plugin.engine.getPathPlaybackState(path);
    const isPaused = state === "paused";
    const card = grid.createDiv({ cls: "ttrpg-sb-now-card" });
    if (isPaused) card.addClass("paused");
    card.createDiv({ cls: "ttrpg-sb-now-title", text: name });
    const controls = card.createDiv({ cls: "ttrpg-sb-now-controls" });
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop playing",
      text: "Stop"
    });
    stopBtn.onclick = async () => {
      if (file) {
        await this.plugin.engine.stopByFile(
          file,
          this.plugin.settings.defaultFadeOutMs
        );
      }
    };
    const pauseBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: isPaused ? "Resume" : "Pause"
    });
    pauseBtn.onclick = async () => {
      if (!file) return;
      if (isPaused) {
        await this.plugin.engine.resumeByFile(
          file,
          this.plugin.settings.defaultFadeInMs
        );
      } else {
        await this.plugin.engine.pauseByFile(
          file,
          this.plugin.settings.defaultFadeOutMs
        );
      }
    };
    const volSlider = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";
    const pref = this.plugin.getSoundPref(path);
    volSlider.value = String((_c = pref.volume) != null ? _c : 1);
    this.plugin.registerVolumeSliderForPath(path, volSlider);
    volSlider.oninput = () => {
      const v = Number(volSlider.value);
      this.plugin.setVolumeForPathFromSlider(path, v, volSlider);
    };
  }
};

// settings.ts
var import_obsidian5 = require("obsidian");
var DEFAULT_SETTINGS = {
  rootFolder: "Soundbar",
  includeRootFiles: false,
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3e3,
  defaultFadeOutMs: 3e3,
  allowOverlap: true,
  masterVolume: 1,
  ambienceVolume: 1,
  simpleView: false,
  folderViewModes: {},
  tileHeightPx: 100,
  noteIconSizePx: 40,
  toolbarFourFolders: false,
  maxAudioCacheMB: 512
  // default 512 MB of decoded audio
};
var SoundboardSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    var _a, _b;
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian5.Setting(containerEl).setName("Library").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Root folder").setDesc(
      "Only subfolders under this folder are listed as options."
    ).addText(
      (ti) => ti.setPlaceholder("Soundbar").setValue(this.plugin.settings.rootFolder).onChange((v) => {
        this.plugin.settings.rootFolder = v.trim();
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Include files directly in root").setDesc(
      "If enabled, files directly in the root folder are listed (otherwise only in subfolders)."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.includeRootFiles).onChange((v) => {
        this.plugin.settings.includeRootFiles = v;
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Folders (legacy, comma separated)").setDesc("Used only when the root folder is empty.").addText(
      (ti) => ti.setValue(this.plugin.settings.folders.join(", ")).onChange((v) => {
        this.plugin.settings.folders = v.split(",").map((s) => s.trim()).filter(Boolean);
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Allowed extensions").setDesc("E.g., mp3, ogg, wav, m4a, flac.").addText(
      (ti) => ti.setValue(this.plugin.settings.extensions.join(", ")).onChange((v) => {
        this.plugin.settings.extensions = v.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
        void this.plugin.saveSettings();
        this.plugin.rescan();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Playback").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Fade in (ms)").addText(
      (ti) => ti.setValue(String(this.plugin.settings.defaultFadeInMs)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Fade out (ms)").addText(
      (ti) => ti.setValue(String(this.plugin.settings.defaultFadeOutMs)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Allow overlap").setDesc("Play multiple sounds at the same time.").addToggle(
      (tg) => tg.setValue(this.plugin.settings.allowOverlap).onChange((v) => {
        this.plugin.settings.allowOverlap = v;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Master volume").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.masterVolume).onChange((v) => {
        var _a2;
        this.plugin.settings.masterVolume = v;
        (_a2 = this.plugin.engine) == null ? void 0 : _a2.setMasterVolume(v);
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Decoded audio cache.").setDesc(
      "Upper limit in megabytes for in-memory decoded audio buffers. 0 disables caching (minimal random access memory, more decoding)."
    ).addSlider(
      (s) => s.setLimits(0, 2048, 16).setValue(this.plugin.settings.maxAudioCacheMB).setDynamicTooltip().onChange((v) => {
        var _a2;
        this.plugin.settings.maxAudioCacheMB = v;
        (_a2 = this.plugin.engine) == null ? void 0 : _a2.setCacheLimitMB(v);
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Appearance").setHeading();
    new import_obsidian5.Setting(containerEl).setName("Four pinned folder slots").setDesc(
      "If enabled, show four folder dropdowns in the soundboard toolbar (two rows) instead of two with a switch button."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.toolbarFourFolders).onChange((v) => {
        this.plugin.settings.toolbarFourFolders = v;
        void this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Simple list view (global default)").setDesc(
      "Global default: if no per-folder override exists, folders are shown either as grid or simple list."
    ).addToggle(
      (tg) => tg.setValue(this.plugin.settings.simpleView).onChange((v) => {
        this.plugin.settings.simpleView = v;
        void this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Per-folder view mode").setHeading();
    containerEl.createEl("p", {
      text: "For each folder you can override the global default: inherit, grid, or simple list."
    });
    const lib = this.plugin.library;
    const topFolders = (_a = lib == null ? void 0 : lib.topFolders) != null ? _a : [];
    const rootFolder = lib == null ? void 0 : lib.rootFolder;
    const rootRegex = rootFolder != null && rootFolder !== "" ? new RegExp(
      `^${rootFolder.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}/?`
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
        const setting = new import_obsidian5.Setting(containerEl).setName(label).setDesc(folderPath);
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
    new import_obsidian5.Setting(containerEl).setName("Tile height (px)").setDesc("Adjust thumbnail tile height for the grid.").addSlider(
      (s) => s.setLimits(30, 300, 1).setValue(this.plugin.settings.tileHeightPx).onChange((v) => {
        this.plugin.settings.tileHeightPx = v;
        this.plugin.applyCssVars();
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian5.Setting(containerEl).setName("Note button icon size (px)").setDesc("Height of images used in note buttons.").addSlider(
      (s) => s.setLimits(16, 128, 1).setValue(this.plugin.settings.noteIconSizePx).onChange((v) => {
        this.plugin.settings.noteIconSizePx = v;
        this.plugin.applyCssVars();
        void this.plugin.saveSettings();
      })
    );
  }
};

// util/fileDiscovery.ts
var import_obsidian6 = require("obsidian");
var IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
var AMBIENCE_FOLDER_NAME = "ambience";
function listSubfolders(app, rootFolder) {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof import_obsidian6.TFolder)) return [];
  const subs = af.children.filter((c) => c instanceof import_obsidian6.TFolder).map((c) => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}
function buildLibrary(app, opts) {
  var _a;
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(
      app,
      opts.rootFolder,
      opts.exts,
      !!opts.includeRootFiles
    );
  }
  const folders = ((_a = opts.foldersLegacy) != null ? _a : []).filter(Boolean);
  return buildLibraryFromFolders(app, folders, opts.exts);
}
function buildLibraryFromRoot(app, rootFolder, extensions, includeRootFiles) {
  const root = normalizeFolder(rootFolder);
  const top = listSubfolders(app, root);
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, ""))
  );
  const byFolder = {};
  const allSingles = [];
  if (includeRootFiles) {
    const rootSingles = filesDirectlyIn(app, root, exts);
    allSingles.push(...rootSingles);
  }
  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(app, folder, exts);
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }
  return { rootFolder: root, topFolders: top, byFolder, allSingles };
}
function buildLibraryFromFolders(app, folders, extensions) {
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, ""))
  );
  const top = folders.map((f) => normalizeFolder(f)).filter(Boolean);
  const byFolder = {};
  const allSingles = [];
  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(app, folder, exts);
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }
  return { rootFolder: void 0, topFolders: top, byFolder, allSingles };
}
function filesDirectlyIn(app, folderPath, exts) {
  var _a;
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian6.TFolder)) return [];
  const out = [];
  for (const ch of af.children) {
    if (ch instanceof import_obsidian6.TFile) {
      const ext = (_a = ch.extension) == null ? void 0 : _a.toLowerCase();
      if (ext && exts.has(ext)) out.push(ch);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function directChildPlaylistsAndAmbienceSingles(app, folderPath, exts) {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian6.TFolder))
    return { playlists: [], ambienceSingles: [] };
  const subs = af.children.filter(
    (c) => c instanceof import_obsidian6.TFolder
  );
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
    const cover = findCoverImage(sub);
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
      if (ch instanceof import_obsidian6.TFile) {
        const ext = (_a = ch.extension) == null ? void 0 : _a.toLowerCase();
        if (ext && exts.has(ext)) out.push(ch);
      } else if (ch instanceof import_obsidian6.TFolder) {
        walk(ch);
      }
    }
  };
  walk(folder);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
function findCoverImage(folder) {
  for (const ext of IMG_EXTS) {
    const cand = folder.children.find(
      (ch) => ch instanceof import_obsidian6.TFile && ch.name.toLowerCase() === `cover.${ext}`
    );
    if (cand instanceof import_obsidian6.TFile) return cand;
  }
  const imgs = folder.children.filter(
    (ch) => ch instanceof import_obsidian6.TFile && !!ch.extension && IMG_EXTS.includes(ch.extension.toLowerCase())
  );
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}
function normalizeFolder(p) {
  if (!p) return "";
  return (0, import_obsidian6.normalizePath)(p);
}

// ui/QuickPlayModal.ts
var import_obsidian7 = require("obsidian");
var QuickPlayModal = class extends import_obsidian7.FuzzySuggestModal {
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
function hasSetLibrary(v) {
  return !!v && typeof v === "object" && typeof v["setLibrary"] === "function";
}
var TTRPGSoundboardPlugin = class extends import_obsidian8.Plugin {
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
    this.engine.setCacheLimitMB(this.settings.maxAudioCacheMB);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf == null ? void 0 : leaf.view;
        if (view instanceof import_obsidian8.MarkdownView) {
          this.lastMarkdownView = view;
        }
      })
    );
    const current = this.app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView);
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
          }
        }
      }
      this.updateNoteButtonsPlayingState();
    });
    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf) => new SoundboardView(leaf, this)
    );
    this.registerView(
      VIEW_TYPE_TTRPG_NOWPLAYING,
      (leaf) => new NowPlayingView(leaf, this)
    );
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
        new import_obsidian8.Notice(
          `TTRPG Soundboard: preloaded ${files.length} files.`
        );
      }
    });
    this.addCommand({
      id: "clear-audio-cache",
      name: "Clear decoded audio cache (free RAM)",
      callback: () => {
        this.engine.clearBufferCache();
        new import_obsidian8.Notice("Cleared decoded audio cache.");
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
          new import_obsidian8.Notice("No audio files found in library.");
          return;
        }
        new QuickPlayModal(this.app, this, items).open();
      }
    });
    this.registerEvent(
      this.app.vault.on("create", () => this.rescanDebounced())
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.rescanDebounced())
    );
    this.registerEvent(
      this.app.vault.on(
        "rename",
        (file, oldPath) => {
          if (file instanceof import_obsidian8.TFile) {
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
        }
      )
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
    const h = Math.max(
      30,
      Math.min(400, Number((_a = this.settings.tileHeightPx) != null ? _a : 100))
    );
    document.documentElement.style.setProperty(
      "--ttrpg-tile-height",
      `${h}px`
    );
    const iconSize = Math.max(
      12,
      Math.min(200, Number((_b = this.settings.noteIconSizePx) != null ? _b : 40))
    );
    document.documentElement.style.setProperty(
      "--ttrpg-note-icon-size",
      `${iconSize}px`
    );
  }
  // ===== View activation / library wiring =====
  async activateView() {
    const { workspace } = this.app;
    let sbLeaf;
    const sbLeaves = workspace.getLeavesOfType(
      VIEW_TYPE_TTRPG_SOUNDBOARD
    );
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
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: ((_a = this.settings.rootFolder) == null ? void 0 : _a.trim()) ? void 0 : this.settings.folders,
      exts: this.settings.extensions,
      includeRootFiles: this.settings.includeRootFiles
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
        reject(err);
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
    if (!this.settings.allowOverlap) {
      await this.engine.stopByFile(file, 0);
    }
    await this.engine.play(file, {
      volume: effective,
      loop: !!pref.loop,
      fadeInMs
    });
  }
  // ===== Playlist runtime control (for UI + playlist note buttons) =====
  isPlaylistActive(playlistPath) {
    const st = this.playlistStates.get(playlistPath);
    return !!(st == null ? void 0 : st.active);
  }
  async startPlaylist(pl, selectionIndices) {
    var _a;
    const trackCount = pl.tracks.length;
    if (trackCount === 0) return;
    const st = this.ensurePlaylistState(pl);
    const indices = this.normalizeSelectionIndices(
      selectionIndices,
      trackCount
    );
    if (!indices.length) return;
    st.indices = indices;
    st.position = 0;
    const pref = this.getPlaylistPref(pl.path);
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
  }
  async nextInPlaylist(pl) {
    var _a;
    const trackCount = pl.tracks.length;
    if (!trackCount) return;
    const st = this.ensurePlaylistState(pl);
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      st.position = 0;
    }
    const pref = this.getPlaylistPref(pl.path);
    const fadeOutMs = (_a = pref.fadeOutMs) != null ? _a : this.settings.defaultFadeOutMs;
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
    var _a;
    const trackCount = pl.tracks.length;
    if (!trackCount) return;
    const st = this.ensurePlaylistState(pl);
    if (!st.indices.length) {
      st.indices = this.buildFullTrackIndexList(trackCount);
      st.position = 0;
    }
    const pref = this.getPlaylistPref(pl.path);
    const fadeOutMs = (_a = pref.fadeOutMs) != null ? _a : this.settings.defaultFadeOutMs;
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
      st.indices = st.indices.filter(
        (i) => i >= 0 && i <= maxIndex
      );
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
  async playPlaylistIndex(pl, st, position) {
    var _a, _b;
    const trackCount = pl.tracks.length;
    if (!trackCount) {
      st.active = false;
      st.handle = void 0;
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
        return;
      }
      await this.playPlaylistIndex(pl, st, 0);
      return;
    }
    const file = pl.tracks[trackIdx];
    const pref = this.getPlaylistPref(pl.path);
    const vol = (_a = pref.volume) != null ? _a : 1;
    const fadeInMs = (_b = pref.fadeInMs) != null ? _b : this.settings.defaultFadeInMs;
    st.position = position;
    st.active = true;
    try {
      const handle = await this.engine.play(file, {
        volume: vol,
        loop: false,
        fadeInMs
      });
      st.handle = handle;
      this.playIdToPlaylist.set(handle.id, pl.path);
    } catch (err) {
      console.error(
        "TTRPG Soundboard: failed to play playlist track",
        pl.path,
        err
      );
      st.active = false;
      st.handle = void 0;
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
        await this.playPlaylistIndex(pl, st, 0);
      } else {
        st.handle = void 0;
        st.active = false;
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
      new import_obsidian8.Notice(
        `TTRPG Soundboard: playlist not found: ${playlistPath}`
      );
      return;
    }
    const indices = this.parsePlaylistRangeSpec(
      rangeSpec,
      pl.tracks.length
    );
    if (!indices.length) {
      new import_obsidian8.Notice(
        "Playlist range does not match any tracks."
      );
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
          if (af instanceof import_obsidian8.TFile) {
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
          void this.handlePlaylistButtonClick(
            playlistPath,
            rangeSpec
          );
        };
        this.noteButtons.add(button);
        a.replaceWith(button);
      }
    }
    const pattern = /\[([^\]]+)\]\((ttrpg-sound|ttrpg-playlist):([^")]+)(?:\s+"([^"]+)")?\)/g;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
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
            if (af instanceof import_obsidian8.TFile) {
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
            void this.handlePlaylistButtonClick(
              playlistPath,
              rangeSpec
            );
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
    if (!(af instanceof import_obsidian8.TFile)) {
      new import_obsidian8.Notice(`TTRPG Soundboard: file not found: ${path}`);
      return;
    }
    const file = af;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = (_a = pref.volume) != null ? _a : 1;
    const effective = baseVol * (isAmb ? this.settings.ambienceVolume : 1);
    const playing = new Set(this.engine.getPlayingFilePaths());
    if (playing.has(path)) {
      await this.engine.stopByFile(
        file,
        (_b = pref.fadeOutMs) != null ? _b : this.settings.defaultFadeOutMs
      );
    } else {
      if (!this.settings.allowOverlap) {
        await this.engine.stopByFile(file, 0);
      }
      await this.engine.play(file, {
        volume: effective,
        loop: !!pref.loop,
        fadeInMs: (_c = pref.fadeInMs) != null ? _c : this.settings.defaultFadeInMs
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
    const mdView = (_a = this.lastMarkdownView) != null ? _a : this.app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView);
    if (!mdView) {
      new import_obsidian8.Notice(
        "No active editor to insert button."
      );
      return;
    }
    const editor = mdView.editor;
    if (!editor) {
      new import_obsidian8.Notice(
        "No editor found for the current view."
      );
      return;
    }
    const af = this.app.vault.getAbstractFileByPath(filePath);
    const label = af instanceof import_obsidian8.TFile ? af.basename : (_b = filePath.split("/").pop()) != null ? _b : filePath;
    const text = `[${label}](ttrpg-sound:${filePath})`;
    editor.replaceSelection(text);
  }
  insertPlaylistButtonIntoActiveNote(playlistPath) {
    var _a;
    const mdView = (_a = this.lastMarkdownView) != null ? _a : this.app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView);
    if (!mdView) {
      new import_obsidian8.Notice(
        "No active editor to insert button."
      );
      return;
    }
    const editor = mdView.editor;
    if (!editor) {
      new import_obsidian8.Notice(
        "No editor found for the current view."
      );
      return;
    }
    const pl = this.findPlaylistByPath(playlistPath);
    if (!pl) {
      new import_obsidian8.Notice(
        `TTRPG Soundboard: playlist not found: ${playlistPath}`
      );
      return;
    }
    const count = pl.tracks.length;
    if (!count) {
      new import_obsidian8.Notice("Playlist has no tracks.");
      return;
    }
    const label = pl.name;
    const spec = count === 1 ? "1" : `1-${count}`;
    const text = `[${label}](ttrpg-playlist:${playlistPath}#${spec})`;
    editor.replaceSelection(text);
  }
};
