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

interface PersistedData {
  settings?: SoundboardSettings;
  soundPrefs?: Record<string, SoundPrefs>;
  playlistPrefs?: Record<string, PlaylistPrefs>;
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
  engine!: AudioEngine;
  library: LibraryModel = { topFolders: [], byFolder: {}, allSingles: [] };

  // Note buttons inside markdown documents
  private noteButtons = new Set<HTMLButtonElement>();
  private engineNoteUnsub?: () => void;

  private rescanTimer: number | null = null;

  async onload() {
    await this.loadAll();
    this.applyCssVars();

    this.engine = new AudioEngine(this.app);
    this.engine.setMasterVolume(this.settings.masterVolume);

    // Keep note buttons in sync with current playing state
    this.engineNoteUnsub = this.engine.on(() => {
      this.updateNoteButtonsPlayingState();
    });

    // Main soundboard view
    this.registerView(
      VIEW_TYPE_TTRPG_SOUNDBOARD,
      (leaf: WorkspaceLeaf) => new SoundboardView(leaf, this),
    );

    // Now-playing companion view
    this.registerView(
      VIEW_TYPE_TTRPG_NOWPLAYING,
      (leaf: WorkspaceLeaf) => new NowPlayingView(leaf, this),
    );

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
        new Notice(`Preloaded ${files.length} files`);
      },
    });

    this.addCommand({
      id: "reload-audio-list",
      name: "Reload audio list",
      callback: () => this.rescan(),
    });

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
            const sp = this.soundPrefs[oldPath];
            if (sp) {
              this.soundPrefs[file.path] = sp;
              delete this.soundPrefs[oldPath];
              void this.saveSettings();
            }
          }
          // Playlist prefs for renamed folders could be migrated later if needed
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
    // We intentionally do not detach leaves so the user's layout persists.
  }

  // ===== CSS helper =====

  applyCssVars() {
    // Tile height for grid thumbnails
    const h = Math.max(
      30,
      Math.min(400, Number(this.settings.tileHeightPx || 100)),
    );
    document.documentElement.style.setProperty(
      "--ttrpg-tile-height",
      `${h}px`,
    );

    // Max height for note button thumbnails
    const iconSize = Math.max(
      12,
      Math.min(200, Number(this.settings.noteIconSizePx || 40)),
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
      await sbLeaf?.setViewState({
        type: VIEW_TYPE_TTRPG_SOUNDBOARD,
        active: true,
      });
    }
    if (sbLeaf) {
      void workspace.revealLeaf(sbLeaf);
      await this.rebindLeafIfNeeded(sbLeaf);
    }

    // 2) Ensure now-playing view exists as a tab in the right dock
    const npLeaves = workspace.getLeavesOfType(VIEW_TYPE_TTRPG_NOWPLAYING);
    if (!npLeaves.length) {
      const right = workspace.getRightLeaf(true);
      await right?.setViewState({
        type: VIEW_TYPE_TTRPG_NOWPLAYING,
        active: false,
      });
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

  private async rebindLeafIfNeeded(leaf: WorkspaceLeaf): Promise<void> {
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
  }

  async saveSettings() {
    const data: PersistedData = {
      settings: this.settings,
      soundPrefs: this.soundPrefs,
      playlistPrefs: this.playlistPrefs,
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
   */
  updateVolumeForPlaylistFolder(folderPath: string, rawVolume: number) {
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

  // ===== Note buttons inside markdown =====

  /**
   * Transform markdown patterns like:
   *   Play [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg)
   *   Play [Rain](ttrpg-sound:Folder/Sub/MyFile.ogg "thumbs/rain.png")
   * into clickable buttons that trigger playback.
   *
   * We do NOT rely on Obsidian turning this into <a> tags, because in some
   * cases it keeps the markdown as plain text. Instead we scan text nodes
   * and replace the matching parts with <button> elements.
   */
  private processNoteButtons(root: HTMLElement) {
    // Pattern:
    // [label](ttrpg-sound:path "optional/thumbnail.png")
    const pattern =
      /\[([^\]]+)\]\(ttrpg-sound:([^")]+)(?:\s+"([^"]+)")?\)/g;

    // Collect all text nodes that mention "ttrpg-sound:"
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

        const path = rawPath.replace(/^\/+/, ""); // normalize leading slashes
        const button = document.createElement("button");
        button.classList.add("ttrpg-sb-stop");
        button.dataset.path = path;

        const thumbPath = thumbPathRaw?.trim();
        if (thumbPath) {
          // Try to load thumbnail from vault
          const af = this.app.vault.getAbstractFileByPath(thumbPath);
          if (af instanceof TFile) {
            const img = document.createElement("img");
            img.src = this.app.vault.getResourcePath(af);
            img.alt = label;
            button.appendChild(img);
            button.title = label;
            // Mark as thumbnail-style button (image only)
            button.classList.add("ttrpg-sb-note-thumb");
          } else {
            // Fallback: no such file, just show label text
            button.textContent = label;
          }
        } else {
          // No thumbnail specified: plain text button
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
      new Notice(`TTRPG Soundboard: file not found: ${path}`);
      return;
    }

    const file = af as TFile;
    const pref = this.getSoundPref(path);
    const isAmb = this.isAmbiencePath(path);
    const baseVol = pref.volume ?? 1;
    const effective =
      baseVol * (isAmb ? this.settings.ambienceVolume : 1);

    const playing = new Set(this.engine.getPlayingFilePaths());

    if (playing.has(path)) {
      // Toggle: if this sound is already playing, stop all instances of it
      await this.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.settings.defaultFadeOutMs,
      );
    } else {
      // Start playback, respecting allowOverlap for this file
      if (!this.settings.allowOverlap) {
        await this.engine.stopByFile(file, 0);
      }
      await this.engine.play(file, {
        volume: effective,
        loop: !!pref.loop,
        fadeInMs: pref.fadeInMs ?? this.settings.defaultFadeInMs,
      });
    }

    this.updateNoteButtonsPlayingState();
  }

  private updateNoteButtonsPlayingState() {
    if (!this.engine) return;
    const playing = new Set(this.engine.getPlayingFilePaths());

    for (const btn of Array.from(this.noteButtons)) {
      // Drop buttons that are no longer attached to the DOM
      if (!btn.isConnected) {
        this.noteButtons.delete(btn);
        continue;
      }
      const path = btn.dataset.path || "";
      btn.classList.toggle("playing", playing.has(path));
    }
  }
}