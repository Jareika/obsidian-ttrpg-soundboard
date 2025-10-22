import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { AudioEngine } from "./audio/AudioEngine";
import SoundboardView, { VIEW_TYPE_TTRPG_SOUNDBOARD } from "./ui/SoundboardView";
import { SoundboardSettings, DEFAULT_SETTINGS, SoundboardSettingTab } from "./settings";
import { LibraryModel, PlaylistInfo, buildLibrary } from "./util/fileDiscovery";

interface SoundPrefs { loop?: boolean; volume?: number; fadeInMs?: number; fadeOutMs?: number; }
interface PlaylistPrefs { loop?: boolean; volume?: number; fadeInMs?: number; fadeOutMs?: number; }
interface PersistedData {
  settings?: SoundboardSettings;
  soundPrefs?: Record<string, SoundPrefs>;
  playlistPrefs?: Record<string, PlaylistPrefs>;
}

export default class TTRPGSoundboardPlugin extends Plugin {
  settings: SoundboardSettings;
  soundPrefs: Record<string, SoundPrefs> = {};
  playlistPrefs: Record<string, PlaylistPrefs> = {};
  engine: AudioEngine;
  library: LibraryModel = { topFolders: [], byFolder: {}, allSingles: [] };

  async onload() {
    await this.loadAll();

    this.applyCssVars();

    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);

    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf: WorkspaceLeaf) => new SoundboardView(leaf, this)
    );

    this.addRibbonIcon("music", "Open TTRPG Soundboard", () => this.activateView());
    this.addCommand({ id: "open-soundboard-view", name: "Open Soundboard View", callback: () => this.activateView() });
    this.addCommand({ id: "stop-all-sounds", name: "Stop all sounds", callback: () => this.engine.stopAll(this.settings.defaultFadeOutMs) });
    this.addCommand({
      id: "preload-audio",
      name: "Preload audio buffers",
      callback: async () => {
        const files = this.getAllAudioFilesInLibrary();
        await this.engine.preload(files);
        new Notice(`Preloaded ${files.length} files`);
      }
    });
    this.addCommand({ id: "reload-audio-list", name: "Reload audio list", callback: () => this.rescan() });

    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile) {
        const sp = this.soundPrefs[oldPath];
        if (sp) {
          this.soundPrefs[file.path] = sp;
          delete this.soundPrefs[oldPath];
          this.saveSettings();
        }
      }
      // Playlist-Prefs: falls Ordner umbenannt wurden, kann man das bei Bedarf später ergänzen.
      this.rescanDebounced();
    }));

    this.addSettingTab(new SoundboardSettingTab(this.app, this));
    await this.rescan();
  }

  onunload() {
    this.engine?.stopAll(0);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
  }

  // CSS-Variable für Kachel-Höhe
  applyCssVars() {
    const h = Math.max(30, Math.min(400, Number(this.settings.tileHeightPx || 100)));
    document.documentElement.style.setProperty("--ttrpg-tile-height", `${h}px`);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    if (leaves.length) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_TTRPG_SOUNDBOARD, active: true });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      const view = leaf.view as SoundboardView;
      view.setLibrary(this.library);
    }
  }

  async rescan() {
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: this.settings.rootFolder?.trim() ? undefined : this.settings.folders,
      exts: this.settings.extensions,
      includeRootFiles: this.settings.includeRootFiles,
    });
    this.refreshViews();
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD).forEach(l => {
      const v = l.view as SoundboardView;
      v.setLibrary(this.library);
    });
  }

  private rescanTimer: number | null = null;
  rescanDebounced(delay = 300) {
    if (this.rescanTimer) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(() => this.rescan(), delay);
  }

  getSoundPref(path: string): SoundPrefs {
    return this.soundPrefs[path] ?? (this.soundPrefs[path] = {});
  }
  setSoundPref(path: string, pref: SoundPrefs) {
    this.soundPrefs[path] = pref;
  }

  getPlaylistPref(folderPath: string): PlaylistPrefs {
    return this.playlistPrefs[folderPath] ?? (this.playlistPrefs[folderPath] = {});
  }
  setPlaylistPref(folderPath: string, pref: PlaylistPrefs) {
    this.playlistPrefs[folderPath] = pref;
  }

  async loadAll() {
    const data = (await this.loadData()) as PersistedData | null;
    if (data?.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as any) ?? {});
    }
    this.soundPrefs = data?.soundPrefs ?? {};
    this.playlistPrefs = data?.playlistPrefs ?? {};
  }

  async saveSettings() {
    const data: PersistedData = { settings: this.settings, soundPrefs: this.soundPrefs, playlistPrefs: this.playlistPrefs };
    await this.saveData(data);
    this.applyCssVars();
  }

  private getAllAudioFilesInLibrary(): TFile[] {
    const unique = new Map<string, TFile>();
    // Singles
    for (const f of this.library.allSingles) unique.set(f.path, f);
    // Playlists
    for (const top of this.library.topFolders) {
      const fc = this.library.byFolder[top];
      if (!fc) continue;
      for (const pl of fc.playlists) {
        for (const t of pl.tracks) unique.set(t.path, t);
      }
    }
    return [...unique.values()];
  }
}