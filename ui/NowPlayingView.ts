import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import type { PlaylistInfo } from "../util/fileDiscovery";

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

    if (activePlaylistPath) {
      const playlist = this.findPlaylistByPath(activePlaylistPath);
      if (playlist) {
        this.renderPlaylistControls(controls, playlist, activePlaylistPath, file, isPaused);
        return;
      }
    }

    this.renderSingleControls(controls, file, path, isPaused);
  }

  private renderSingleControls(
    controls: HTMLElement,
    file: TFile | null,
    path: string,
    isPaused: boolean,
  ) {
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

    const pref = this.plugin.getSoundPref(path);
    volSlider.value = String(pref.volume ?? 1);

    this.plugin.registerVolumeSliderForPath(path, volSlider);

    volSlider.oninput = () => {
      const v = Number(volSlider.value);
      this.plugin.setVolumeForPathFromSlider(path, v, volSlider);
    };
  }

  private renderPlaylistControls(
    controls: HTMLElement,
    playlist: PlaylistInfo,
    playlistPath: string,
    file: TFile | null,
    isPaused: boolean,
  ) {
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Previous track",
      },
    });
    setIcon(prevBtn, "skip-back");
    prevBtn.onclick = async () => {
      await this.plugin.prevInPlaylist(playlist);
    };

    const pauseBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: {
        type: "button",
        "aria-label": isPaused ? "Resume playlist" : "Pause playlist",
      },
    });
    setIcon(pauseBtn, isPaused ? "play" : "pause");
    pauseBtn.onclick = async () => {
      if (!file) return;
      if (isPaused) {
        await this.plugin.engine.resumeByFile(file, this.plugin.settings.defaultFadeInMs);
      } else {
        await this.plugin.engine.pauseByFile(file, this.plugin.settings.defaultFadeOutMs);
      }
    };

    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Stop playlist",
      },
    });
    setIcon(stopBtn, "square");
    stopBtn.onclick = async () => {
      await this.plugin.stopPlaylist(playlistPath);
    };

    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Next track",
      },
    });
    setIcon(nextBtn, "skip-forward");
    nextBtn.onclick = async () => {
      await this.plugin.nextInPlaylist(playlist);
    };

    const volSlider = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    volSlider.min = "0";
    volSlider.max = "1";
    volSlider.step = "0.01";

    const pref = this.plugin.getPlaylistPref(playlistPath);
    volSlider.value = String(pref.volume ?? 1);

    volSlider.oninput = () => {
      const v = Number(volSlider.value);
      this.plugin.setPlaylistVolumeFromSlider(playlistPath, v);
    };
  }

  private findPlaylistByPath(playlistPath: string): PlaylistInfo | null {
    for (const folder of this.plugin.library.topFolders) {
      const content = this.plugin.library.byFolder[folder];
      if (!content) continue;

      const playlist = content.playlists.find((pl) => pl.path === playlistPath);
      if (playlist) return playlist;
    }

    return null;
  }
}