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
    this.unsubEngine = undefined;
  }

  getState(): unknown {
    return {};
  }

  async setState(_state: unknown) {
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

    const name = file?.basename ?? path.split("/").pop() ?? path;

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
      text: "Stop",
    });
    stopBtn.onclick = async () => {
      if (file) {
        await this.plugin.engine.stopByFile(file, this.plugin.settings.defaultFadeOutMs);
      }
    };

    const pauseBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: isPaused ? "Resume" : "Pause",
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
      cls: "ttrpg-sb-inline-volume",
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";

    if (activePlaylistPath) {
      const pref = this.plugin.getPlaylistPref(activePlaylistPath);
      volSlider.value = String(pref.volume ?? 1);

      volSlider.oninput = () => {
        const v = Number(volSlider.value);
        this.plugin.setPlaylistVolumeFromSlider(activePlaylistPath, v);
      };
    } else {
      const pref = this.plugin.getSoundPref(path);
      volSlider.value = String(pref.volume ?? 1);

      this.plugin.registerVolumeSliderForPath(path, volSlider);

      volSlider.oninput = () => {
        const v = Number(volSlider.value);
        this.plugin.setVolumeForPathFromSlider(path, v, volSlider);
      };
    }
  }
}