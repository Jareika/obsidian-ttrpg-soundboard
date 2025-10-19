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
var import_obsidian4 = require("obsidian");

// audio/AudioEngine.ts
var AudioEngine = class {
  constructor(app) {
    this.ctx = null;
    this.masterGain = null;
    this.buffers = /* @__PURE__ */ new Map();
    this.playing = /* @__PURE__ */ new Map();
    this.masterVolume = 1;
    this.app = app;
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
    source.onended = () => {
      const r = this.playing.get(id);
      if (!r || r.stopped) return;
      this.playing.delete(id);
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
      }, Math.max(1, sOpts?.fadeOutMs ?? 0));
    } else {
      try {
        rec.source.stop();
      } catch {
      }
      this.playing.delete(id);
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
};

// ui/SoundboardView.ts
var import_obsidian = require("obsidian");
var VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";
var SoundboardView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.state = {};
    this.files = [];
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
    this.render();
  }
  async onClose() {
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
      if (af && af instanceof import_obsidian.TFile) return af;
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
    folderSelect.createEl("option", { text: "Alle Ordner", value: "" });
    for (const f of this.plugin.settings.folders) folderSelect.createEl("option", { text: f, value: f });
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || void 0;
      await this.saveViewState();
      this.render();
    };
    const reloadBtn = toolbar.createEl("button", { text: "Reload" });
    reloadBtn.onclick = () => this.plugin.rescan();
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
      const tile = card.createEl("button", { cls: "ttrpg-sb-tile", attr: { "aria-label": file.basename } });
      const thumb = this.findThumbFor(file);
      if (thumb) tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(thumb)})`;
      tile.createSpan({ cls: "ttrpg-sb-tile-label", text: file.basename });
      const pref = this.plugin.getSoundPref(file.path);
      tile.onclick = async () => {
        if (!this.plugin.settings.allowOverlap) {
          await this.plugin.engine.stopByFile(file, 0);
        }
        await this.plugin.engine.play(file, {
          volume: (pref.volume ?? 1) * this.plugin.settings.masterVolume,
          loop: !!pref.loop,
          fadeInMs: this.plugin.settings.defaultFadeInMs
        });
      };
      const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });
      const loopBtn = controls.createEl("button");
      const updateLoop = () => loopBtn.textContent = `Loop: ${pref.loop ? "On" : "Off"}`;
      updateLoop();
      loopBtn.onclick = async () => {
        pref.loop = !pref.loop;
        this.plugin.setSoundPref(file.path, pref);
        await this.plugin.saveSettings();
        updateLoop();
      };
      const stopBtn = controls.createEl("button", { text: "Stop" });
      stopBtn.onclick = async () => {
        await this.plugin.engine.stopByFile(file, this.plugin.settings.defaultFadeOutMs);
      };
      const volRow = card.createDiv({ cls: "ttrpg-sb-volrow" });
      volRow.createSpan({ text: "Vol " });
      const perVol = volRow.createEl("input", { type: "range" });
      perVol.min = "0";
      perVol.max = "1";
      perVol.step = "0.01";
      perVol.value = String(pref.volume ?? 1);
      perVol.oninput = async () => {
        pref.volume = Number(perVol.value);
        this.plugin.setSoundPref(file.path, pref);
        await this.plugin.saveSettings();
      };
    }
  }
};

// settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3e3,
  defaultFadeOutMs: 3e3,
  allowOverlap: true,
  masterVolume: 1
};
var SoundboardSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTRPG Soundboard \uFFFD Einstellungen" });
    new import_obsidian2.Setting(containerEl).setName("Ordner (kommagetrennt)").setDesc("Vault-relative Ordner, die durchsucht werden.").addText((t) => t.setPlaceholder("z.B. TTRPG Sounds, Audio/SFX").setValue(this.plugin.settings.folders.join(", ")).onChange(async (v) => {
      this.plugin.settings.folders = v.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian2.Setting(containerEl).setName("Erlaubte Endungen").setDesc("Kommagetrennt, z.B. mp3, ogg, wav, m4a, flac (Achtung: flac nicht \uFFFDberall unterst\uFFFDtzt).").addText((t) => t.setValue(this.plugin.settings.extensions.join(", ")).onChange(async (v) => {
      this.plugin.settings.extensions = v.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
      await this.plugin.saveSettings();
      await this.plugin.rescan();
    }));
    new import_obsidian2.Setting(containerEl).setName("Fade-In (ms)").addText((t) => t.setValue(String(this.plugin.settings.defaultFadeInMs)).onChange(async (v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Fade-Out (ms)").addText((t) => t.setValue(String(this.plugin.settings.defaultFadeOutMs)).onChange(async (v) => {
      const n = Number(v);
      if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Overlap erlauben").setDesc("Mehrere Sounds gleichzeitig abspielen.").addToggle((t) => t.setValue(this.plugin.settings.allowOverlap).onChange(async (v) => {
      this.plugin.settings.allowOverlap = v;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Master-Volume").addSlider((s) => s.setLimits(0, 1, 0.01).setValue(this.plugin.settings.masterVolume).onChange(async (v) => {
      this.plugin.settings.masterVolume = v;
      this.plugin.engine?.setMasterVolume(v);
      await this.plugin.saveSettings();
    }));
  }
};

// util/fileDiscovery.ts
var import_obsidian3 = require("obsidian");
function findAudioFiles(app, folders, extensions) {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const roots = (folders ?? []).map((f) => f.replace(/^\/+|\/+$/g, "")).filter(Boolean);
  const out = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof import_obsidian3.TFile)) continue;
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

// main.ts
var TTRPGSoundboardPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.soundPrefs = {};
    this.allFiles = [];
    this.rescanTimer = null;
  }
  async onload() {
    await this.loadAll();
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
      new import_obsidian4.Notice(`Preloaded ${this.allFiles.length} files`);
    } });
    this.addCommand({ id: "reload-audio-list", name: "Reload audio list", callback: () => this.rescan() });
    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof import_obsidian4.TFile) {
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
    this.allFiles = findAudioFiles(this.app, this.settings.folders, this.settings.extensions);
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD).forEach((l) => l.view.setFiles(this.allFiles));
  }
  rescanDebounced(delay = 400) {
    if (this.rescanTimer) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(() => this.rescan(), delay);
  }
  // Per-Sound-Präferenzen
  getSoundPref(path) {
    return this.soundPrefs[path] ?? (this.soundPrefs[path] = {});
  }
  setSoundPref(path, pref) {
    this.soundPrefs[path] = pref;
  }
  // Persistenz (settings + soundPrefs)
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
  }
};
//# sourceMappingURL=main.js.map
