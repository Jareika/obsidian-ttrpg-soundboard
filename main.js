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
var import_obsidian5 = require("obsidian");

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
      } catch {
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
      const Ctx = window.AudioContext || window.webkitAudioContext;
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
      this.emit({ type: "stop", filePath: file.path, id });
    };
    return {
      id,
      stop: async (sOpts) => this.stopById(id, sOpts)
    };
  }
  async stopById(id, sOpts) {
    const rec = this.playing.get(id);
    if (!rec || rec.stopped) return;
    rec.stopped = true;
    const ctx = this.ctx;
    const fadeOut = (sOpts?.fadeOutMs ?? 0) / 1e3;
    const n = ctx.currentTime;
    if (fadeOut > 0) {
      rec.gain.gain.cancelScheduledValues(n);
      const cur = rec.gain.gain.value;
      rec.gain.gain.setValueAtTime(cur, n);
      rec.gain.gain.linearRampToValueAtTime(0, n + fadeOut);
      setTimeout(() => {
        try {
          rec.source.stop();
        } catch {
        }
        this.playing.delete(id);
        this.emit({ type: "stop", filePath: rec.file.path, id });
      }, Math.max(1, sOpts?.fadeOutMs ?? 0));
    } else {
      try {
        rec.source.stop();
      } catch {
      }
      this.playing.delete(id);
      this.emit({ type: "stop", filePath: rec.file.path, id });
    }
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
var import_obsidian2 = require("obsidian");

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
    new import_obsidian.Setting(contentEl).setName("Fade-In (ms)").setDesc("Leave empty to use global default.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeInMs)).setValue(fadeInStr).onChange((v) => {
      fadeInStr = v;
    }));
    new import_obsidian.Setting(contentEl).setName("Fade-Out (ms)").setDesc("Leave empty to use global default.").addText((ti) => ti.setPlaceholder(String(this.plugin.settings.defaultFadeOutMs)).setValue(fadeOutStr).onChange((v) => {
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

// ui/SoundboardView.ts
var VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";
var SoundboardView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.state = {};
    this.files = [];
    this.playing = /* @__PURE__ */ new Set();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TTRPG_SOUNDBOARD;
  }
  getDisplayText() {
    return "TTRPG Soundboard";
  }
  getIcon() {
    return "music";
  }
  async onOpen() {
    this.playing = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on((e) => {
      if (e.type === "start") this.playing.add(e.filePath);
      else this.playing.delete(e.filePath);
      this.updatePlayingVisuals();
    });
    this.render();
  }
  async onClose() {
    this.unsubEngine?.();
    this.unsubEngine = void 0;
  }
  getState() {
    return { ...this.state };
  }
  async setState(state) {
    this.state = { ...state };
    await this.render();
  }
  setFiles(files) {
    this.files = files;
    this.render();
  }
  filteredFiles() {
    const folder = (this.state.folder || "").replace(/^\/+|\/+$/g, "");
    if (!folder) return this.files;
    return this.files.filter((f) => f.path === folder || f.path.startsWith(folder + "/"));
  }
  findThumbFor(file) {
    const parent = file.parent?.path ?? "";
    const base = file.basename;
    const candidates = ["png", "jpg", "jpeg", "webp"].map((ext) => `${parent}/${base}.${ext}`);
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof import_obsidian2.TFile) return af;
    }
    return null;
  }
  async saveViewState() {
    await this.leaf.setViewState({ type: VIEW_TYPE_TTRPG_SOUNDBOARD, state: this.getState(), active: true });
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });
    const folderSelect = toolbar.createEl("select");
    folderSelect.createEl("option", { text: "All folders", value: "" });
    const opts = (this.plugin.subfolders?.length ? this.plugin.subfolders : this.plugin.settings.folders) ?? [];
    for (const f of opts) {
      const label = this.plugin.subfolders?.length ? f.replace(new RegExp("^" + this.plugin.settings.rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?"), "") : f;
      folderSelect.createEl("option", { text: label, value: f });
    }
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || void 0;
      await this.saveViewState();
      this.render();
    };
    const stopAllBtn = toolbar.createEl("button", { text: "Stop All" });
    stopAllBtn.onclick = () => this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);
    const volInput = toolbar.createEl("input", { type: "range" });
    volInput.min = "0";
    volInput.max = "1";
    volInput.step = "0.01";
    volInput.value = String(this.plugin.settings.masterVolume);
    volInput.oninput = () => {
      const v = Number(volInput.value);
      this.plugin.settings.masterVolume = v;
      this.plugin.engine.setMasterVolume(v);
      this.plugin.saveSettings();
    };
    const grid = contentEl.createDiv({ cls: "ttrpg-sb-grid" });
    for (const file of this.filteredFiles()) {
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
      const loopBtn = controls.createEl("button");
      const paintLoop = () => loopBtn.textContent = pref.loop ? "Loop: On" : "Loop: Off";
      paintLoop();
      loopBtn.onclick = async () => {
        pref.loop = !pref.loop;
        this.plugin.setSoundPref(file.path, pref);
        await this.plugin.saveSettings();
        paintLoop();
      };
      const stopBtn = controls.createEl("button", { text: "Stop" });
      stopBtn.classList.add("ttrpg-sb-stop");
      stopBtn.dataset.path = file.path;
      if (this.playing.has(file.path)) stopBtn.classList.add("playing");
      stopBtn.onclick = async () => {
        await this.plugin.engine.stopByFile(file, pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs);
      };
      const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
      (0, import_obsidian2.setIcon)(gearPerBtn, "gear");
      gearPerBtn.setAttr("aria-label", "Per-title settings");
      gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
    }
  }
  updatePlayingVisuals() {
    const btns = this.contentEl.querySelectorAll(".ttrpg-sb-stop");
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playing.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
  }
};

// settings.ts
var import_obsidian3 = require("obsidian");
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
var SoundboardSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTRPG Soundboard - Settings" });
    new import_obsidian3.Setting(containerEl).setName("Root folder").setDesc("Only subfolders under this folder are listed as options. Example: Soundbar").addText((ti) => ti.setPlaceholder("Soundbar").setValue(this.plugin.settings.rootFolder).onChange(async (v) => {
      this.plugin.settings.rootFolder = v.trim();
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian3.Setting(containerEl).setName("Include files directly in root").setDesc("If enabled, files directly in the root folder are listed (otherwise only in subfolders).").addToggle((tg) => tg.setValue(this.plugin.settings.includeRootFiles).onChange(async (v) => {
      this.plugin.settings.includeRootFiles = v;
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian3.Setting(containerEl).setName("Folders (legacy, comma-separated)").setDesc("Used only when the root folder is empty. Example: TTRPG Sounds, Audio/SFX").addText((ti) => ti.setValue(this.plugin.settings.folders.join(", ")).onChange(async (v) => {
      this.plugin.settings.folders = v.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian3.Setting(containerEl).setName("Allowed extensions").setDesc("Comma-separated, e.g. mp3, ogg, wav, m4a, flac (flac may not be supported on iOS).").addText((ti) => ti.setValue(this.plugin.settings.extensions.join(", ")).onChange(async (v) => {
      this.plugin.settings.extensions = v.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian3.Setting(containerEl).setName("Fade-In (ms)").addText((ti) => ti.setValue(String(this.plugin.settings.defaultFadeInMs)).onChange(async (v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
      await this.plugin.saveSettings();
    }));
    new import_obsidian3.Setting(containerEl).setName("Fade-Out (ms)").addText((ti) => ti.setValue(String(this.plugin.settings.defaultFadeOutMs)).onChange(async (v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
      await this.plugin.saveSettings();
    }));
    new import_obsidian3.Setting(containerEl).setName("Allow overlap").setDesc("Play multiple sounds at the same time.").addToggle((tg) => tg.setValue(this.plugin.settings.allowOverlap).onChange(async (v) => {
      this.plugin.settings.allowOverlap = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian3.Setting(containerEl).setName("Master volume").addSlider((s) => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.masterVolume).onChange(async (v) => {
      this.plugin.settings.masterVolume = v;
      this.plugin.engine?.setMasterVolume(v);
      await this.plugin.saveSettings();
    }));
    new import_obsidian3.Setting(containerEl).setName("Tile height (px)").setDesc("Adjust thumbnail tile height for the grid.").addSlider((s) => s.setLimits(30, 300, 1).setValue(this.plugin.settings.tileHeightPx).onChange(async (v) => {
      this.plugin.settings.tileHeightPx = v;
      this.plugin.applyCssVars();
      await this.plugin.saveSettings();
    }));
  }
};

// util/fileDiscovery.ts
var import_obsidian4 = require("obsidian");
function findAudioFiles(app, folders, extensions) {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const roots = (folders ?? []).map((f) => normalizeFolder(f)).filter(Boolean);
  const out = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof import_obsidian4.TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;
    if (roots.length === 0) {
      out.push(f);
      continue;
    }
    const inRoot = roots.some((r) => f.path === r || f.path.startsWith(r + "/"));
    if (inRoot) out.push(f);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
function listSubfolders(app, rootFolder) {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof import_obsidian4.TFolder)) return [];
  const subs = af.children.filter((c) => c instanceof import_obsidian4.TFolder).map((c) => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}
function findAudioFilesUnderRoot(app, rootFolder, extensions, includeRootFiles = false) {
  const root = normalizeFolder(rootFolder);
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const out = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof import_obsidian4.TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;
    if (f.path === root || f.path.startsWith(root + "/")) {
      if (!includeRootFiles) {
        const parent = f.parent?.path ?? "";
        if (parent === root) continue;
      }
      out.push(f);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
function normalizeFolder(p) {
  return (p || "").replace(/^\/+|\/+$/g, "");
}

// main.ts
var TTRPGSoundboardPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.soundPrefs = {};
    this.allFiles = [];
    this.subfolders = [];
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
    this.addRibbonIcon("music", "Open TTRPG Soundboard", () => this.activateView());
    this.addCommand({ id: "open-soundboard-view", name: "Open Soundboard View", callback: () => this.activateView() });
    this.addCommand({ id: "stop-all-sounds", name: "Stop all sounds", callback: () => this.engine.stopAll(this.settings.defaultFadeOutMs) });
    this.addCommand({ id: "preload-audio", name: "Preload audio buffers", callback: async () => {
      await this.engine.preload(this.allFiles);
      new import_obsidian5.Notice(`Preloaded ${this.allFiles.length} files`);
    } });
    this.addCommand({ id: "reload-audio-list", name: "Reload audio list", callback: () => this.rescan() });
    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian5.TFile) {
        const pref = this.soundPrefs[oldPath];
        if (pref) {
          this.soundPrefs[file.path] = pref;
          delete this.soundPrefs[oldPath];
          this.saveSettings();
        }
      }
      this.rescanDebounced();
    }));
    this.addSettingTab(new SoundboardSettingTab(this.app, this));
    await this.rescan();
  }
  onunload() {
    this.engine?.stopAll(0);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
  }
  // NEW: set CSS variable for tile height
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
      view.setFiles(this.allFiles);
    }
  }
  async rescan() {
    if (this.settings.rootFolder?.trim()) {
      this.subfolders = listSubfolders(this.app, this.settings.rootFolder);
      this.allFiles = findAudioFilesUnderRoot(this.app, this.settings.rootFolder, this.settings.extensions, this.settings.includeRootFiles);
    } else {
      this.subfolders = [];
      this.allFiles = findAudioFiles(this.app, this.settings.folders, this.settings.extensions);
    }
    this.refreshViews();
  }
  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD).forEach((l) => {
      const v = l.view;
      v.setFiles(this.allFiles);
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
  async loadAll() {
    const data = await this.loadData();
    if (data?.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    }
    this.soundPrefs = data?.soundPrefs ?? {};
  }
  async saveSettings() {
    const data = { settings: this.settings, soundPrefs: this.soundPrefs };
    await this.saveData(data);
    this.applyCssVars();
  }
};
//# sourceMappingURL=main.js.map
