import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { AudioEngine } from "./audio/AudioEngine";
import SoundboardView, { VIEW_TYPE_TTRPG_SOUNDBOARD } from "./ui/SoundboardView";
import { SoundboardSettings, DEFAULT_SETTINGS, SoundboardSettingTab } from "./settings";
import { findAudioFiles, findAudioFilesUnderRoot, listSubfolders } from "./util/fileDiscovery";

interface SoundPrefs { loop?: boolean; volume?: number; fadeInMs?: number; fadeOutMs?: number; }
interface PersistedData { settings?: SoundboardSettings; soundPrefs?: Record<string, SoundPrefs>; }

export default class TTRPGSoundboardPlugin extends Plugin {
  settings: SoundboardSettings;
  soundPrefs: Record<string, SoundPrefs> = {};
  engine: AudioEngine;
  allFiles: TFile[] = [];
  subfolders: string[] = [];

  async onload() {
    await this.loadAll();
    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);

    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf: WorkspaceLeaf) => new SoundboardView(leaf, this)
    );

    this.addRibbonIcon("music", "Open TTRPG Soundboard", () => this.activateView());
    this.addCommand({ id: "open-soundboard-view", name: "Open Soundboard View", callback: () => this.activateView() });
    this.addCommand({ id: "stop-all-sounds", name: "Stop all sounds", callback: () => this.engine.stopAll(this.settings.defaultFadeOutMs) });
    this.addCommand({ id: "preload-audio", name: "Preload audio buffers", callback: async () => {
      await this.engine.preload(this.allFiles);
      new Notice(`Preloaded ${this.allFiles.length} files`);
    }});
    this.addCommand({ id: "reload-audio-list", name: "Reload audio list", callback: () => this.rescan() });

    this.registerEvent(this.app.vault.on("create", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("delete", () => this.rescanDebounced()));
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (file instanceof TFile) {
        const pref = this.soundPrefs[oldPath];
        if (pref) {
          this.soundPrefs[file.path] = pref;
          delete this.soundPrefs[oldPath];
          this.saveSettings();
        }
      }
      this.rescanDebounced();
    }));

    this.addSettingTab(new SoundboardSettingTab(this.app, this));
    await this.rescan();
  }

  onunload() {
    this.engine?.stopAll(0);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
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
      view.setFiles(this.allFiles);
    }
  }

  async rescan() {
    if (this.settings.rootFolder?.trim()) {
      this.subfolders = listSubfolders(this.app, this.settings.rootFolder);
      this.allFiles = findAudioFilesUnderRoot(this.app, this.settings.rootFolder, this.settings.extensions, this.settings.includeRootFiles);
    } else {
      this.subfolders = [];
      this.allFiles = findAudioFiles(this.app, this.settings.folders, this.settings.extensions);
    }
    this.refreshViews(); // stellt auch sicher, dass Dateien in die Views gesetzt werden
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD).forEach(l => {
      const v = l.view as SoundboardView;
      v.setFiles(this.allFiles); // wichtig: Dateien setzen, nicht nur rendern
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

  async loadAll() {
    const data = (await this.loadData()) as PersistedData | null;
    if (data?.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, (data as any) ?? {});
    }
    this.soundPrefs = data?.soundPrefs ?? {};
  }

  async saveSettings() {
    const data: PersistedData = { settings: this.settings, soundPrefs: this.soundPrefs };
    await this.saveData(data);
  }
}