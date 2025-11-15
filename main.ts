import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { AudioEngine } from "./audio/AudioEngine";
import SoundboardView, { VIEW_TYPE_TTRPG_SOUNDBOARD } from "./ui/SoundboardView";
import { SoundboardSettings, DEFAULT_SETTINGS, SoundboardSettingTab } from "./settings";
import { LibraryModel, buildLibrary } from "./util/fileDiscovery";

interface SoundPrefs { loop?: boolean; volume?: number; fadeInMs?: number; fadeOutMs?: number; }
interface PlaylistPrefs { loop?: boolean; volume?: number; fadeInMs?: number; fadeOutMs?: number; }
interface PersistedData {
  settings?: SoundboardSettings;
  soundPrefs?: Record<string, SoundPrefs>;
  playlistPrefs?: Record<string, PlaylistPrefs>;
}

function hasSetLibrary(v: unknown): v is { setLibrary: (lib: LibraryModel) => void } {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>)["setLibrary"] === "function";
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

    this.addRibbonIcon("music", "Open soundboard", () => { void this.activateView(); });
    this.addCommand({ id: "open-soundboard-view", name: "Open soundboard view", callback: () => { void this.activateView(); } });
    this.addCommand({ id: "stop-all-sounds", name: "Stop all sounds", callback: () => { void this.engine.stopAll(this.settings.defaultFadeOutMs); } });
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
          void this.saveSettings();
        }
      }
      // Playlist-Prefs bei Ordner-Umbenennung ggf. später ergänzen
      this.rescanDebounced();
    }));

    this.addSettingTab(new SoundboardSettingTab(this.app, this));

    // Erstaufbau
    this.rescan();
  }

  onunload() {
    void this.engine?.stopAll(0);
    // Leaves absichtlich NICHT detachen, Layout bleibt erhalten.
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
      // Intendiert ignoriert (UI), zur Linter-Beruhigung mit void markiert
      void workspace.revealLeaf(leaf);
      // Robust: alte View-Instanzen nach Reload neu binden
      await this.rebindLeafIfNeeded(leaf);
    }
  }

  rescan() {
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: this.settings.rootFolder?.trim() ? undefined : this.settings.folders,
      exts: this.settings.extensions,
      includeRootFiles: this.settings.includeRootFiles,
    });
    this.refreshViews();
  }

  refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    for (const leaf of leaves) {
      // Keine Exceptions mehr: wenn setLibrary fehlt, Leaf re-initialisieren
      void this.rebindLeafIfNeeded(leaf);
    }
  }

  private async rebindLeafIfNeeded(leaf: WorkspaceLeaf): Promise<void> {
    const view1 = leaf.view;
    if (hasSetLibrary(view1)) {
      view1.setLibrary(this.library);
      return;
    }
    try {
      // View neu initialisieren, damit die aktuelle Klassen-Version geladen wird
      await leaf.setViewState({ type: VIEW_TYPE_TTRPG_SOUNDBOARD, active: true });
      const view2 = leaf.view;
      if (hasSetLibrary(view2)) {
        view2.setLibrary(this.library);
      }
    } catch (err) {
      console.warn("TTRPG Soundboard: Konnte View nicht neu binden:", err);
    }
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
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
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