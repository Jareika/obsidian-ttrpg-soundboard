import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import { PerSoundSettingsModal } from "./PerSoundSettingsModal";
import { PlaylistSettingsModal } from "./PlaylistSettingsModal";
import { LibraryModel, PlaylistInfo } from "../util/fileDiscovery";

export const VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";

interface ViewState {
  folderA?: string;
  folderB?: string;
  activeSlot?: "A" | "B";
  // Legacy-Feld aus alten Versionen, die nur ein "folder" gespeichert haben
  folder?: string;
}

interface PlaylistPlayState {
  index: number;
  handle?: {
    id: string;
    stop: (opts?: { fadeOutMs?: number }) => Promise<void> | void;
  };
  active: boolean;
}

export default class SoundboardView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  state: ViewState = {};
  library?: LibraryModel;
  playingFiles = new Set<string>();
  private unsubEngine?: () => void;

  // Runtime status per playlist folder (path -> playback state)
  private playlistStates = new Map<string, PlaylistPlayState>();
  private playIdToPlaylist = new Map<string, string>(); // play id -> playlistPath

  // Cache for formatted duration (mm:ss) per file path
  private durationCache = new Map<string, string>();

  constructor(leaf: WorkspaceLeaf, plugin: TTRPGSoundboardPlugin) {
    super(leaf);
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

    // Initial sync: mark all files that are already playing
    this.playingFiles = new Set(this.plugin.engine.getPlayingFilePaths());

    // Subscribe to engine events to keep the view in sync
    this.unsubEngine = this.plugin.engine.on((e) => {
      if (e.type === "start") {
        this.playingFiles.add(e.filePath);
      } else if (e.type === "stop") {
        this.playingFiles.delete(e.filePath);
        // Playlist auto-advance only when the track ends naturally
        if (e.reason === "ended") {
          const pPath = this.playIdToPlaylist.get(e.id);
          if (pPath) {
            void this.onTrackEndedNaturally(pPath);
          }
        }
        // Clean up id -> playlist mapping
        if (e.id) this.playIdToPlaylist.delete(e.id);
      }
      this.updatePlayingVisuals();
    });

    this.render();
  }

  onClose() {
    this.contentEl.removeClass("ttrpg-sb-view");
    this.unsubEngine?.();
    this.unsubEngine = undefined;
  }

  getState(): ViewState {
    return {
      folderA: this.state.folderA,
      folderB: this.state.folderB,
      activeSlot: this.state.activeSlot ?? "A",
      // legacy "folder" speichern wir nicht mehr
    };
  }

  async setState(state: ViewState) {
    const next: ViewState = {
      folderA: state.folderA,
      folderB: state.folderB,
      activeSlot: state.activeSlot,
    };

    // Migration von sehr altem ViewState, der nur "folder" kannte
    const legacyFolder = state.folder;
    if (!next.folderA && !next.folderB && legacyFolder) {
      next.folderA = legacyFolder;
      next.activeSlot = "A";
    }

    this.state = next;
    this.render();
    await Promise.resolve();
  }

  setLibrary(library: LibraryModel) {
    this.library = library;
    this.render();
  }

  private async saveViewState() {
    await this.leaf.setViewState({
      type: VIEW_TYPE_TTRPG_SOUNDBOARD,
      state: this.getState(),
      active: true,
    });
  }

  private getActiveFolderPath(): string {
    const slot = this.state.activeSlot ?? "A";
    return slot === "A" ? this.state.folderA ?? "" : this.state.folderB ?? "";
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // ----- Toolbar -----------------------------------------------------
    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });
    const rowTop = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    const rowBottom = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });

    const topFolders = this.library?.topFolders ?? [];
    const rootFolder = this.library?.rootFolder;
    const rootRegex =
      rootFolder != null
        ? new RegExp(
            `^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`,
          )
        : null;
    const makeLabel = (f: string) =>
      rootRegex ? f.replace(rootRegex, "") || f : f;

    const folderA = this.state.folderA ?? "";
    const folderB = this.state.folderB ?? "";
    const activeSlot = this.state.activeSlot ?? "A";

    const createFolderSelect = (
      parent: HTMLElement,
      currentValue: string,
      slot: "A" | "B",
    ) => {
      const wrap = parent.createDiv({ cls: "ttrpg-sb-folder-select" });
      const select = wrap.createEl("select");

      select.createEl("option", { text: "All folders", value: "" });
      for (const f of topFolders) {
        select.createEl("option", {
          text: makeLabel(f),
          value: f,
        });
      }
      select.value = currentValue || "";
      if (activeSlot === slot) wrap.addClass("active");

      select.onchange = async () => {
        const v = select.value || undefined;
        if (slot === "A") this.state.folderA = v;
        else this.state.folderB = v;
        this.state.activeSlot = slot;
        await this.saveViewState();
        this.render();
      };
      return select;
    };

    // Top row: Folder A | Switch button | Folder B
    createFolderSelect(rowTop, folderA, "A");

    const switchBtn = rowTop.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: { type: "button", "aria-label": "Switch folder view" },
      text: "⇄",
    });
    switchBtn.onclick = async () => {
      const current = this.state.activeSlot ?? "A";
      const nextSlot: "A" | "B" = current === "A" ? "B" : "A";
      this.state.activeSlot = nextSlot;
      await this.saveViewState();
      this.render();
    };

    createFolderSelect(rowTop, folderB, "B");

    // Second row: Stop all | Master volume | Ambience volume
    const stopAllBtn = rowBottom.createEl("button", {
      cls: "ttrpg-sb-stop-all",
      text: "Stop all",
    });
    stopAllBtn.onclick = () => {
      void this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);
    };

    const masterGroup = rowBottom.createDiv({
      cls: "ttrpg-sb-slider-group",
    });
    masterGroup.createSpan({
      cls: "ttrpg-sb-slider-label",
      text: "Master",
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

    const ambGroup = rowBottom.createDiv({
      cls: "ttrpg-sb-slider-group",
    });
    ambGroup.createSpan({
      cls: "ttrpg-sb-slider-label",
      text: "Ambience",
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

    // ----- Main content: simple list vs. grid --------------------------

    const useSimple = this.plugin.settings.simpleView;
    const container = contentEl.createDiv({
      cls: useSimple ? "ttrpg-sb-simple-list" : "ttrpg-sb-grid",
    });

    if (!this.library) {
      container.createDiv({ text: "No files found. Check settings." });
      return;
    }

    const folder = this.getActiveFolderPath();
    if (!folder) {
      // "All folders": show only singles from all folders (no playlists)
      for (const file of this.library.allSingles) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
      this.updatePlayingVisuals();
      return;
    }

    const content = this.library.byFolder[folder];
    if (!content) {
      container.createDiv({ text: "Folder contents not found." });
      return;
    }

    // 1) Singles in the selected top-level folder (including Ambience subfolders)
    for (const file of content.files) {
      if (useSimple) this.renderSingleRow(container, file);
      else this.renderSingleCard(container, file);
    }

    // 2) Playlists (child subfolders except Ambience)
    for (const pl of content.playlists) {
      if (useSimple) this.renderPlaylistRow(container, pl);
      else this.renderPlaylistCard(container, pl);
    }

    this.updatePlayingVisuals();
  }

  // ===================== Helpers: duration =====================

  private formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  private async fillDuration(file: TFile, span: HTMLElement) {
    const cached = this.durationCache.get(file.path);
    if (cached != null) {
      if (cached) span.setText(cached);
      return;
    }
    try {
      // Cast entfernt: file ist bereits vom Typ TFile
      const buffer = await this.plugin.engine.loadBuffer(file);
      const dur = this.formatDuration(buffer.duration);
      this.durationCache.set(file.path, dur);
      if (dur) span.setText(dur);
    } catch {
      this.durationCache.set(file.path, "");
    }
  }

  // ===================== Singles (grid view) =====================

  private renderSingleCard(container: HTMLElement, file: TFile) {
    const card = container.createDiv({ cls: "ttrpg-sb-card" });
    card.createDiv({ cls: "ttrpg-sb-title", text: file.basename });

    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile",
      attr: { "aria-label": file.basename },
    });
    const thumb = this.findThumbFor(file);
    if (thumb) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(
        thumb,
      )})`;
    }

    const pref = this.plugin.getSoundPref(file.path);
    const isAmbience = this.plugin.isAmbiencePath(file.path);

    tile.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol =
        baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);

      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs,
      });
    };

    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });

    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": String(!!pref.loop),
        type: "button",
      },
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

    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop",
    });
    stopBtn.dataset.path = file.path;
    if (this.playingFiles.has(file.path)) stopBtn.classList.add("playing");
    stopBtn.onclick = async () => {
      await this.plugin.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs,
      );
    };

    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      pref.volume = v;
      this.plugin.setSoundPref(file.path, pref);
      this.plugin.applyEffectiveVolumeForSingle(file.path, v);
      void this.plugin.saveSettings();
    };

    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right",
    });
    setIcon(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () =>
      new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
  }

  // ===================== Singles (simple list view) =====================

  private renderSingleRow(container: HTMLElement, file: TFile) {
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row" });
    row.dataset.path = file.path;

    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({
      cls: "ttrpg-sb-simple-title",
      text: file.basename,
    });
    const durationEl = main.createSpan({
      cls: "ttrpg-sb-simple-duration",
      text: "",
    });

    void this.fillDuration(file, durationEl);

    const pref = this.plugin.getSoundPref(file.path);
    const isAmbience = this.plugin.isAmbiencePath(file.path);

    main.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol =
        baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);

      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs,
      });
    };

    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });

    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": String(!!pref.loop),
        type: "button",
      },
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

    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop",
    });
    stopBtn.dataset.path = file.path;
    stopBtn.onclick = async () => {
      await this.plugin.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs,
      );
    };

    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);
    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      pref.volume = v;
      this.plugin.setSoundPref(file.path, pref);
      this.plugin.applyEffectiveVolumeForSingle(file.path, v);
      void this.plugin.saveSettings();
    };

    const gearPerBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right",
    });
    setIcon(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () =>
      new PerSoundSettingsModal(this.app, this.plugin, file.path).open();

    // If this file was already playing when the row was rendered, highlight it
    if (this.playingFiles.has(file.path)) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }

  private findThumbFor(file: TFile): TFile | null {
    const parent = file.parent?.path ?? "";
    const base = file.basename;
    const candidates = ["png", "jpg", "jpeg", "webp"].map(
      (ext) => `${parent}/${base}.${ext}`,
    );
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof TFile) return af;
    }
    return null;
  }

  // ===================== Playlists =====================

  private renderPlaylistCard(container: HTMLElement, pl: PlaylistInfo) {
    const card = container.createDiv({ cls: "ttrpg-sb-card playlist" });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });

    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile playlist",
      attr: { "aria-label": pl.name },
    });
    if (pl.cover) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(
        pl.cover,
      )})`;
    }

    tile.onclick = () => {
      void this.startPlaylist(pl, 0);
    };

    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });

    // Previous track
    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
    });
    setIcon(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.prevInPlaylist(pl);
    };

    // Stop playlist
    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop",
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.stopPlaylist(pl);
    };

    // Next track
    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
    });
    setIcon(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.nextInPlaylist(pl);
    };

    // Playlist settings
    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right",
    });
    setIcon(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () =>
      new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();

    // Visualize playing state
    const st = this.ensurePlaylistState(pl.path);
    if (st.active) stopBtn.classList.add("playing");
  }

  private renderPlaylistRow(container: HTMLElement, pl: PlaylistInfo) {
    const row = container.createDiv({
      cls: "ttrpg-sb-simple-row playlist",
    });
    row.dataset.playlist = pl.path;

    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({
      cls: "ttrpg-sb-simple-title",
      text: pl.name,
    });
    main.createSpan({
      cls: "ttrpg-sb-simple-duration",
      text: `${pl.tracks.length} tracks`,
    });

    main.onclick = () => {
      void this.startPlaylist(pl, 0);
    };

    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });

    const prevBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
    });
    setIcon(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.prevInPlaylist(pl);
    };

    const stopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-stop",
      text: "Stop",
    });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.stopPlaylist(pl);
    };

    const nextBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
    });
    setIcon(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.nextInPlaylist(pl);
    };

    const gearBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn push-right",
    });
    setIcon(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () =>
      new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();

    const st = this.ensurePlaylistState(pl.path);
    if (st.active) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
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
    const fadeOutMs =
      pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
        // Ignore errors when stopping an already-stopped handle
      }
      st.handle = undefined;
    }

    await this.playPlaylistIndex(
      pl,
      Math.max(0, Math.min(startIndex, pl.tracks.length - 1)),
    );
  }

  private async playPlaylistIndex(pl: PlaylistInfo, index: number) {
    const st = this.ensurePlaylistState(pl.path);
    if (pl.tracks.length === 0) return;
    const file = pl.tracks[index];

    const pref = this.plugin.getPlaylistPref(pl.path);
    const vol = pref.volume ?? 1;
    const fadeInMs =
      pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs;

    const handle = await this.plugin.engine.play(file, {
      volume: vol,
      loop: false,
      fadeInMs,
    });
    st.index = index;
    st.handle = handle;
    st.active = true;
    this.playIdToPlaylist.set(handle.id, pl.path);

    this.updatePlayingVisuals();
  }

  private async stopPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs =
      pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
        // Ignore errors when stopping an already-stopped handle
      }
      st.handle = undefined;
    }
    st.active = false;
    this.updatePlayingVisuals();
  }

  private async nextInPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs =
      pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
        // Ignore errors when stopping an already-stopped handle
      }
      st.handle = undefined;
    }

    const nextIndex = (st.index + 1) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, nextIndex);
  }

  private async prevInPlaylist(pl: PlaylistInfo) {
    const st = this.ensurePlaylistState(pl.path);
    const pref = this.plugin.getPlaylistPref(pl.path);
    const fadeOutMs =
      pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs;

    if (st.handle) {
      try {
        await st.handle.stop({ fadeOutMs });
      } catch {
        // Ignore errors when stopping an already-stopped handle
      }
      st.handle = undefined;
    }

    const prevIndex =
      (st.index - 1 + pl.tracks.length) % Math.max(1, pl.tracks.length);
    await this.playPlaylistIndex(pl, prevIndex);
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
      const pl = c.playlists.find((p) => p.path === pPath);
      if (pl) return pl;
    }
    return null;
  }

  private updatePlayingVisuals() {
    // Singles – stop buttons
    const btns =
      this.contentEl.querySelectorAll<HTMLButtonElement>(
        ".ttrpg-sb-stop[data-path]",
      );
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });

    // Singles – rows in simple view
    const rows =
      this.contentEl.querySelectorAll<HTMLElement>(
        ".ttrpg-sb-simple-row[data-path]",
      );
    rows.forEach((r) => {
      const p = r.dataset.path || "";
      r.toggleClass("playing", this.playingFiles.has(p));
    });

    // Playlists – stop buttons
    const pbtns =
      this.contentEl.querySelectorAll<HTMLButtonElement>(
        ".ttrpg-sb-stop[data-playlist]",
      );
    pbtns.forEach((b) => {
      const p = b.dataset.playlist || "";
      const st = this.playlistStates.get(p);
      b.toggleClass("playing", !!st?.active);
    });

    // Playlists – rows in simple view
    const plRows =
      this.contentEl.querySelectorAll<HTMLElement>(
        ".ttrpg-sb-simple-row[data-playlist]",
      );
    plRows.forEach((r) => {
      const p = r.dataset.playlist || "";
      const st = this.playlistStates.get(p);
      r.toggleClass("playing", !!st?.active);
    });
  }
}