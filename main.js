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
var import_obsidian7 = require("obsidian");

// audio/AudioEngine.ts
var AudioEngine = class {
  constructor(app) {
    this.ctx = null;
    this.masterGain = null;
    this.buffers = /* @__PURE__ */ new Map();
    this.playing = /* @__PURE__ */ new Map();
    this.masterVolume = 1;
    this.listeners = /* @__PURE__ */ new Set();
    this.app = app;
  }
  on(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(e) {
    this.listeners.forEach((fn) => {
      try {
        void fn(e);
      } catch {
      }
    });
  }
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        this.masterVolume,
        this.ctx.currentTime
      );
    }
  }
  async ensureContext() {
    if (!this.ctx) {
      const w = window;
      const Ctx = window.AudioContext ?? w.webkitAudioContext;
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
      }
    }
  }
  async loadBuffer(file) {
    const key = file.path;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const bin = await this.app.vault.readBinary(file);
    await this.ensureContext();
    const ctx = this.ctx;
    const arrBuf = bin instanceof ArrayBuffer ? bin : new Uint8Array(bin).buffer;
    const audioBuffer = await new Promise((resolve, reject) => {
      void ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
    });
    this.buffers.set(key, audioBuffer);
    return audioBuffer;
  }
  async play(file, opts = {}) {
    await this.ensureContext();
    const buffer = await this.loadBuffer(file);
    const ctx = this.ctx;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = !!opts.loop;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.masterGain);
    const now = ctx.currentTime;
    const targetVol = Math.max(0, Math.min(1, opts.volume ?? 1));
    const fadeIn = (opts.fadeInMs ?? 0) / 1e3;
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
        reason: "ended"
      });
    };
    return {
      id,
      stop: (sOpts) => this.stopById(id, sOpts)
    };
  }
  stopById(id, sOpts) {
    const rec = this.playing.get(id);
    if (!rec || rec.stopped) return Promise.resolve();
    rec.stopped = true;
    const ctx = this.ctx;
    const fadeOut = (sOpts?.fadeOutMs ?? 0) / 1e3;
    const n = ctx.currentTime;
    return new Promise((resolve) => {
      if (fadeOut > 0) {
        rec.gain.gain.cancelScheduledValues(n);
        const cur = rec.gain.gain.value;
        rec.gain.gain.setValueAtTime(cur, n);
        rec.gain.gain.linearRampToValueAtTime(0, n + fadeOut);
        window.setTimeout(() => {
          try {
            rec.source.stop();
          } catch {
          }
          this.playing.delete(id);
          this.emit({
            type: "stop",
            filePath: rec.file.path,
            id,
            reason: "stopped"
          });
          resolve();
        }, Math.max(1, sOpts?.fadeOutMs ?? 0));
      } else {
        try {
          rec.source.stop();
        } catch {
        }
        this.playing.delete(id);
        this.emit({
          type: "stop",
          filePath: rec.file.path,
          id,
          reason: "stopped"
        });
        resolve();
      }
    });
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
   * Set the volume (0..1) for all currently playing instances
   * of a given file path (this does not touch the global master gain).
   */
  setVolumeForPath(path, volume) {
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
  getPlayingFilePaths() {
    const set = /* @__PURE__ */ new Set();
    for (const v of this.playing.values()) set.add(v.file.path);
    return [...set];
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
        this.plugin.updateVolumeForPlaylistFolder(this.folderPath, vol);
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Loop playlist").addToggle(
      (tg) => tg.setValue(loop).onChange((v) => {
        loop = v;
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
    // Runtime status per playlist folder (path -> playback state)
    this.playlistStates = /* @__PURE__ */ new Map();
    this.playIdToPlaylist = /* @__PURE__ */ new Map();
    // play id -> playlistPath
    // Cache for formatted duration (mm:ss) per file path
    this.durationCache = /* @__PURE__ */ new Map();
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
        const playlistPath = this.playIdToPlaylist.get(e.id);
        if (playlistPath && e.reason === "ended") {
          void this.onTrackEndedNaturally(playlistPath);
        }
        if (e.id) this.playIdToPlaylist.delete(e.id);
      }
      this.updatePlayingVisuals();
    });
    this.render();
  }
  onClose() {
    this.contentEl.removeClass("ttrpg-sb-view");
    this.unsubEngine?.();
    this.unsubEngine = void 0;
  }
  getState() {
    return {
      folderA: this.state.folderA,
      folderB: this.state.folderB,
      folderC: this.state.folderC,
      folderD: this.state.folderD,
      activeSlot: this.state.activeSlot ?? "A"
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
    const slot = this.state.activeSlot ?? "A";
    if (slot === "A") return this.state.folderA ?? "";
    if (slot === "B") return this.state.folderB ?? "";
    if (slot === "C") return this.state.folderC ?? "";
    return this.state.folderD ?? "";
  }
  render() {
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
    const topFolders = library?.topFolders ?? [];
    const rootFolder = library?.rootFolder;
    const rootRegex = rootFolder != null && rootFolder !== "" ? new RegExp(
      `^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`
    ) : null;
    const makeLabel = (f) => rootRegex ? f.replace(rootRegex, "") || f : f;
    const folderA = this.state.folderA ?? "";
    const folderB = this.state.folderB ?? "";
    const folderC = this.state.folderC ?? "";
    const folderD = this.state.folderD ?? "";
    const activeSlot = this.state.activeSlot ?? "A";
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
        const current = this.state.activeSlot ?? "A";
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
  // ===================== Helpers: duration =====================
  formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  async fillDuration(file, span) {
    const cached = this.durationCache.get(file.path);
    if (cached != null) {
      if (cached) span.setText(cached);
      return;
    }
    try {
      const buffer = await this.plugin.engine.loadBuffer(file);
      const dur = this.formatDuration(buffer.duration);
      this.durationCache.set(file.path, dur);
      if (dur) span.setText(dur);
    } catch {
      this.durationCache.set(file.path, "");
    }
  }
  // ===================== Singles (grid view) =====================
  renderSingleCard(container, file) {
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
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs
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
      await this.plugin.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs
      );
    };
    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);
    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };
    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
  }
  // ===================== Singles (simple list view) =====================
  renderSingleRow(container, file) {
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
    void this.fillDuration(file, durationEl);
    const pref = this.plugin.getSoundPref(file.path);
    const isAmbience = this.plugin.isAmbiencePath(file.path);
    main.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);
      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs
      });
    };
    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });
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
      await this.plugin.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs
      );
    };
    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);
    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };
    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
    if (this.playingFiles.has(file.path)) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  findThumbFor(file) {
    const parent = file.parent?.path ?? "";
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
    const card = container.createDiv({ cls: "ttrpg-sb-card playlist" });
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
      void this.startPlaylist(pl, 0);
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.stopPlaylist(pl);
    };
    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();
    const st = this.ensurePlaylistState(pl.path);
    if (st.active) stopBtn.classList.add("playing");
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
      void this.startPlaylist(pl, 0);
    };
    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop"
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.stopPlaylist(pl);
    };
    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn"
    });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right"
    });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();
    const st = this.ensurePlaylistState(pl.path);
    if (st.active) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }
  ensurePlaylistState(pPath) {
    let st = this.playlistStates.get(pPath);
    if (!st) {
      st = { index: 0, active: false };
      this.playlistStates.set(pPath, st);
    }
    return st;
  }
  async startPlaylist(pl, startIndex = 0) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
      }
      st.handle = void 0;
    }
    await this.playPlaylistIndex(
      pl,
      Math.max(0, Math.min(startIndex, pl.tracks.length - 1))
    );
  }
  async playPlaylistIndex(pl, index) {
    const st = this.ensurePlaylistState(pl.path);
    if (pl.tracks.length === 0) return;
    const file = pl.tracks[index];
    const pref = this.plugin.getPlaylistPref(pl.path);
    const vol = pref.volume ?? 1;
    const fadeInMs = pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs;
    const handle = await this.plugin.engine.play(file, {
      volume: vol,
      loop: false,
      fadeInMs
    });
    st.index = index;
    st.handle = handle;
    st.active = true;
    this.playIdToPlaylist.set(handle.id, pl.path);
    this.updatePlayingVisuals();
  }
  async stopPlaylist(pl) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
      }
      st.handle = void 0;
    }
    st.active = false;
    this.updatePlayingVisuals();
  }
  async nextInPlaylist(pl) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
      }
      st.handle = void 0;
    }
    const nextIndex = (st.index + 1) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, nextIndex);
  }
  async prevInPlaylist(pl) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
      }
      st.handle = void 0;
    }
    const prevIndex = (st.index - 1 + pl.tracks.length) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, prevIndex);
  }
  async onTrackEndedNaturally(pPath) {
    const st = this.ensurePlaylistState(pPath);
    if (!st.active) return;
    const pl = this.findPlaylistByPath(pPath);
    if (!pl) return;
    const pref = this.plugin.getPlaylistPref(pl.path);
    const atLast = st.index >= pl.tracks.length - 1;
    if (atLast) {
      if (pref.loop) {
        await this.playPlaylistIndex(pl, 0);
      } else {
        st.handle = void 0;
        st.active = false;
        this.updatePlayingVisuals();
      }
    } else {
      await this.playPlaylistIndex(pl, st.index + 1);
    }
  }
  findPlaylistByPath(pPath) {
    if (!this.library) return null;
    for (const f of this.library.topFolders) {
      const c = this.library.byFolder[f];
      if (!c) continue;
      const pl = c.playlists.find((p) => p.path === pPath);
      if (pl) return pl;
    }
    return null;
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
      const st = this.playlistStates.get(p);
      b.toggleClass("playing", !!st?.active);
    });
    const plRows = this.contentEl.querySelectorAll(
      ".ttrpg-sb-simple-row[data-playlist]"
    );
    plRows.forEach((r) => {
      const p = r.dataset.playlist || "";
      const st = this.playlistStates.get(p);
      r.toggleClass("playing", !!st?.active);
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
    this.contentEl.removeClass("ttrpg-sb-view");
    this.unsubEngine?.();
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
    const af = this.app.vault.getAbstractFileByPath(path);
    const file = af instanceof import_obsidian4.TFile ? af : null;
    const name = file?.basename ?? path.split("/").pop() ?? path;
    const card = grid.createDiv({ cls: "ttrpg-sb-now-card" });
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
    const volSlider = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume"
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";
    const pref = this.plugin.getSoundPref(path);
    volSlider.value = String(pref.volume ?? 1);
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
  toolbarFourFolders: false
};
var SoundboardSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
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
        this.plugin.settings.masterVolume = v;
        this.plugin.engine?.setMasterVolume(v);
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
    const topFolders = lib?.topFolders ?? [];
    const rootFolder = lib?.rootFolder;
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
        const map = this.plugin.settings.folderViewModes ?? {};
        const override = map[folderPath];
        const setting = new import_obsidian5.Setting(containerEl).setName(label).setDesc(folderPath);
        const globalIsSimple = this.plugin.settings.simpleView;
        const inheritLabel = globalIsSimple ? "Inherit (simple list)" : "Inherit (grid)";
        setting.addDropdown((dd) => {
          dd.addOption("inherit", inheritLabel);
          dd.addOption("grid", "Grid");
          dd.addOption("simple", "Simple list");
          const current = override ?? "inherit";
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
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(
      app,
      opts.rootFolder,
      opts.exts,
      !!opts.includeRootFiles
    );
  }
  const folders = (opts.foldersLegacy ?? []).filter(Boolean);
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
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian6.TFolder)) return [];
  const out = [];
  for (const ch of af.children) {
    if (ch instanceof import_obsidian6.TFile) {
      const ext = ch.extension?.toLowerCase();
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
    for (const ch of f.children) {
      if (ch instanceof import_obsidian6.TFile) {
        const ext = ch.extension?.toLowerCase();
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

// main.ts
function hasSetLibrary(v) {
  return !!v && typeof v === "object" && typeof v["setLibrary"] === "function";
}
var TTRPGSoundboardPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.soundPrefs = {};
    this.playlistPrefs = {};
    this.library = { topFolders: [], byFolder: {}, allSingles: [] };
    // Note buttons inside markdown documents
    this.noteButtons = /* @__PURE__ */ new Set();
    // Registry of volume sliders per file path (soundboard view + now playing)
    this.volumeSliders = /* @__PURE__ */ new Map();
    this.rescanTimer = null;
  }
  async onload() {
    await this.loadAll();
    this.applyCssVars();
    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);
    this.engineNoteUnsub = this.engine.on(() => {
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
        new import_obsidian7.Notice(`Preloaded ${files.length} files`);
      }
    });
    this.addCommand({
      id: "reload-audio-list",
      name: "Reload audio list",
      callback: () => this.rescan()
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
          if (file instanceof import_obsidian7.TFile) {
            const sp = this.soundPrefs[oldPath];
            if (sp) {
              this.soundPrefs[file.path] = sp;
              delete this.soundPrefs[oldPath];
              void this.saveSettings();
            }
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
    void this.engine?.stopAll(0);
    this.engineNoteUnsub?.();
    this.noteButtons.clear();
    this.volumeSliders.clear();
  }
  // ===== CSS helper =====
  applyCssVars() {
    const h = Math.max(
      30,
      Math.min(400, Number(this.settings.tileHeightPx || 100))
    );
    document.documentElement.style.setProperty(
      "--ttrpg-tile-height",
      `${h}px`
    );
    const iconSize = Math.max(
      12,
      Math.min(200, Number(this.settings.noteIconSizePx || 40))
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
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: this.settings.rootFolder?.trim() ? void 0 : this.settings.folders,
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
    return this.soundPrefs[path] ??= {};
  }
  setSoundPref(path, pref) {
    this.soundPrefs[path] = pref;
  }
  getPlaylistPref(folderPath) {
    return this.playlistPrefs[folderPath] ??= {};
  }
  setPlaylistPref(folderPath, pref) {
    this.playlistPrefs[folderPath] = pref;
  }
  // ===== Persistence =====
  async loadAll() {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...data?.settings ?? {} };
    this.soundPrefs = data?.soundPrefs ?? {};
    this.playlistPrefs = data?.playlistPrefs ?? {};
  }
  async saveSettings() {
    const data = {
      settings: this.settings,
      soundPrefs: this.soundPrefs,
      playlistPrefs: this.playlistPrefs
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
    const playingPaths = this.engine.getPlayingFilePaths();
    for (const path of playingPaths) {
      if (!this.isAmbiencePath(path)) continue;
      const base = this.getSoundPref(path).volume ?? 1;
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
  /**
   * Determine whether the given folder should be shown as simple list.
   * If there is an override in folderViewModes, that is used; otherwise the
   * global simpleView flag is used.
   */
  isSimpleViewForFolder(folderPath) {
    const key = folderPath || "";
    const override = this.settings.folderViewModes?.[key];
    if (override === "grid") return false;
    if (override === "simple") return true;
    return this.settings.simpleView;
  }
  /**
   * Set view mode for a folder:
   *  - "inherit" => remove override, fall back to global simpleView
   *  - "grid" or "simple" => fixed mode for this folder
   */
  setFolderViewMode(folderPath, mode) {
    const key = folderPath || "";
    const map = this.settings.folderViewModes ?? {};
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
  // ===== Note buttons inside markdown =====
  /**
   * Transform markdown patterns like:
   *   Play [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg)
   *   Play [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg "thumbs/rain.png")
   * into clickable buttons that trigger playback.
   *
   * We do NOT rely on Obsidian turning this into <a> tags, because in some
   * cases it keeps the markdown as plain text. Instead we scan text nodes
   * and replace the matching parts with <button> elements.
   */
  processNoteButtons(root) {
    const pattern = /\[([^\]]+)\]\(ttrpg-sound:([^")]+)(?:\s+"([^"]+)")?\)/g;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.includes("ttrpg-sound:")) {
        textNodes.push(node);
      }
    }
    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent) continue;
      const original = textNode.nodeValue ?? "";
      let lastIndex = 0;
      const frag = document.createDocumentFragment();
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(original)) !== null) {
        const [full, label, rawPath, thumbPathRaw] = match;
        const before = original.slice(lastIndex, match.index);
        if (before) {
          frag.appendChild(document.createTextNode(before));
        }
        const path = rawPath.replace(/^\/+/, "");
        const button = document.createElement("button");
        button.classList.add("ttrpg-sb-stop");
        button.dataset.path = path;
        const thumbPath = thumbPathRaw?.trim();
        if (thumbPath) {
          const af = this.app.vault.getAbstractFileByPath(thumbPath);
          if (af instanceof import_obsidian7.TFile) {
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
    const af = this.app.vault.getAbstractFileByPath(path);
    if (!(af instanceof import_obsidian7.TFile)) {
      new import_obsidian7.Notice(`TTRPG Soundboard: file not found: ${path}`);
      return;
    }
    const file = af;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = pref.volume ?? 1;
    const effective = baseVol * (isAmb ? this.settings.ambienceVolume : 1);
    const playing = new Set(this.engine.getPlayingFilePaths());
    if (playing.has(path)) {
      await this.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.settings.defaultFadeOutMs
      );
    } else {
      if (!this.settings.allowOverlap) {
        await this.engine.stopByFile(file, 0);
      }
      await this.engine.play(file, {
        volume: effective,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.settings.defaultFadeInMs
      });
    }
    this.updateNoteButtonsPlayingState();
  }
  updateNoteButtonsPlayingState() {
    if (!this.engine) return;
    const playing = new Set(this.engine.getPlayingFilePaths());
    for (const btn of Array.from(this.noteButtons)) {
      if (!btn.isConnected) {
        this.noteButtons.delete(btn);
        continue;
      }
      const path = btn.dataset.path || "";
      btn.classList.toggle("playing", playing.has(path));
    }
  }
};
