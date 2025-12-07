import {
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { AudioEngine } from "./audio/AudioEngine";
import SoundboardView, {
  VIEW_TYPE_TTRPG_SOUNDBOARD,
} from "./ui/SoundboardView";
import NowPlayingView, {
  VIEW_TYPE_TTRPG_NOWPLAYING,
} from "./ui/NowPlayingView";
import {
  SoundboardSettings,
  DEFAULT_SETTINGS,
  SoundboardSettingTab,
} from "./settings";
import { LibraryModel, buildLibrary } from "./util/fileDiscovery";
import { QuickPlayModal, QuickPlayItem } from "./ui/QuickPlayModal";

interface SoundPrefs {
  loop?: boolean;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

interface PlaylistPrefs {
  loop?: boolean;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

interface DurationEntry {
  seconds: number;
  mtime: number;
  size: number;
}

interface DurationJob {
  file: TFile;
  callbacks: Set<(seconds: number) => void>;
  loading: boolean;
}

interface PersistedData {
  settings?: SoundboardSettings;
  soundPrefs?: Record<string, SoundPrefs>;
  playlistPrefs?: Record<string, PlaylistPrefs>;
  durations?: Record<string, DurationEntry>;
}

function hasSetLibrary(
  v: unknown,
): v is { setLibrary: (lib: LibraryModel) => void } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>)["setLibrary"] === "function"
  );
}

export default class TTRPGSoundboardPlugin extends Plugin {
  settings!: SoundboardSettings;
  soundPrefs: Record<string, SoundPrefs> = {};
  playlistPrefs: Record<string, PlaylistPrefs> = {};
  durations: Record<string, DurationEntry> = {};

  engine!: AudioEngine;
  library: LibraryModel = { topFolders: [], byFolder: {}, allSingles: [] };

  // Note buttons inside markdown documents
  private noteButtons = new Set<HTMLButtonElement>();
  private engineNoteUnsub?: () => void;

  // Registry of volume sliders per file path (soundboard view + now playing)
  private volumeSliders = new Map<string, Set<HTMLInputElement>>();

  private rescanTimer: number | null = null;

  // Duration metadata loading queue
  private pendingDuration = new Map<string, DurationJob>();
  private currentDurationLoads = 0;
  private readonly maxConcurrentDurationLoads = 3;

  async onload() {
    await this.loadAll();
    this.applyCssVars();

    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);
    this.engine.setCacheLimitMB(this.settings.maxAudioCacheMB);

    // Keep note buttons in sync with current playing state
    this.engineNoteUnsub = this.engine.on(() => {
      this.updateNoteButtonsPlayingState();
    });

    // Views
    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf: WorkspaceLeaf) => new SoundboardView(leaf, this),
    );

    this.registerView(
      VIEW_TYPE_TTRPG_NOWPLAYING,
      (leaf: WorkspaceLeaf) => new NowPlayingView(leaf, this),
    );

    // Ribbon + commands
    this.addRibbonIcon("music", "Open soundboard", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-soundboard-view",
      name: "Open soundboard view",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "stop-all-sounds",
      name: "Stop all sounds",
      callback: () => {
        void this.engine.stopAll(this.settings.defaultFadeOutMs);
      },
    });

    this.addCommand({
      id: "preload-audio",
      name: "Preload audio buffers",
      callback: async () => {
        const files = this.getAllAudioFilesInLibrary();
        await this.engine.preload(files);
        new Notice(
          `TTRPG Soundboard: preloaded ${files.length} files.`,
        );
      },
    });

    this.addCommand({
      id: "clear-audio-cache",
      name: "Clear decoded audio cache (free RAM)",
      callback: () => {
        this.engine.clearBufferCache();
        new Notice(
          "Cleared decoded audio cache.",
        );
      },
    });

    this.addCommand({
      id: "reload-audio-list",
      name: "Reload audio list",
      callback: () => this.rescan(),
    });

    this.addCommand({
      id: "quick-play-sound",
      name: "Quick play sound (modal)",
      callback: () => {
        const items = this.buildQuickPlayItems();
        if (!items.length) {
          new Notice(
            "No audio files found in library.",
          );
          return;
        }
        new QuickPlayModal(this.app, this, items).open();
      },
    });

    // Vault events
    this.registerEvent(
      this.app.vault.on("create", () => this.rescanDebounced()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.rescanDebounced()),
    );
    this.registerEvent(
      this.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          if (file instanceof TFile) {
            const newPath = file.path;

            const sp = this.soundPrefs[oldPath];
            if (sp) {
              this.soundPrefs[newPath] = sp;
              delete this.soundPrefs[oldPath];
            }

            const pp = this.playlistPrefs[oldPath];
            if (pp) {
              this.playlistPrefs[newPath] = pp;
              delete this.playlistPrefs[oldPath];
            }

            const dur = this.durations[oldPath];
            if (dur) {
              this.durations[newPath] = dur;
              delete this.durations[oldPath];
            }

            void this.saveSettings();
          }
          this.rescanDebounced();
        },
      ),
    );

    this.addSettingTab(new SoundboardSettingTab(this.app, this));

    // After layout restore, make sure all views are wired to the current library
    this.app.workspace.onLayoutReady(() => {
      this.refreshViews();
    });

    // Transform special markdown syntax into note buttons
    this.registerMarkdownPostProcessor((el) => {
      this.processNoteButtons(el);
    });

    // Initial library build
    this.rescan();
  }

  onunload() {
    void this.engine?.stopAll(0);
    this.engineNoteUnsub?.();
    this.noteButtons.clear();
    this.volumeSliders.clear();
    this.engine?.shutdown();
    // Leave existing leaves in the workspace; user keeps their layout.
  }

  // ===== CSS helper =====

  applyCssVars() {
    const h = Math.max(
      30,
      Math.min(400, Number(this.settings.tileHeightPx ?? 100)),
    );
    document.documentElement.style.setProperty(
      "--ttrpg-tile-height",
      `${h}px`,
    );

    const iconSize = Math.max(
      12,
      Math.min(200, Number(this.settings.noteIconSizePx ?? 40)),
    );
    document.documentElement.style.setProperty(
      "--ttrpg-note-icon-size",
      `${iconSize}px`,
    );
  }

  // ===== View activation / library wiring =====

  async activateView() {
    const { workspace } = this.app;

    // 1) Ensure main soundboard view exists in the right dock
    let sbLeaf: WorkspaceLeaf | undefined;
    const sbLeaves = workspace.getLeavesOfType(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
    );
    if (sbLeaves.length) {
      sbLeaf = sbLeaves[0];
    } else {
      sbLeaf = workspace.getRightLeaf(false);
      if (sbLeaf) {
        await sbLeaf.setViewState({
          type: VIEW_TYPE_TTRPG_SOUNDBOARD,
          active: true,
        });
      }
    }
    if (sbLeaf) {
      void workspace.revealLeaf(sbLeaf);
      await this.rebindLeafIfNeeded(sbLeaf);
    }

    // 2) Ensure now-playing view exists as a tab in the right dock
    const npLeaves =
      workspace.getLeavesOfType(VIEW_TYPE_TTRPG_NOWPLAYING);
    if (!npLeaves.length) {
      const right = workspace.getRightLeaf(true);
      if (right) {
        await right.setViewState({
          type: VIEW_TYPE_TTRPG_NOWPLAYING,
          active: false,
        });
      }
    }
  }

  rescan() {
    this.library = buildLibrary(this.app, {
      rootFolder: this.settings.rootFolder,
      foldersLegacy: this.settings.rootFolder?.trim()
        ? undefined
        : this.settings.folders,
      exts: this.settings.extensions,
      includeRootFiles: this.settings.includeRootFiles,
    });
    this.refreshViews();
  }

  refreshViews() {
    const leaves =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_TTRPG_SOUNDBOARD);
    for (const leaf of leaves) {
      void this.rebindLeafIfNeeded(leaf);
    }
    // Now-playing views only depend on engine events, not on the library.
  }

  private async rebindLeafIfNeeded(
    leaf: WorkspaceLeaf,
  ): Promise<void> {
    const view1 = leaf.view;
    if (hasSetLibrary(view1)) {
      view1.setLibrary(this.library);
      return;
    }
    try {
      // Re-create the view so the current class version is used
      await leaf.setViewState({
        type: VIEW_TYPE_TTRPG_SOUNDBOARD,
        active: true,
      });
      const view2 = leaf.view;
      if (hasSetLibrary(view2)) {
        view2.setLibrary(this.library);
      }
    } catch (err) {
      console.error("TTRPG Soundboard: could not rebind view:", err);
    }
  }

  rescanDebounced(delay = 300) {
    if (this.rescanTimer) window.clearTimeout(this.rescanTimer);
    this.rescanTimer = window.setTimeout(() => this.rescan(), delay);
  }

  // ===== Per-sound / per-playlist prefs =====

  getSoundPref(path: string): SoundPrefs {
    return (this.soundPrefs[path] ??= {});
  }

  setSoundPref(path: string, pref: SoundPrefs) {
    this.soundPrefs[path] = pref;
  }

  getPlaylistPref(folderPath: string): PlaylistPrefs {
    return (this.playlistPrefs[folderPath] ??= {});
  }

  setPlaylistPref(folderPath: string, pref: PlaylistPrefs) {
    this.playlistPrefs[folderPath] = pref;
  }

  // ===== Persistence =====

  async loadAll() {
    const data = (await this.loadData()) as PersistedData | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.soundPrefs = data?.soundPrefs ?? {};
    this.playlistPrefs = data?.playlistPrefs ?? {};
    this.durations = data?.durations ?? {};
  }

  async saveSettings() {
    const data: PersistedData = {
      settings: this.settings,
      soundPrefs: this.soundPrefs,
      playlistPrefs: this.playlistPrefs,
      durations: this.durations,
    };
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

  // ===== Ambience + volume helpers =====

  isAmbiencePath(path: string): boolean {
    const parts = path.toLowerCase().split("/");
    return parts.includes("ambience");
  }

  /**
   * Apply an effective volume (0..1) for all currently playing instances
   * of a given path, taking the global ambience volume into account.
   */
  applyEffectiveVolumeForSingle(path: string, rawVolume: number) {
    const v = Math.max(0, Math.min(1, rawVolume));
    const isAmb = this.isAmbiencePath(path);
    const effective = v * (isAmb ? this.settings.ambienceVolume : 1);
    this.engine.setVolumeForPath(path, effective);
  }

  /**
   * Called when the global ambience slider changes.
   * Adjusts volume of all currently playing ambience sounds.
   */
  updateVolumesForPlayingAmbience() {
    const playingPaths = this.engine.getPlayingFilePaths();
    for (const path of playingPaths) {
      if (!this.isAmbiencePath(path)) continue;
      const base = this.getSoundPref(path).volume ?? 1;
      this.applyEffectiveVolumeForSingle(path, base);
    }
  }

  /**
   * Adjust volume for all currently playing tracks inside a playlist folder.
   * This does NOT change any saved per-sound volume preferences.
   */
  updateVolumeForPlaylistFolder(
    folderPath: string,
    rawVolume: number,
  ) {
    const playingPaths = this.engine.getPlayingFilePaths();
    const prefix = folderPath.endsWith("/")
      ? folderPath
      : folderPath + "/";
    const v = Math.max(0, Math.min(1, rawVolume));

    for (const path of playingPaths) {
      if (path === folderPath || path.startsWith(prefix)) {
        this.applyEffectiveVolumeForSingle(path, v);
      }
    }
  }

  // ===== Simple view (grid vs list) =====

  isSimpleViewForFolder(folderPath: string): boolean {
    const key = folderPath || "";
    const override = this.settings.folderViewModes?.[key];
    if (override === "grid") return false;
    if (override === "simple") return true;
    return this.settings.simpleView;
  }

  setFolderViewMode(
    folderPath: string,
    mode: "inherit" | "grid" | "simple",
  ) {
    const key = folderPath || "";
    const map = this.settings.folderViewModes ?? {};
    if (mode === "inherit") {
      delete map[key];
    } else {
      map[key] = mode;
    }
    this.settings.folderViewModes = map;
    void this.saveSettings();
    this.refreshViews();
  }

  // ===== Volume slider registry (soundboard view + now playing) =====

  registerVolumeSliderForPath(path: string, el: HTMLInputElement) {
    if (!path) return;
    let set = this.volumeSliders.get(path);
    if (!set) {
      set = new Set();
      this.volumeSliders.set(path, set);
    }
    set.add(el);
  }

  /**
   * Called from UI sliders when the user changes a volume.
   * - updates the saved per-sound preference
   * - applies the effective volume to all currently playing instances
   * - synchronises all sliders for this path in all open views
   */
  setVolumeForPathFromSlider(
    path: string,
    rawVolume: number,
    source?: HTMLInputElement,
  ) {
    const v = Math.max(0, Math.min(1, rawVolume));
    const pref = this.getSoundPref(path);
    pref.volume = v;
    this.setSoundPref(path, pref);

    this.applyEffectiveVolumeForSingle(path, v);
    this.syncVolumeSlidersForPath(path, v, source);

    void this.saveSettings();
  }

  private syncVolumeSlidersForPath(
    path: string,
    volume: number,
    source?: HTMLInputElement,
  ) {
    const set = this.volumeSliders.get(path);
    if (!set) return;

    for (const el of Array.from(set)) {
      if (!el.isConnected) {
        set.delete(el);
        continue;
      }
      if (source && el === source) continue;
      el.value = String(volume);
    }

    if (set.size === 0) {
      this.volumeSliders.delete(path);
    }
  }

  // ===== Duration metadata (simple view) =====

  /**
   * Request a formatted duration string for a file, using a persistent cache
   * and a small queue of HTMLAudio metadata loaders.
   */
  requestDurationFormatted(file: TFile, cb: (text: string) => void) {
    const seconds = this.getCachedDurationSeconds(file);
    if (seconds != null) {
      cb(this.formatDuration(seconds));
      return;
    }

    const path = file.path;
    let job = this.pendingDuration.get(path);
    const wrapped = (secs: number) => {
      cb(this.formatDuration(secs));
    };

    if (!job) {
      job = {
        file,
        callbacks: new Set<(seconds: number) => void>(),
        loading: false,
      };
      this.pendingDuration.set(path, job);
    }
    job.callbacks.add(wrapped);

    this.startNextDurationJobs();
  }

  private getCachedDurationSeconds(file: TFile): number | null {
    const entry = this.durations[file.path];
    if (!entry) return null;
    const stat = file.stat;
    if (!stat) return null;
    if (entry.mtime === stat.mtime && entry.size === stat.size) {
      return entry.seconds;
    }
    return null;
  }

  private startNextDurationJobs() {
    if (this.currentDurationLoads >= this.maxConcurrentDurationLoads) {
      return;
    }

    const entries = Array.from(this.pendingDuration.entries());
    for (const [path, job] of entries) {
      if (this.currentDurationLoads >= this.maxConcurrentDurationLoads) {
        break;
      }
      if (job.loading) continue;

      job.loading = true;
      this.currentDurationLoads++;

      void this.loadDurationWithHtmlAudio(job.file)
        .then((seconds) => {
          const stat = job.file.stat;
          if (stat) {
            this.durations[path] = {
              seconds,
              mtime: stat.mtime,
              size: stat.size,
            };
          }

          for (const cb of job.callbacks) {
            try {
              cb(seconds);
            } catch {
              // ignore callback errors
            }
          }
          job.callbacks.clear();
          void this.saveSettings();
        })
        .catch(() => {
          for (const cb of job.callbacks) {
            try {
              cb(0);
            } catch {
              // ignore callback errors
            }
          }
          job.callbacks.clear();
        })
        .finally(() => {
          this.pendingDuration.delete(path);
          this.currentDurationLoads--;
          this.startNextDurationJobs();
        });
    }
  }

  private async loadDurationWithHtmlAudio(file: TFile): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.src = this.app.vault.getResourcePath(file);

        const cleanup = () => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          audio.src = "";
        };

        audio.onloadedmetadata = () => {
          const secs = Number.isFinite(audio.duration)
            ? audio.duration
            : 0;
          cleanup();
          resolve(secs);
        };

        audio.onerror = () => {
          cleanup();
          reject(new Error("Failed to load audio metadata"));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ===== Quick-play modal helpers =====

  buildQuickPlayItems(): QuickPlayItem[] {
    const files = this.getAllAudioFilesInLibrary().slice();
    files.sort((a, b) => a.path.localeCompare(b.path));

    const byName = new Map<string, QuickPlayItem>();

    for (const file of files) {
      const name = file.basename;
      if (byName.has(name)) continue;

      const context = this.buildContextForFile(file);
      byName.set(name, {
        file,
        label: name,
        context,
      });
    }

    const items = Array.from(byName.values());
    items.sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) return byLabel;
      return a.context.localeCompare(b.context);
    });
    return items;
  }

  private buildContextForFile(file: TFile): string {
    const path = file.path;
    const root = this.library.rootFolder;
    let rel = path;

    if (root && (path === root || path.startsWith(root + "/"))) {
      rel = path.slice(root.length + 1);
    }

    const lastSlash = rel.lastIndexOf("/");
    const folderPart = lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
    return folderPart || "(root)";
  }

  async playFromQuickPicker(file: TFile) {
    const path = file.path;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = pref.volume ?? 1;
    const effective =
      baseVol * (isAmb ? this.settings.ambienceVolume : 1);
    const fadeInMs =
      pref.fadeInMs != null
        ? pref.fadeInMs
        : this.settings.defaultFadeInMs;

    if (!this.settings.allowOverlap) {
      await this.engine.stopByFile(file, 0);
    }

    await this.engine.play(file, {
      volume: effective,
      loop: !!pref.loop,
      fadeInMs,
    });
  }

  // ===== Note buttons inside markdown =====

  /**
   * Transform markdown patterns like:
   *   [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg)
   *   [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg "thumbs/rain.png")
   * into clickable buttons that trigger playback.
   */
  private processNoteButtons(root: HTMLElement) {
    const pattern =
      /\[([^\]]+)\]\(ttrpg-sound:([^")]+)(?:\s+"([^"]+)")?\)/g;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.nodeValue &&
        node.nodeValue.includes("ttrpg-sound:")
      ) {
        textNodes.push(node as Text);
      }
    }

    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent) continue;

      const original = textNode.nodeValue ?? "";
      let lastIndex = 0;
      const frag = document.createDocumentFragment();

      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(original)) !== null) {
        const [full, label, rawPath, thumbPathRaw] = match;
        const before = original.slice(lastIndex, match.index);
        if (before) {
          frag.appendChild(document.createTextNode(before));
        }

        const path = rawPath.replace(/^\/+/, "");
        const button = document.createElement("button");
        button.classList.add("ttrpg-sb-stop");
        button.dataset.path = path;

        const thumbPath = thumbPathRaw?.trim();
        if (thumbPath) {
          const af =
            this.app.vault.getAbstractFileByPath(thumbPath);
          if (af instanceof TFile) {
            const img = document.createElement("img");
            img.src = this.app.vault.getResourcePath(af);
            img.alt = label;
            button.appendChild(img);
            button.title = label;
            button.classList.add("ttrpg-sb-note-thumb");
          } else {
            button.textContent = label;
          }
        } else {
          button.textContent = label;
        }

        button.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void this.handleNoteButtonClick(path);
        };

        this.noteButtons.add(button);
        frag.appendChild(button);

        lastIndex = match.index + full.length;
      }

      const after = original.slice(lastIndex);
      if (after) {
        frag.appendChild(document.createTextNode(after));
      }

      parent.replaceChild(frag, textNode);
    }

    if (this.noteButtons.size > 0) {
      this.updateNoteButtonsPlayingState();
    }
  }

  private async handleNoteButtonClick(path: string) {
    const af = this.app.vault.getAbstractFileByPath(path);
    if (!(af instanceof TFile)) {
      new Notice(
        `TTRPG Soundboard: file not found: ${path}`,
      );
      return;
    }

    const file = af;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = pref.volume ?? 1;
    const effective =
      baseVol * (isAmb ? this.settings.ambienceVolume : 1);

    const playing = new Set(this.engine.getPlayingFilePaths());

    if (playing.has(path)) {
      await this.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.settings.defaultFadeOutMs,
      );
    } else {
      if (!this.settings.allowOverlap) {
        await this.engine.stopByFile(file, 0);
      }
      await this.engine.play(file, {
        volume: effective,
        loop: !!pref.loop,
        fadeInMs:
          pref.fadeInMs ?? this.settings.defaultFadeInMs,
      });
    }

    this.updateNoteButtonsPlayingState();
  }

  private updateNoteButtonsPlayingState() {
    if (!this.engine) return;
    const playing = new Set(this.engine.getPlayingFilePaths());

    for (const btn of Array.from(this.noteButtons)) {
      if (!btn.isConnected) {
        this.noteButtons.delete(btn);
        continue;
      }
      const path = btn.dataset.path || "";
      btn.classList.toggle("playing", playing.has(path));
    }
  }
}