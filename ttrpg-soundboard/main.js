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
var import_obsidian6 = require("obsidian");

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
        fn(e);
      } catch (err) {
      }
    });
  }
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
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
      } catch (e) {
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
      ctx.decodeAudioData(arrBuf.slice(0), resolve, reject);
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
      this.emit({ type: "stop", filePath: file.path, id, reason: "ended" });
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
          } catch (e) {
          }
          this.playing.delete(id);
          this.emit({ type: "stop", filePath: rec.file.path, id, reason: "stopped" });
          resolve();
        }, Math.max(1, sOpts?.fadeOutMs ?? 0));
      } else {
        try {
          rec.source.stop();
        } catch (e) {
        }
        this.playing.delete(id);
        this.emit({ type: "stop", filePath: rec.file.path, id, reason: "stopped" });
        resolve();
      }
    });
  }
  async stopByFile(file, fadeOutMs = 0) {
    const targets = [...this.playing.values()].filter((p) => p.file.path === file.path);
    await Promise.all(targets.map((t) => this.stopById(t.id, { fadeOutMs })));
  }
  async stopAll(fadeOutMs = 0) {
    const ids = [...this.playing.keys()];
    await Promise.all(ids.map((id) => this.stopById(id, { fadeOutMs })));
  }
  async preload(files) {
    for (const f of files) {
      try {
        await this.loadBuffer(f);
      } catch (e) {
        console.warn("Preload failed", f.path, e);
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
    this.titleEl.setText("Title settings");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const pref = this.plugin.getSoundPref(this.filePath);
    let fadeInStr = pref.fadeInMs != null ? String(pref.fadeInMs) : "";
    let fadeOutStr = pref.fadeOutMs != null ? String(pref.fadeOutMs) : "";
    let vol = pref.volume ?? 1;
    let loop = !!pref.loop;
    new import_obsidian.Setting(contentEl).setName("Fade-in (ms)").setDesc("Leave empty to use global default.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeInMs)).setValue(fadeInStr).onChange((v) => {
      fadeInStr = v;
    }));
    new import_obsidian.Setting(contentEl).setName("Fade-out (ms)").setDesc("Leave empty to use global default.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeOutMs)).setValue(fadeOutStr).onChange((v) => {
      fadeOutStr = v;
    }));
    new import_obsidian.Setting(contentEl).setName("Volume").setDesc("0\u20131, multiplied by master volume.").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(vol).onChange((v) => {
        vol = v;
      })
    );
    new import_obsidian.Setting(contentEl).setName("Loop by default").addToggle((tg) => tg.setValue(loop).onChange((v) => {
      loop = v;
    }));
    new import_obsidian.Setting(contentEl).addButton((b) => b.setButtonText("Restore defaults").onClick(async () => {
      delete pref.fadeInMs;
      delete pref.fadeOutMs;
      delete pref.volume;
      delete pref.loop;
      this.plugin.setSoundPref(this.filePath, pref);
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      this.close();
    })).addButton((b) => b.setCta().setButtonText("Save").onClick(async () => {
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
    })).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
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
    let fadeInStr = pref.fadeInMs != null ? String(pref.fadeInMs) : "";
    let fadeOutStr = pref.fadeOutMs != null ? String(pref.fadeOutMs) : "";
    let vol = pref.volume ?? 1;
    let loop = !!pref.loop;
    new import_obsidian2.Setting(contentEl).setName("Fade-in (ms)").setDesc("Leer lassen, um den globalen Standard zu verwenden.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeInMs)).setValue(fadeInStr).onChange((v) => {
      fadeInStr = v;
    }));
    new import_obsidian2.Setting(contentEl).setName("Fade-out (ms)").setDesc("Leer lassen, um den globalen Standard zu verwenden.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeOutMs)).setValue(fadeOutStr).onChange((v) => {
      fadeOutStr = v;
    }));
    new import_obsidian2.Setting(contentEl).setName("Volume").setDesc("0\u20131, wird mit der Master-Lautst\xE4rke multipliziert.").addSlider(
      (s) => s.setLimits(0, 1, 0.01).setValue(vol).onChange((v) => {
        vol = v;
      })
    );
    new import_obsidian2.Setting(contentEl).setName("Loop (gesamte Playlist)").addToggle((tg) => tg.setValue(loop).onChange((v) => {
      loop = v;
    }));
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText("Restore defaults").onClick(async () => {
      delete pref.fadeInMs;
      delete pref.fadeOutMs;
      delete pref.volume;
      delete pref.loop;
      this.plugin.setPlaylistPref(this.folderPath, pref);
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      this.close();
    })).addButton((b) => b.setCta().setButtonText("Save").onClick(async () => {
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
    })).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }
};

// ui/SoundboardView.ts
var VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";
var SoundboardView = class extends import_obsidian3.ItemView {
  // id -> playlistPath
  constructor(leaf, plugin) {
    super(leaf);
    this.state = {};
    this.playingFiles = /* @__PURE__ */ new Set();
    // Playlist-Laufzeitstatus pro Playlist-Ordner
    this.playlistStates = /* @__PURE__ */ new Map();
    this.playIdToPlaylist = /* @__PURE__ */ new Map();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TTRPG_SOUNDBOARD;
  }
  getDisplayText() {
    return "TTRPG soundboard";
  }
  getIcon() {
    return "music";
  }
  onOpen() {
    this.playingFiles = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on((e) => {
      if (e.type === "start") {
        this.playingFiles.add(e.filePath);
      } else if (e.type === "stop") {
        this.playingFiles.delete(e.filePath);
        if (e.reason === "ended") {
          const pPath = this.playIdToPlaylist.get(e.id);
          if (pPath) {
            void this.onTrackEndedNaturally(pPath);
          }
        }
        if (e.id) this.playIdToPlaylist.delete(e.id);
      }
      this.updatePlayingVisuals();
    });
    this.render();
  }
  onClose() {
    this.unsubEngine?.();
    this.unsubEngine = void 0;
  }
  getState() {
    return { ...this.state };
  }
  async setState(state) {
    this.state = { ...state };
    this.render();
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
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });
    const folderSelect = toolbar.createEl("select");
    folderSelect.createEl("option", { text: "Alle Ordner", value: "" });
    const topFolders = this.library?.topFolders ?? [];
    for (const f of topFolders) {
      const label = this.library?.rootFolder ? f.replace(new RegExp("^" + this.library.rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?"), "") : f;
      folderSelect.createEl("option", { text: label, value: f });
    }
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || void 0;
      await this.saveViewState();
      this.render();
    };
    const stopAllBtn = toolbar.createEl("button", { text: "Stop all" });
    stopAllBtn.onclick = () => {
      void this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);
    };
    const volInput = toolbar.createEl("input", { type: "range" });
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
    const grid = contentEl.createDiv({ cls: "ttrpg-sb-grid" });
    if (!this.library) {
      grid.createDiv({ text: "Keine Dateien gefunden. Pr\xFCfe die Einstellungen." });
      return;
    }
    const folder = this.state.folder ?? "";
    if (!folder) {
      for (const file of this.library.allSingles) {
        this.renderSingleCard(grid, file);
      }
      this.updatePlayingVisuals();
      return;
    }
    const content = this.library.byFolder[folder];
    if (!content) {
      grid.createDiv({ text: "Ordner-Inhalt nicht gefunden." });
      return;
    }
    for (const file of content.files) {
      this.renderSingleCard(grid, file);
    }
    for (const pl of content.playlists) {
      this.renderPlaylistCard(grid, pl);
    }
    this.updatePlayingVisuals();
  }
  // ===================== Singles =====================
  renderSingleCard(grid, file) {
    const card = grid.createDiv({ cls: "ttrpg-sb-card" });
    card.createDiv({ cls: "ttrpg-sb-title", text: file.basename });
    const tile = card.createEl("button", { cls: "ttrpg-sb-tile", attr: { "aria-label": file.basename } });
    const thumb = this.findThumbFor(file);
    if (thumb) tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(thumb)})`;
    const pref = this.plugin.getSoundPref(file.path);
    tile.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      await this.plugin.engine.play(file, {
        volume: (pref.volume ?? 1) * this.plugin.settings.masterVolume,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs
      });
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: { "aria-label": "Toggle loop", "aria-pressed": String(!!pref.loop), "type": "button" }
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
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.path = file.path;
    if (this.playingFiles.has(file.path)) stopBtn.classList.add("playing");
    stopBtn.onclick = async () => {
      await this.plugin.engine.stopByFile(file, pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs);
    };
    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Per-title settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
  }
  findThumbFor(file) {
    const parent = file.parent?.path ?? "";
    const base = file.basename;
    const candidates = ["png", "jpg", "jpeg", "webp"].map((ext) => `${parent}/${base}.${ext}`);
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof import_obsidian3.TFile) return af;
    }
    return null;
  }
  // ===================== Playlists =====================
  renderPlaylistCard(grid, pl) {
    const card = grid.createDiv({ cls: "ttrpg-sb-card playlist" });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });
    const tile = card.createEl("button", { cls: "ttrpg-sb-tile playlist", attr: { "aria-label": pl.name } });
    if (pl.cover) tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(pl.cover)})`;
    tile.onclick = () => {
      void this.startPlaylist(pl, 0);
    };
    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Vorheriger Titel");
    prevBtn.onclick = () => {
      void this.prevInPlaylist(pl);
    };
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.stopPlaylist(pl);
    };
    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    (0, import_obsidian3.setIcon)(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "N\xE4chster Titel");
    nextBtn.onclick = () => {
      void this.nextInPlaylist(pl);
    };
    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    (0, import_obsidian3.setIcon)(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();
    const st = this.ensurePlaylistState(pl.path);
    if (st.active) stopBtn.classList.add("playing");
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
      } catch (e) {
      }
      st.handle = void 0;
    }
    await this.playPlaylistIndex(pl, Math.max(0, Math.min(startIndex, pl.tracks.length - 1)));
  }
  async playPlaylistIndex(pl, index) {
    const st = this.ensurePlaylistState(pl.path);
    if (pl.tracks.length === 0) return;
    const file = pl.tracks[index];
    const pref = this.plugin.getPlaylistPref(pl.path);
    const vol = (pref.volume ?? 1) * this.plugin.settings.masterVolume;
    const fadeInMs = pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs;
    const handle = await this.plugin.engine.play(file, { volume: vol, loop: false, fadeInMs });
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
      } catch (e) {
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
      } catch (e) {
      }
      st.handle = void 0;
    }
    const next = (st.index + 1) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, next);
  }
  async prevInPlaylist(pl) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;
    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch (e) {
      }
      st.handle = void 0;
    }
    const prev = (st.index - 1 + pl.tracks.length) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, prev);
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
    const btns = this.contentEl.querySelectorAll(".ttrpg-sb-stop[data-path]");
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
    const pbtns = this.contentEl.querySelectorAll(".ttrpg-sb-stop[data-playlist]");
    pbtns.forEach((b) => {
      const p = b.dataset.playlist || "";
      const st = this.playlistStates.get(p);
      b.toggleClass("playing", !!st?.active);
    });
  }
};

// settings.ts
var import_obsidian4 = require("obsidian");
var DEFAULT_SETTINGS = {
  rootFolder: "Soundbar",
  includeRootFiles: false,
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3e3,
  defaultFadeOutMs: 3e3,
  allowOverlap: true,
  masterVolume: 1,
  tileHeightPx: 100
};
var SoundboardSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian4.Setting(containerEl).setName("TTRPG soundboard").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Root folder").setDesc("Only subfolders under this folder are listed as options. Example: Soundbar").addText((ti) => ti.setPlaceholder("Soundbar").setValue(this.plugin.settings.rootFolder).onChange((v) => {
      this.plugin.settings.rootFolder = v.trim();
      void this.plugin.saveSettings();
      this.plugin.rescan();
    }));
    new import_obsidian4.Setting(containerEl).setName("Include files directly in root").setDesc("If enabled, files directly in the root folder are listed (otherwise only in subfolders).").addToggle((tg) => tg.setValue(this.plugin.settings.includeRootFiles).onChange((v) => {
      this.plugin.settings.includeRootFiles = v;
      void this.plugin.saveSettings();
      this.plugin.rescan();
    }));
    new import_obsidian4.Setting(containerEl).setName("Folders (legacy, comma-separated)").setDesc("Used only when the root folder is empty. Example: TTRPG Sounds, Audio/SFX").addText((ti) => ti.setValue(this.plugin.settings.folders.join(", ")).onChange((v) => {
      this.plugin.settings.folders = v.split(",").map((s) => s.trim()).filter(Boolean);
      void this.plugin.saveSettings();
      this.plugin.rescan();
    }));
    new import_obsidian4.Setting(containerEl).setName("Allowed extensions").setDesc("Comma-separated, e.g. mp3, ogg, wav, m4a, flac (flac may not be supported on iOS).").addText((ti) => ti.setValue(this.plugin.settings.extensions.join(", ")).onChange((v) => {
      this.plugin.settings.extensions = v.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
      void this.plugin.saveSettings();
      this.plugin.rescan();
    }));
    new import_obsidian4.Setting(containerEl).setName("Fade-in (ms)").addText((ti) => ti.setValue(String(this.plugin.settings.defaultFadeInMs)).onChange((v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
      void this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("Fade-out (ms)").addText((ti) => ti.setValue(String(this.plugin.settings.defaultFadeOutMs)).onChange((v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
      void this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("Allow overlap").setDesc("Play multiple sounds at the same time.").addToggle((tg) => tg.setValue(this.plugin.settings.allowOverlap).onChange((v) => {
      this.plugin.settings.allowOverlap = v;
      void this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("Master volume").addSlider((s) => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.masterVolume).onChange((v) => {
      this.plugin.settings.masterVolume = v;
      this.plugin.engine?.setMasterVolume(v);
      void this.plugin.saveSettings();
    }));
    new import_obsidian4.Setting(containerEl).setName("Tile height (px)").setDesc("Adjust thumbnail tile height for the grid.").addSlider((s) => s.setLimits(30, 300, 1).setValue(this.plugin.settings.tileHeightPx).onChange((v) => {
      this.plugin.settings.tileHeightPx = v;
      this.plugin.applyCssVars();
      void this.plugin.saveSettings();
    }));
  }
};

// util/fileDiscovery.ts
var import_obsidian5 = require("obsidian");
var IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
function listSubfolders(app, rootFolder) {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof import_obsidian5.TFolder)) return [];
  const subs = af.children.filter((c) => c instanceof import_obsidian5.TFolder).map((c) => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}
function buildLibrary(app, opts) {
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(app, opts.rootFolder, opts.exts, !!opts.includeRootFiles);
  }
  const folders = (opts.foldersLegacy ?? []).filter(Boolean);
  return buildLibraryFromFolders(app, folders, opts.exts);
}
function buildLibraryFromRoot(app, rootFolder, extensions, includeRootFiles) {
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
    const playlists = directChildPlaylists(app, folder, exts);
    byFolder[folder] = { folder, files, playlists };
    allSingles.push(...files);
  }
  return { rootFolder: root, topFolders: top, byFolder, allSingles };
}
function buildLibraryFromFolders(app, folders, extensions) {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const top = folders.map((f) => normalizeFolder(f)).filter(Boolean);
  const byFolder = {};
  const allSingles = [];
  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const playlists = directChildPlaylists(app, folder, exts);
    byFolder[folder] = { folder, files, playlists };
    allSingles.push(...files);
  }
  return { rootFolder: void 0, topFolders: top, byFolder, allSingles };
}
function filesDirectlyIn(app, folderPath, exts) {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian5.TFolder)) return [];
  const out = [];
  for (const ch of af.children) {
    if (ch instanceof import_obsidian5.TFile) {
      const ext = ch.extension?.toLowerCase();
      if (ext && exts.has(ext)) out.push(ch);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function directChildPlaylists(app, folderPath, exts) {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof import_obsidian5.TFolder)) return [];
  const subs = af.children.filter((c) => c instanceof import_obsidian5.TFolder);
  const out = [];
  for (const sub of subs) {
    const tracks = collectAudioRecursive(sub, exts);
    if (tracks.length === 0) continue;
    const cover = findCoverImage(sub);
    out.push({
      path: sub.path,
      name: sub.name,
      parent: folderPath,
      tracks,
      cover
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function collectAudioRecursive(folder, exts) {
  const out = [];
  const walk = (f) => {
    for (const ch of f.children) {
      if (ch instanceof import_obsidian5.TFile) {
        const ext = ch.extension?.toLowerCase();
        if (ext && exts.has(ext)) out.push(ch);
      } else if (ch instanceof import_obsidian5.TFolder) {
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
    const cand = folder.children.find((ch) => ch instanceof import_obsidian5.TFile && ch.name.toLowerCase() === `cover.${ext}`);
    if (cand instanceof import_obsidian5.TFile) return cand;
  }
  const imgs = folder.children.filter((ch) => ch instanceof import_obsidian5.TFile && IMG_EXTS.includes(ch.extension.toLowerCase()));
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}
function normalizeFolder(p) {
  return (p || "").replace(/^\/+|\/+$/g, "");
}

// main.ts
var TTRPGSoundboardPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.soundPrefs = {};
    this.playlistPrefs = {};
    this.library = { topFolders: [], byFolder: {}, allSingles: [] };
    this.rescanTimer = null;
  }
  async onload() {
    await this.loadAll();
    this.applyCssVars();
    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);
    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf) => new SoundboardView(leaf, this)
    );
    this.addRibbonIcon("music", "Open soundboard", () => {
      void this.activateView();
    });
    this.addCommand({ id: "open-soundboard-view", name: "Open soundboard view", callback: () => {
      void this.activateView();
    } });
    this.addCommand({ id: "stop-all-sounds", name: "Stop all sounds", callback: () => {
      void this.engine.stopAll(this.settings.defaultFadeOutMs);
    } });
    this.addCommand({
      id: "preload-audio",
      name: "Preload audio buffers",
      callback: async () => {
        const files = this.getAllAudioFilesInLibrary();
        await this.engine.preload(files);
        new import_obsidian6.Notice(`Preloaded ${files.length} files`);
      }
    });
    this.addCommand({ id: "reload-audio-list", name: "Reload audio list", callback: () => this.rescan() });
    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian6.TFile) {
        const sp = this.soundPrefs[oldPath];
        if (sp) {
          this.soundPrefs[file.path] = sp;
          delete this.soundPrefs[oldPath];
          void this.saveSettings();
        }
      }
      this.rescanDebounced();
    }));
    this.addSettingTab(new SoundboardSettingTab(this.app, this));
    this.rescan();
  }
  onunload() {
    void this.engine?.stopAll(0);
  }
  // CSS-Variable für Kachel-Höhe
  applyCssVars() {
    const h = Math.max(30, Math.min(400, Number(this.settings.tileHeightPx || 100)));
    document.documentElement.style.setProperty("--ttrpg-tile-height", `${h}px`);
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    if (leaves.length) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_TTRPG_SOUNDBOARD, active: true });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      const view = leaf.view;
      view.setLibrary(this.library);
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
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD).forEach((l) => {
      const v = l.view;
      v.setLibrary(this.library);
    });
  }
  rescanDebounced(delay = 300) {
    if (this.rescanTimer) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(() => this.rescan(), delay);
  }
  getSoundPref(path) {
    return this.soundPrefs[path] ?? (this.soundPrefs[path] = {});
  }
  setSoundPref(path, pref) {
    this.soundPrefs[path] = pref;
  }
  getPlaylistPref(folderPath) {
    return this.playlistPrefs[folderPath] ?? (this.playlistPrefs[folderPath] = {});
  }
  setPlaylistPref(folderPath, pref) {
    this.playlistPrefs[folderPath] = pref;
  }
  async loadAll() {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...data?.settings ?? {} };
    this.soundPrefs = data?.soundPrefs ?? {};
    this.playlistPrefs = data?.playlistPrefs ?? {};
  }
  async saveSettings() {
    const data = { settings: this.settings, soundPrefs: this.soundPrefs, playlistPrefs: this.playlistPrefs };
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
};
