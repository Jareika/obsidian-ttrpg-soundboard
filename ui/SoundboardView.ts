import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export const VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";

interface ViewState { folder?: string; }

export default class SoundboardView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  state: ViewState = {};
  files: TFile[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: TTRPGSoundboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_TTRPG_SOUNDBOARD; }
  getDisplayText() { return "TTRPG Soundboard"; }
  getIcon() { return "music"; }

  async onOpen() { this.render(); }
  async onClose() { /* Playback läuft unabhängig weiter */ }

  getState(): ViewState { return { ...this.state }; }
  async setState(state: ViewState) {
    this.state = { ...state };
    await this.render();
  }

  setFiles(files: TFile[]) {
    this.files = files;
    this.render();
  }

  private filteredFiles(): TFile[] {
    const folder = (this.state.folder || "").replace(/^\/+|\/+$/g, "");
    if (!folder) return this.files;
    return this.files.filter(f => f.path === folder || f.path.startsWith(folder + "/"));
  }

  private findThumbFor(file: TFile): TFile | null {
    const parent = file.parent?.path ?? "";
    const base = file.basename;
    const candidates = ["png", "jpg", "jpeg", "webp"].map(ext => `${parent}/${base}.${ext}`);
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof TFile) return af;
    }
    return null;
  }

  private async saveViewState() {
    await this.leaf.setViewState({ type: VIEW_TYPE_TTRPG_SOUNDBOARD, state: this.getState(), active: true });
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // Toolbar
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });

    // Ordnerauswahl pro Pane
    const folderSelect = toolbar.createEl("select");
    folderSelect.createEl("option", { text: "Alle Ordner", value: "" });
    for (const f of this.plugin.settings.folders) folderSelect.createEl("option", { text: f, value: f });
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || undefined;
      await this.saveViewState();
      this.render();
    };

    const reloadBtn = toolbar.createEl("button", { text: "Reload" });
    reloadBtn.onclick = () => this.plugin.rescan();

    const stopAllBtn = toolbar.createEl("button", { text: "Stop All" });
    stopAllBtn.onclick = () => this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);

    const volInput = toolbar.createEl("input", { type: "range" });
    volInput.min = "0"; volInput.max = "1"; volInput.step = "0.01";
    volInput.value = String(this.plugin.settings.masterVolume);
    volInput.oninput = () => {
      const v = Number(volInput.value);
      this.plugin.settings.masterVolume = v;
      this.plugin.engine.setMasterVolume(v);
      this.plugin.saveSettings();
    };

    // Grid
    const grid = contentEl.createDiv({ cls: "ttrpg-sb-grid" });

    for (const file of this.filteredFiles()) {
      const card = grid.createDiv({ cls: "ttrpg-sb-card" });

      // Tile (Bild-Button)
      const tile = card.createEl("button", { cls: "ttrpg-sb-tile", attr: { "aria-label": file.basename } });
      const thumb = this.findThumbFor(file);
      if (thumb) tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(thumb)})`;
      tile.createSpan({ cls: "ttrpg-sb-tile-label", text: file.basename });

      // Per-Sound-Prefs (Loop, Volume)
      const pref = this.plugin.getSoundPref(file.path);

      tile.onclick = async () => {
        if (!this.plugin.settings.allowOverlap) {
          await this.plugin.engine.stopByFile(file, 0);
        }
        await this.plugin.engine.play(file, {
          volume: (pref.volume ?? 1) * this.plugin.settings.masterVolume,
          loop: !!pref.loop,
          fadeInMs: this.plugin.settings.defaultFadeInMs,
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
      perVol.min = "0"; perVol.max = "1"; perVol.step = "0.01";
      perVol.value = String(pref.volume ?? 1);
      perVol.oninput = async () => {
        pref.volume = Number(perVol.value);
        this.plugin.setSoundPref(file.path, pref);
        await this.plugin.saveSettings();
      };
    }
  }
}