import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import { PerSoundSettingsModal } from "./PerSoundSettingsModal";

export const VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";

interface ViewState { folder?: string; }

export default class SoundboardView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  state: ViewState = {};
  files: TFile[] = [];
  playing = new Set<string>();
  private unsubEngine?: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: TTRPGSoundboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_TTRPG_SOUNDBOARD; }
  getDisplayText() { return "TTRPG Soundboard"; }
  getIcon() { return "music"; }

  async onOpen() {
    this.playing = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on(e => {
      if (e.type === "start") this.playing.add(e.filePath);
      else this.playing.delete(e.filePath);
      this.updatePlayingVisuals();
    });
    this.render();
  }

  async onClose() { this.unsubEngine?.(); this.unsubEngine = undefined; }

  getState(): ViewState { return { ...this.state }; }
  async setState(state: ViewState) { this.state = { ...state }; await this.render(); }
  setFiles(files: TFile[]) { this.files = files; this.render(); }

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

    const folderSelect = toolbar.createEl("select");
    folderSelect.createEl("option", { text: "All folders", value: "" });
    const opts = (this.plugin.subfolders?.length ? this.plugin.subfolders : this.plugin.settings.folders) ?? [];
    for (const f of opts) {
      const label = this.plugin.subfolders?.length
        ? f.replace(new RegExp("^" + this.plugin.settings.rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?"), "")
        : f;
      folderSelect.createEl("option", { text: label, value: f });
    }
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || undefined;
      await this.saveViewState();
      this.render();
    };

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
          fadeInMs: (pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs),
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
        await this.plugin.engine.stopByFile(file, (pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs));
      };

      const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
      setIcon(gearPerBtn, "gear");
      gearPerBtn.setAttr("aria-label", "Per-title settings");
      gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
    }
  }

  private updatePlayingVisuals() {
    const btns = this.contentEl.querySelectorAll<HTMLButtonElement>(".ttrpg-sb-stop");
    btns.forEach(b => {
      const p = b.dataset.path || "";
      if (this.playing.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
  }
}