import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export const VIEW_TYPE_TTRPG_NOWPLAYING = "ttrpg-soundboard-nowplaying";

export default class NowPlayingView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  private playingPaths = new Set<string>();
  private unsubEngine?: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: TTRPGSoundboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_TTRPG_NOWPLAYING;
  }

  getDisplayText() {
    return "Now playing";
  }

  getIcon() {
    // Use a different icon than the main soundboard view (if your theme provides it)
    return "music-2";
  }

  onOpen() {
    this.contentEl.addClass("ttrpg-sb-view");

    // Initial sync: take all currently playing file paths from the engine
    this.playingPaths = new Set(this.plugin.engine.getPlayingFilePaths());

    this.unsubEngine = this.plugin.engine.on(() => {
      // On every start/stop event, resync the list and re-render
      this.playingPaths = new Set(this.plugin.engine.getPlayingFilePaths());
      this.render();
    });

    this.render();
  }

  onClose() {
    this.contentEl.removeClass("ttrpg-sb-view");
    this.unsubEngine?.();
    this.unsubEngine = undefined;
  }

  getState(): unknown {
    // This view does not need a custom view state
    return {};
  }

  async setState(_state: unknown) {
    // Intentionally unused; kept only to match the ItemView signature
    void _state;
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

  private renderCard(grid: HTMLElement, path: string) {
    const af = this.app.vault.getAbstractFileByPath(path);
    const file = af instanceof TFile ? af : null;

    const name =
      file?.basename ??
      path.split("/").pop() ??
      path;

    const card = grid.createDiv({ cls: "ttrpg-sb-now-card" });
    card.createDiv({ cls: "ttrpg-sb-now-title", text: name });

    const controls = card.createDiv({ cls: "ttrpg-sb-now-controls" });

    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop playing",
      text: "Stop",
    });
    stopBtn.onclick = async () => {
      if (file) {
        await this.plugin.engine.stopByFile(
          file,
          this.plugin.settings.defaultFadeOutMs,
        );
      }
    };

    const volSlider = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";
    // We do not know the current effective volume here, so we start at 1
    volSlider.value = "1";

    volSlider.oninput = () => {
      const v = Number(volSlider.value);
      // Live-adjust volume only for this file path (no preference is stored)
      this.plugin.applyEffectiveVolumeForSingle(path, v);
    };
  }
}