import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import { PerSoundSettingsModal } from "./PerSoundSettingsModal";
import { PlaylistSettingsModal } from "./PlaylistSettingsModal";
import { LibraryModel, PlaylistInfo } from "../util/fileDiscovery";

export const VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";

interface ViewState { folder?: string; }

interface PlaylistPlayState {
  index: number;
  handle?: { id: string; stop: (opts?: { fadeOutMs?: number }) => Promise<void> | void };
  active: boolean;
}

export default class SoundboardView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  state: ViewState = {};
  library?: LibraryModel;
  playingFiles = new Set<string>();
  private unsubEngine?: () => void;

  // Runtime status per playlist folder
  private playlistStates = new Map<string, PlaylistPlayState>();
  private playIdToPlaylist = new Map<string, string>(); // id -> playlistPath

  constructor(leaf: WorkspaceLeaf, plugin: TTRPGSoundboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_TTRPG_SOUNDBOARD; }
  getDisplayText() { return "Soundboard"; }
  getIcon() { return "music"; }

  onOpen() {
    this.playingFiles = new Set(this.plugin.engine.getPlayingFilePaths());
    this.unsubEngine = this.plugin.engine.on(e => {
      if (e.type === "start") {
        this.playingFiles.add(e.filePath);
      } else if (e.type === "stop") {
        this.playingFiles.delete(e.filePath);
        // Playlist auto-advance only on natural end
        if (e.reason === "ended") {
          const pPath = this.playIdToPlaylist.get(e.id);
          if (pPath) {
            void this.onTrackEndedNaturally(pPath);
          }
        }
        // Cleanup id mapping
        if (e.id) this.playIdToPlaylist.delete(e.id);
      }
      this.updatePlayingVisuals();
    });
    this.render();
  }

  onClose() { this.unsubEngine?.(); this.unsubEngine = undefined; }

  getState(): ViewState { return { ...this.state }; }
  async setState(state: ViewState) {
    this.state = { ...state };
    this.render();
    await Promise.resolve();
  }

  setLibrary(library: LibraryModel) { this.library = library; this.render(); }

  private async saveViewState() {
    await this.leaf.setViewState({
      type: VIEW_TYPE_TTRPG_SOUNDBOARD,
      state: this.getState(),
      active: true,
    });
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // Toolbar
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });

    const folderSelect = toolbar.createEl("select");
    folderSelect.createEl("option", { text: "All folders", value: "" });
    const topFolders = this.library?.topFolders ?? [];
    for (const f of topFolders) {
      const label = this.library?.rootFolder
        ? f.replace(new RegExp("^" + this.library.rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?"), "")
        : f;
      folderSelect.createEl("option", { text: label, value: f });
    }
    folderSelect.value = this.state.folder ?? "";
    folderSelect.onchange = async () => {
      this.state.folder = folderSelect.value || undefined;
      await this.saveViewState();
      this.render();
    };

    const stopAllBtn = toolbar.createEl("button", { text: "Stop all" });
    stopAllBtn.onclick = () => { void this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs); };

    const volInput = toolbar.createEl("input", { type: "range" });
    volInput.min = "0"; volInput.max = "1"; volInput.step = "0.01";
    volInput.value = String(this.plugin.settings.masterVolume);
    volInput.oninput = () => {
      const v = Number(volInput.value);
      this.plugin.settings.masterVolume = v;
      this.plugin.engine.setMasterVolume(v);
      void this.plugin.saveSettings();
    };

    // Grid
    const grid = contentEl.createDiv({ cls: "ttrpg-sb-grid" });

    if (!this.library) {
      grid.createDiv({ text: "No files found. Check settings." });
      return;
    }

    const folder = this.state.folder ?? "";
    if (!folder) {
      // "All folders": singles only (no playlist contents)
      for (const file of this.library.allSingles) {
        this.renderSingleCard(grid, file);
      }
      this.updatePlayingVisuals();
      return;
    }

    const content = this.library.byFolder[folder];
    if (!content) {
      grid.createDiv({ text: "Folder contents not found." });
      return;
    }

    // 1) Singles in the selected top-level folder
    for (const file of content.files) {
      this.renderSingleCard(grid, file);
    }

    // 2) Playlists (subfolders)
    for (const pl of content.playlists) {
      this.renderPlaylistCard(grid, pl);
    }

    this.updatePlayingVisuals();
  }

  // ===================== Singles =====================

  private renderSingleCard(grid: HTMLElement, file: TFile) {
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

    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: { "aria-label": "Toggle loop", "aria-pressed": String(!!pref.loop), "type": "button" }
    });
    setIcon(loopBtn, "repeat");
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
      await this.plugin.engine.stopByFile(file, (pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs));
    };

    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
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

  // ===================== Playlists =====================

  private renderPlaylistCard(grid: HTMLElement, pl: PlaylistInfo) {
    const card = grid.createDiv({ cls: "ttrpg-sb-card playlist" });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });

    const tile = card.createEl("button", { cls: "ttrpg-sb-tile playlist", attr: { "aria-label": pl.name } });
    if (pl.cover) tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(pl.cover)})`;

    tile.onclick = () => { void this.startPlaylist(pl, 0); };

    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });

    // Previous
    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => { void this.prevInPlaylist(pl); };

    // Stop
    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => { void this.stopPlaylist(pl); };

    // Next
    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => { void this.nextInPlaylist(pl); };

    // Gear
    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();

    // Visualize playing state
    const st = this.ensurePlaylistState(pl.path);
    if (st.active) stopBtn.classList.add("playing");
  }

  private ensurePlaylistState(pPath: string): PlaylistPlayState {
    let st = this.playlistStates.get(pPath);
    if (!st) {
      st = { index: 0, active: false };
      this.playlistStates.set(pPath, st);
    }
    return st;
  }

  private async startPlaylist(pl: PlaylistInfo, startIndex = 0) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    // If something is playing: stop first, then start
    if (st.handle) {
      try { await st.handle.stop({ fadeOutMs }); } catch { /* ignore stop error */ }
      st.handle = undefined;
    }

    await this.playPlaylistIndex(pl, Math.max(0, Math.min(startIndex, pl.tracks.length - 1)));
  }

  private async playPlaylistIndex(pl: PlaylistInfo, index: number) {
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

  private async stopPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try { await st.handle.stop({ fadeOutMs }); } catch { /* ignore stop error */ }
      st.handle = undefined;
    }
    st.active = false;
    this.updatePlayingVisuals();
  }

  private async nextInPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try { await st.handle.stop({ fadeOutMs }); } catch { /* ignore stop error */ }
      st.handle = undefined;
    }

    const next = (st.index + 1) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, next);
  }

  private async prevInPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs = pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try { await st.handle.stop({ fadeOutMs }); } catch { /* ignore stop error */ }
      st.handle = undefined;
    }

    const prev = (st.index - 1 + pl.tracks.length) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, prev);
  }

  private async onTrackEndedNaturally(pPath: string) {
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
        // Playlist finished
        st.handle = undefined;
        st.active = false;
        this.updatePlayingVisuals();
      }
    } else {
      await this.playPlaylistIndex(pl, st.index + 1);
    }
  }

  private findPlaylistByPath(pPath: string): PlaylistInfo | null {
    if (!this.library) return null;
    for (const f of this.library.topFolders) {
      const c = this.library.byFolder[f];
      if (!c) continue;
      const pl = c.playlists.find(p => p.path === pPath);
      if (pl) return pl;
    }
    return null;
  }

  private updatePlayingVisuals() {
    // Singles
    const btns = this.contentEl.querySelectorAll<HTMLButtonElement>(".ttrpg-sb-stop[data-path]");
    btns.forEach(b => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });
    // Playlists
    const pbtns = this.contentEl.querySelectorAll<HTMLButtonElement>(".ttrpg-sb-stop[data-playlist]");
    pbtns.forEach(b => {
      const p = b.dataset.playlist || "";
      const st = this.playlistStates.get(p);
      b.toggleClass("playing", !!st?.active);
    });
  }
}