import { ItemView, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import { PerSoundSettingsModal } from "./PerSoundSettingsModal";
import { PlaylistSettingsModal } from "./PlaylistSettingsModal";
import { LibraryModel, PlaylistInfo } from "../util/fileDiscovery";

export const VIEW_TYPE_TTRPG_SOUNDBOARD = "ttrpg-soundboard-view";

type FolderSlot = "A" | "B" | "C" | "D";

interface ViewState {
  folderA?: string;
  folderB?: string;
  folderC?: string;
  folderD?: string;
  activeSlot?: FolderSlot;
  folder?: string;
}

export default class SoundboardView extends ItemView {
  plugin: TTRPGSoundboardPlugin;
  state: ViewState = {};
  library?: LibraryModel;
  playingFiles = new Set<string>();
  private unsubEngine?: () => void;

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

    this.playingFiles = new Set(this.plugin.engine.getPlayingFilePaths());

    this.unsubEngine = this.plugin.engine.on((e) => {
      if (e.type === "start") {
        this.playingFiles.add(e.filePath);
      } else if (e.type === "stop") {
        this.playingFiles.delete(e.filePath);
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
      folderC: this.state.folderC,
      folderD: this.state.folderD,
      activeSlot: this.state.activeSlot ?? "A",
    };
  }

  async setState(state: ViewState) {
    const next: ViewState = {
      folderA: state.folderA,
      folderB: state.folderB,
      folderC: state.folderC,
      folderD: state.folderD,
      activeSlot: state.activeSlot,
      folder: state.folder,
    };

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
    const slot: FolderSlot = this.state.activeSlot ?? "A";
    if (slot === "A") return this.state.folderA ?? "";
    if (slot === "B") return this.state.folderB ?? "";
    if (slot === "C") return this.state.folderC ?? "";
    return this.state.folderD ?? "";
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    const library = this.library;

    const toolbar = contentEl.createDiv({ cls: "ttrpg-sb-toolbar" });

    const rowFolders1 = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    let rowFolders2: HTMLElement | null = null;
    if (this.plugin.settings.toolbarFourFolders) {
      rowFolders2 = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });
    }

    const rowControls = toolbar.createDiv({ cls: "ttrpg-sb-toolbar-row" });

    const topFolders = library?.topFolders ?? [];
    const rootFolder = library?.rootFolder;
    const rootRegex =
      rootFolder != null && rootFolder !== ""
        ? new RegExp(`^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`)
        : null;
    const makeLabel = (f: string) => (rootRegex ? f.replace(rootRegex, "") || f : f);

    const folderA = this.state.folderA ?? "";
    const folderB = this.state.folderB ?? "";
    const folderC = this.state.folderC ?? "";
    const folderD = this.state.folderD ?? "";
    const activeSlot: FolderSlot = this.state.activeSlot ?? "A";

    const createFolderSelectTwo = (parent: HTMLElement, currentValue: string, slot: "A" | "B") => {
      const wrap = parent.createDiv({ cls: "ttrpg-sb-folder-select" });
      const select = wrap.createEl("select");

      select.createEl("option", { text: "All folders", value: "" });
      for (const f of topFolders) {
        select.createEl("option", { text: makeLabel(f), value: f });
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

    const createFolderSlotFour = (parent: HTMLElement, currentValue: string, slot: FolderSlot, goLeft: boolean) => {
      const wrap = parent.createDiv({ cls: "ttrpg-sb-folder-select" });
      if (activeSlot === slot) wrap.addClass("active");

      let select: HTMLSelectElement;
      let goBtn: HTMLButtonElement;

      if (goLeft) {
        goBtn = wrap.createEl("button", {
          cls: "ttrpg-sb-icon-btn ttrpg-sb-folder-go",
          attr: { type: "button", "aria-label": "Show this folder" },
        });
        goBtn.textContent = "Go";
        select = wrap.createEl("select");
      } else {
        select = wrap.createEl("select");
        goBtn = wrap.createEl("button", {
          cls: "ttrpg-sb-icon-btn ttrpg-sb-folder-go",
          attr: { type: "button", "aria-label": "Show this folder" },
        });
        goBtn.textContent = "Go";
      }

      select.createEl("option", { text: "All folders", value: "" });
      for (const f of topFolders) {
        select.createEl("option", { text: makeLabel(f), value: f });
      }
      select.value = currentValue || "";

      select.onchange = async () => {
        const v = select.value || undefined;
        if (slot === "A") this.state.folderA = v;
        else if (slot === "B") this.state.folderB = v;
        else if (slot === "C") this.state.folderC = v;
        else this.state.folderD = v;
        await this.saveViewState();
      };

      goBtn.onclick = async () => {
        this.state.activeSlot = slot;
        await this.saveViewState();
        this.render();
      };
    };

    if (this.plugin.settings.toolbarFourFolders) {
      createFolderSlotFour(rowFolders1, folderA, "A", false);
      createFolderSlotFour(rowFolders1, folderB, "B", true);
      if (rowFolders2) {
        createFolderSlotFour(rowFolders2, folderC, "C", false);
        createFolderSlotFour(rowFolders2, folderD, "D", true);
      }
    } else {
      createFolderSelectTwo(rowFolders1, folderA, "A");

      const switchBtn = rowFolders1.createEl("button", {
        cls: "ttrpg-sb-icon-btn",
        attr: { type: "button", "aria-label": "Switch folder view" },
        text: "⇄",
      });
      switchBtn.onclick = async () => {
        const current: FolderSlot = this.state.activeSlot ?? "A";
        const nextSlot: FolderSlot = current === "A" ? "B" : "A";
        this.state.activeSlot = nextSlot;
        await this.saveViewState();
        this.render();
      };

      createFolderSelectTwo(rowFolders1, folderB, "B");
    }

    const stopAllBtn = rowControls.createEl("button", {
      cls: "ttrpg-sb-stop-all",
      text: "Stop all",
    });
    stopAllBtn.onclick = () => {
      void this.plugin.engine.stopAll(this.plugin.settings.defaultFadeOutMs);
    };

    const masterGroup = rowControls.createDiv({ cls: "ttrpg-sb-slider-group" });
    masterGroup.createSpan({ cls: "ttrpg-sb-slider-label", text: "Master" });
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

    const ambGroup = rowControls.createDiv({ cls: "ttrpg-sb-slider-group" });
    ambGroup.createSpan({ cls: "ttrpg-sb-slider-label", text: "Ambience" });
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

    const activeFolder = this.getActiveFolderPath();
    const useSimple = this.plugin.isSimpleViewForFolder(activeFolder);

    const container = contentEl.createDiv({
      cls: useSimple ? "ttrpg-sb-simple-list" : "ttrpg-sb-grid",
    });

    if (!library) {
      container.createDiv({ text: "No files found. Check settings." });
      return;
    }

    const folder = activeFolder;
    if (!folder) {
      for (const file of library.allSingles) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
      this.updatePlayingVisuals();
      return;
    }

    const content = library.byFolder[folder];
    if (!content) {
      container.createDiv({ text: "Folder contents not found." });
      return;
    }

    const renderGroup = (kind: "sounds" | "ambience" | "playlists") => {
      if (kind === "playlists") {
        for (const pl of content.playlists) {
          if (useSimple) this.renderPlaylistRow(container, pl);
          else this.renderPlaylistCard(container, pl);
        }
        return;
      }

      const isAmb = kind === "ambience";
      const files = content.files.filter((f) => this.plugin.isAmbiencePath(f.path) === isAmb);
      for (const file of files) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
    };

    if (!this.plugin.settings.arrangementEnabled) {
      for (const file of content.files) {
        if (useSimple) this.renderSingleRow(container, file);
        else this.renderSingleCard(container, file);
      }
      for (const pl of content.playlists) {
        if (useSimple) this.renderPlaylistRow(container, pl);
        else this.renderPlaylistCard(container, pl);
      }
    } else {
      const order = this.getArrangementOrder();
      for (const k of order) renderGroup(k);
    }

    this.updatePlayingVisuals();
  }

  private getArrangementOrder(): Array<"sounds" | "ambience" | "playlists"> {
    const fallback: Array<"sounds" | "ambience" | "playlists"> = ["sounds", "ambience", "playlists"];
    const chosen = [
      this.plugin.settings.arrangementFirst,
      this.plugin.settings.arrangementSecond,
      this.plugin.settings.arrangementThird,
    ].filter((v): v is "sounds" | "ambience" | "playlists" => v !== "default");

    const seen = new Set<string>();
    const out: Array<"sounds" | "ambience" | "playlists"> = [];
    for (const v of chosen) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    for (const v of fallback) {
      if (!seen.has(v)) out.push(v);
    }
    return out;
  }

  private renderSingleCard(container: HTMLElement, file: TFile) {
    const card = container.createDiv({ cls: "ttrpg-sb-card" });

    const isAmbience = this.plugin.isAmbiencePath(file.path);
    if (isAmbience) card.addClass("ambience");

    card.createDiv({ cls: "ttrpg-sb-title", text: file.basename });

    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile",
      attr: { "aria-label": file.basename },
    });
    if (isAmbience) tile.addClass("ambience");

    const thumb = this.findThumbFor(file);
    if (thumb) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(thumb)})`;
    }

    const pref = this.plugin.getSoundPref(file.path);
    const loopEndTrimSeconds = this.plugin.getLoopEndTrimSecondsForPath(file.path);

    tile.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);

      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: this.plugin.getEffectiveLoopForPath(file.path),
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs,
        loopEndTrimSeconds,
      });
    };

    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });

    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": "false",
        type: "button",
      },
    });
    setIcon(loopBtn, "repeat");

    const paintLoop = () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      loopBtn.toggleClass("active", effective);
      loopBtn.setAttr("aria-pressed", String(effective));
    };
    paintLoop();

    loopBtn.onclick = async () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      pref.loop = !effective;
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

    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);

    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);

    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };

    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();
  }

  private renderSingleRow(container: HTMLElement, file: TFile) {
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row" });
    row.dataset.path = file.path;

    const isAmbience = this.plugin.isAmbiencePath(file.path);
    if (isAmbience) row.addClass("ambience");

    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({ cls: "ttrpg-sb-simple-title", text: file.basename });
    const durationEl = main.createSpan({ cls: "ttrpg-sb-simple-duration", text: "" });

    this.plugin.requestDurationFormatted(file, (txt) => {
      if (!durationEl.isConnected) return;
      durationEl.setText(txt);
    });

    const pref = this.plugin.getSoundPref(file.path);
    const loopEndTrimSeconds = this.plugin.getLoopEndTrimSecondsForPath(file.path);

    main.onclick = async () => {
      if (!this.plugin.settings.allowOverlap) {
        await this.plugin.engine.stopByFile(file, 0);
      }
      const baseVol = pref.volume ?? 1;
      const effectiveVol = baseVol * (isAmbience ? this.plugin.settings.ambienceVolume : 1);

      await this.plugin.engine.play(file, {
        volume: effectiveVol,
        loop: this.plugin.getEffectiveLoopForPath(file.path),
        fadeInMs: pref.fadeInMs ?? this.plugin.settings.defaultFadeInMs,
        loopEndTrimSeconds,
      });
    };

    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });

    const loopBtn = controls.createEl("button", {
      cls: "ttrpg-sb-icon-btn ttrpg-sb-loop",
      attr: {
        "aria-label": "Toggle loop",
        "aria-pressed": "false",
        type: "button",
      },
    });
    setIcon(loopBtn, "repeat");

    const paintLoop = () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      loopBtn.toggleClass("active", effective);
      loopBtn.setAttr("aria-pressed", String(effective));
    };
    paintLoop();

    loopBtn.onclick = async () => {
      const effective = this.plugin.getEffectiveLoopForPath(file.path);
      pref.loop = !effective;
      this.plugin.setSoundPref(file.path, pref);
      await this.plugin.saveSettings();
      paintLoop();
    };

    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.path = file.path;
    stopBtn.onclick = async () => {
      await this.plugin.engine.stopByFile(file, pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs);
    };

    const inlineVol = controls.createEl("input", {
      type: "range",
      cls: "ttrpg-sb-inline-volume",
    });
    inlineVol.min = "0";
    inlineVol.max = "1";
    inlineVol.step = "0.01";
    inlineVol.value = String(pref.volume ?? 1);

    this.plugin.registerVolumeSliderForPath(file.path, inlineVol);

    inlineVol.oninput = () => {
      const v = Number(inlineVol.value);
      this.plugin.setVolumeForPathFromSlider(file.path, v, inlineVol);
    };

    const gearPerBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearPerBtn, "gear");
    gearPerBtn.setAttr("aria-label", "Sound settings");
    gearPerBtn.onclick = () => new PerSoundSettingsModal(this.app, this.plugin, file.path).open();

    if (this.playingFiles.has(file.path)) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }

  private findThumbFor(file: TFile): TFile | null {
    const base = file.basename;

    if (this.plugin.settings.thumbnailFolderEnabled && this.plugin.settings.thumbnailFolderPath.trim()) {
      const folder = normalizePath(this.plugin.settings.thumbnailFolderPath.trim());
      const candidates = ["png", "jpg", "jpeg", "webp"].map((ext) => `${folder}/${base}.${ext}`);
      for (const p of candidates) {
        const af = this.app.vault.getAbstractFileByPath(p);
        if (af && af instanceof TFile) return af;
      }
      return null;
    }

    const parent = file.parent?.path ?? "";
    const candidates = ["png", "jpg", "jpeg", "webp"].map((ext) => `${parent}/${base}.${ext}`);
    for (const p of candidates) {
      const af = this.app.vault.getAbstractFileByPath(p);
      if (af && af instanceof TFile) return af;
    }
    return null;
  }

  private renderPlaylistCard(container: HTMLElement, pl: PlaylistInfo) {
    const card = container.createDiv({ cls: "ttrpg-sb-card playlist" });
    card.createDiv({ cls: "ttrpg-sb-title", text: pl.name });

    const tile = card.createEl("button", {
      cls: "ttrpg-sb-tile playlist",
      attr: { "aria-label": pl.name },
    });
    if (pl.cover) {
      tile.style.backgroundImage = `url(${this.app.vault.getResourcePath(pl.cover)})`;
    }

    tile.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };

    const controls = card.createDiv({ cls: "ttrpg-sb-btnrow" });

    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };

    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };

    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };

    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();

    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) stopBtn.classList.add("playing");
  }

  private renderPlaylistRow(container: HTMLElement, pl: PlaylistInfo) {
    const row = container.createDiv({ cls: "ttrpg-sb-simple-row playlist" });
    row.dataset.playlist = pl.path;

    const main = row.createDiv({ cls: "ttrpg-sb-simple-main" });
    main.createSpan({ cls: "ttrpg-sb-simple-title", text: pl.name });
    main.createSpan({ cls: "ttrpg-sb-simple-duration", text: `${pl.tracks.length} tracks` });

    main.onclick = () => {
      void this.plugin.startPlaylist(pl);
    };

    const controls = row.createDiv({ cls: "ttrpg-sb-simple-controls" });

    const prevBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(prevBtn, "skip-back");
    prevBtn.setAttr("aria-label", "Previous track");
    prevBtn.onclick = () => {
      void this.plugin.prevInPlaylist(pl);
    };

    const stopBtn = controls.createEl("button", { cls: "ttrpg-sb-stop", text: "Stop" });
    stopBtn.dataset.playlist = pl.path;
    stopBtn.onclick = () => {
      void this.plugin.stopPlaylist(pl.path);
    };

    const nextBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn" });
    setIcon(nextBtn, "skip-forward");
    nextBtn.setAttr("aria-label", "Next track");
    nextBtn.onclick = () => {
      void this.plugin.nextInPlaylist(pl);
    };

    const gearBtn = controls.createEl("button", { cls: "ttrpg-sb-icon-btn push-right" });
    setIcon(gearBtn, "gear");
    gearBtn.setAttr("aria-label", "Playlist settings");
    gearBtn.onclick = () => new PlaylistSettingsModal(this.app, this.plugin, pl.path).open();

    const isActive = this.plugin.isPlaylistActive(pl.path);
    if (isActive) {
      row.addClass("playing");
      stopBtn.classList.add("playing");
    }
  }

  private updatePlayingVisuals() {
    const btns = this.contentEl.querySelectorAll<HTMLButtonElement>(".ttrpg-sb-stop[data-path]");
    btns.forEach((b) => {
      const p = b.dataset.path || "";
      if (this.playingFiles.has(p)) b.classList.add("playing");
      else b.classList.remove("playing");
    });

    const rows = this.contentEl.querySelectorAll<HTMLElement>(".ttrpg-sb-simple-row[data-path]");
    rows.forEach((r) => {
      const p = r.dataset.path || "";
      r.toggleClass("playing", this.playingFiles.has(p));
    });

    const pbtns = this.contentEl.querySelectorAll<HTMLButtonElement>(".ttrpg-sb-stop[data-playlist]");
    pbtns.forEach((b) => {
      const p = b.dataset.playlist || "";
      const active = this.plugin.isPlaylistActive(p);
      b.toggleClass("playing", active);
    });

    const plRows = this.contentEl.querySelectorAll<HTMLElement>(".ttrpg-sb-simple-row[data-playlist]");
    plRows.forEach((r) => {
      const p = r.dataset.playlist || "";
      const active = this.plugin.isPlaylistActive(p);
      r.toggleClass("playing", active);
    });
  }
}