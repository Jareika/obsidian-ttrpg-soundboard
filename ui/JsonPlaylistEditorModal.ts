import { App, Modal, Notice, setIcon } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import type { LibraryFile } from "../util/externalFiles";
import type { PlaylistInfo } from "../util/fileDiscovery";
import { VaultImagePickerModal } from "./VaultImagePickerModal";

interface PlaylistEditorTrack {
  storedPath: string;
  file: LibraryFile | null;
}

interface TrackTreeNode {
  files: LibraryFile[];
  folders: Map<string, TrackTreeNode>;
}

export class JsonPlaylistEditorModal extends Modal {
  private plugin: TTRPGSoundboardPlugin;
  private loadedPlaylistPath?: string;

  private nameInput!: HTMLInputElement;
  private targetFolderSelect!: HTMLSelectElement;
  private sourceFolderSelect!: HTMLSelectElement;
  private existingPlaylistSelect!: HTMLSelectElement;
	private coverPathInput!: HTMLInputElement;

  private sourceListEl!: HTMLElement;
  private selectedListEl!: HTMLElement;
  private selectedCountEl!: HTMLElement;
  private deleteButton?: HTMLButtonElement;

  private selectedTracks: PlaylistEditorTrack[] = [];
	private coverPath = "";

  constructor(
    app: App,
    plugin: TTRPGSoundboardPlugin,
    existingPlaylistPath?: string,
  ) {
    super(app);
    this.plugin = plugin;
    this.loadedPlaylistPath = existingPlaylistPath;
    this.titleEl.setText("JSON playlist editor");
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ttrpg-sb-playlist-editor");

    const folders = this.plugin.library.topFolders;

    if (!folders.length) {
      contentEl.createEl("p", {
        text: "No top-level sound-library folders are available yet.",
      });
      return;
    }

    this.renderForm(folders);

    if (this.loadedPlaylistPath) {
      await this.loadExistingPlaylist(this.loadedPlaylistPath);
    } else {
      this.renderSourceTracks();
      this.renderSelectedTracks();
    }
  }

  onClose(): void {
    this.contentEl.removeClass("ttrpg-sb-playlist-editor");
  }

  private renderForm(folders: string[]) {
    const { contentEl } = this;

    const metadata = contentEl.createDiv({
      cls: "ttrpg-sb-playlist-editor-meta",
    });

    const nameRow = metadata.createDiv({
      cls: "ttrpg-sb-playlist-editor-field",
    });
    nameRow.createSpan({ text: "Playlist name" });
    this.nameInput = nameRow.createEl("input", {
      type: "text",
      placeholder: "Battle at the ruins",
    });

    const targetRow = metadata.createDiv({
      cls: "ttrpg-sb-playlist-editor-field",
    });
    targetRow.createSpan({ text: "Save in category" });
    this.targetFolderSelect = this.createFolderSelect(
      targetRow,
      folders,
      "Save in category",
    );

    const existingRow = metadata.createDiv({
      cls: "ttrpg-sb-playlist-editor-field",
    });
    existingRow.createSpan({ text: "Load existing JSON playlist" });
    this.existingPlaylistSelect = existingRow.createEl("select");
    this.existingPlaylistSelect.createEl("option", {
      value: "",
      text: "Create a new playlist",
    });

    for (const playlist of this.getJsonPlaylists()) {
      this.existingPlaylistSelect.createEl("option", {
        value: playlist.path,
        text: `${this.getFolderLabel(playlist.parent)} — ${playlist.name}`,
      });
    }

    this.existingPlaylistSelect.value = this.loadedPlaylistPath ?? "";
    this.existingPlaylistSelect.onchange = () => {
      const path = this.existingPlaylistSelect.value || undefined;

      if (!path) {
        this.loadedPlaylistPath = undefined;
        this.selectedTracks = [];
				this.coverPath = "";
        this.nameInput.value = "";
				this.updateCoverPathInput();
        if (this.deleteButton) {
          this.deleteButton.disabled = true;
        }
        this.renderSelectedTracks();
        return;
      }

      void this.loadExistingPlaylist(path);
    };

    const sourceRow = metadata.createDiv({
      cls: "ttrpg-sb-playlist-editor-field",
    });
    sourceRow.createSpan({ text: "Source category" });
    this.sourceFolderSelect = this.createFolderSelect(
      sourceRow,
      folders,
      "Source category",
    );
    this.sourceFolderSelect.onchange = () => {
      this.renderSourceTracks();
    };
		
    const coverRow = metadata.createDiv({
      cls: "ttrpg-sb-playlist-editor-field ttrpg-sb-playlist-editor-cover-field",
    });
    coverRow.createSpan({ text: "Cover image (optional)" });

    const coverControls = coverRow.createDiv({
      cls: "ttrpg-sb-playlist-editor-cover-controls",
    });

    this.coverPathInput = coverControls.createEl("input", {
      type: "text",
      attr: {
        readonly: "true",
        "aria-label": "Selected vault cover image",
      },
    });
    this.updateCoverPathInput();

    const chooseCoverButton = coverControls.createEl("button", {
      text: "Choose vault image",
      attr: { type: "button" },
    });
    chooseCoverButton.onclick = () => {
      new VaultImagePickerModal(this.app, (file) => {
        this.coverPath = file.path;
        this.updateCoverPathInput();
      }).open();
    };

    const clearCoverButton = coverControls.createEl("button", {
      text: "Clear",
      attr: { type: "button" },
    });
    clearCoverButton.onclick = () => {
      this.coverPath = "";
      this.updateCoverPathInput();
    };

    const columns = contentEl.createDiv({
      cls: "ttrpg-sb-playlist-editor-columns",
    });

    const sourceColumn = columns.createDiv({
      cls: "ttrpg-sb-playlist-editor-column",
    });
    sourceColumn.createEl("h3", { text: "Available tracks" });
    this.sourceListEl = sourceColumn.createDiv({
      cls: "ttrpg-sb-playlist-editor-list",
    });

    const selectedColumn = columns.createDiv({
      cls: "ttrpg-sb-playlist-editor-column",
    });
    const selectedHeading = selectedColumn.createDiv({
      cls: "ttrpg-sb-playlist-editor-selected-heading",
    });
    selectedHeading.createEl("h3", { text: "Playlist tracks" });
    this.selectedCountEl = selectedHeading.createSpan();
    this.selectedListEl = selectedColumn.createDiv({
      cls: "ttrpg-sb-playlist-editor-list",
    });

    const actions = contentEl.createDiv({
      cls: "ttrpg-sb-playlist-editor-actions",
    });

    this.deleteButton = actions.createEl("button", {
      text: "Delete",
      attr: { type: "button" },
    });
    this.deleteButton.disabled = !this.loadedPlaylistPath;
    this.deleteButton.onclick = () => {
      void this.deleteLoadedPlaylist();
    };

    const cancelButton = actions.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    cancelButton.onclick = () => this.close();

    const saveButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "Save playlist",
      attr: { type: "button" },
    });
    saveButton.onclick = () => {
      void this.savePlaylist();
    };
  }

  private createFolderSelect(
    parent: HTMLElement,
    folders: string[],
		label: string,
  ): HTMLSelectElement {
    const select = parent.createEl("select", {
      cls: "dropdown",
      attr: {
        "aria-label": label,
      },
    });

    for (const folder of folders) {
      select.createEl("option", {
        value: folder,
        text: this.getFolderLabel(folder),
      });
    }

    return select;
  }
	
  private updateCoverPathInput() {
    if (!this.coverPathInput) return;

    this.coverPathInput.value = this.coverPath;
    this.coverPathInput.placeholder = "No cover image selected";
    this.coverPathInput.title = this.coverPath;
  }

  private getFolderLabel(folder: string): string {
    const root = this.plugin.library.rootFolder;

    if (root && folder.startsWith(`${root}/`)) {
      return folder.slice(root.length + 1);
    }

    return folder;
  }

  private getJsonPlaylists(): PlaylistInfo[] {
    const playlists: PlaylistInfo[] = [];

    for (const folder of this.plugin.library.topFolders) {
      const content = this.plugin.library.byFolder[folder];
      if (!content) continue;

      playlists.push(
        ...content.playlists.filter((playlist) => playlist.kind === "json"),
      );
    }

    return playlists.sort((a, b) => {
      const byParent = a.parent.localeCompare(b.parent);
      return byParent !== 0 ? byParent : a.name.localeCompare(b.name);
    });
  }

  private async loadExistingPlaylist(path: string): Promise<void> {
    try {
      const document = await this.plugin.loadJsonPlaylistDocument(path);
      const playlist = this.plugin.findPlaylistByPath(path);

      if (!playlist) {
        throw new Error("The selected playlist no longer exists.");
      }

      this.loadedPlaylistPath = path;
      this.nameInput.value = document.name;
      this.targetFolderSelect.value = playlist.parent;
      this.sourceFolderSelect.value = playlist.parent;
      this.coverPath = document.cover ?? "";
      this.updateCoverPathInput();
      this.selectedTracks = document.tracks.map((storedPath) => ({
        storedPath,
        file: this.plugin.resolveJsonPlaylistTrackPath(storedPath),
      }));

      this.existingPlaylistSelect.value = path;
      if (this.deleteButton) {
        this.deleteButton.disabled = false;
      }

      this.renderSourceTracks();
      this.renderSelectedTracks();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Could not load JSON playlist: ${message}`);
    }
  }

  /**
   * Only the source pane is rebuilt when its dropdown changes. The selected
   * track pane remains untouched, so its order and scroll position stay put.
   */
  private renderSourceTracks() {
    const previousScrollTop = this.sourceListEl.scrollTop;
    this.sourceListEl.empty();

    const sourceFolder = this.sourceFolderSelect.value;
    const files = this.plugin
      .getAllAudioFiles()
      .filter(
        (file) =>
          file.path === sourceFolder ||
          file.path.startsWith(`${sourceFolder}/`),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (!files.length) {
      this.sourceListEl.createDiv({
        cls: "ttrpg-sb-playlist-editor-empty",
        text: "No audio files found in this category.",
      });
      return;
    }

    const rootNode: TrackTreeNode = {
      files: [],
      folders: new Map(),
    };

    for (const file of files) {
      const relativePath = file.path
        .slice(sourceFolder.length)
        .replace(/^\/+/, "");
      const parts = relativePath.split("/").filter(Boolean);
      const fileName = parts.pop();

      if (!fileName) continue;

      let node = rootNode;

      for (const part of parts) {
        let child = node.folders.get(part);
        if (!child) {
          child = { files: [], folders: new Map() };
          node.folders.set(part, child);
        }
        node = child;
      }

      node.files.push(file);
    }

    this.renderTrackTreeNode(this.sourceListEl, rootNode, true);

    window.requestAnimationFrame(() => {
      if (this.sourceListEl.isConnected) {
        this.sourceListEl.scrollTop = previousScrollTop;
      }
    });
  }

  private renderTrackTreeNode(
    parent: HTMLElement,
    node: TrackTreeNode,
    isRoot = false,
  ) {
    for (const file of node.files.sort((a, b) =>
      a.basename.localeCompare(b.basename),
    )) {
      this.renderAvailableTrack(parent, file);
    }

    for (const [name, child] of [...node.folders.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const details = parent.createEl("details", {
        cls: "ttrpg-sb-playlist-editor-folder",
      });
      details.open = isRoot;
      details.createEl("summary", { text: name });

      const children = details.createDiv({
        cls: "ttrpg-sb-playlist-editor-folder-children",
      });
      this.renderTrackTreeNode(children, child);
    }
  }

  private renderAvailableTrack(parent: HTMLElement, file: LibraryFile) {
    const row = parent.createDiv({
      cls: "ttrpg-sb-playlist-editor-track-row",
    });

    row.createSpan({
      cls: "ttrpg-sb-playlist-editor-track-name",
      text: file.basename,
      title: file.path,
    });

    const addButton = this.createIconButton(
      row,
      "plus",
      "Add track to playlist",
    );
    addButton.onclick = () => {
      this.selectedTracks.push({
        storedPath: this.plugin.getJsonPlaylistTrackPath(file),
        file,
      });
      this.renderSelectedTracks();
    };

    const playButton = this.createIconButton(row, "play", "Preview track");
    playButton.onclick = () => {
      void this.plugin.playFromQuickPicker(file);
    };

    const stopButton = this.createIconButton(row, "square", "Stop track");
    stopButton.onclick = () => {
      const pref = this.plugin.getSoundPref(file.path);
      void this.plugin.engine.stopByFile(
        file,
        pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs,
      );
    };
  }

  /**
   * Track additions/removals/reordering rebuild only this independently
   * scrollable pane. The modal itself and the expandable source tree are not
   * rerendered, preventing the user from being sent back to the beginning.
   */
  private renderSelectedTracks() {
    const previousScrollTop = this.selectedListEl.scrollTop;
    this.selectedListEl.empty();
    this.selectedCountEl.setText(`${this.selectedTracks.length} tracks`);

    if (!this.selectedTracks.length) {
      this.selectedListEl.createDiv({
        cls: "ttrpg-sb-playlist-editor-empty",
        text: "Add tracks from the source list.",
      });
      return;
    }

    this.selectedTracks.forEach((entry, index) => {
      const row = this.selectedListEl.createDiv({
        cls: "ttrpg-sb-playlist-editor-track-row",
      });

      row.createSpan({
        cls: "ttrpg-sb-playlist-editor-track-index",
        text: `${index + 1}.`,
      });

      row.createSpan({
        cls: entry.file
          ? "ttrpg-sb-playlist-editor-track-name"
          : "ttrpg-sb-playlist-editor-track-name is-missing",
        text: entry.file
          ? entry.file.basename
          : `Missing: ${entry.storedPath}`,
        title: entry.storedPath,
      });

      const upButton = this.createIconButton(row, "arrow-up", "Move up");
      upButton.disabled = index === 0;
      upButton.onclick = () => {
        this.moveTrack(index, index - 1);
      };

      const downButton = this.createIconButton(
        row,
        "arrow-down",
        "Move down",
      );
      downButton.disabled =
        index === this.selectedTracks.length - 1;
      downButton.onclick = () => {
        this.moveTrack(index, index + 1);
      };

      if (entry.file) {
        const playButton = this.createIconButton(row, "play", "Preview track");
        playButton.onclick = () => {
          void this.plugin.playFromQuickPicker(entry.file!);
        };

        const stopButton = this.createIconButton(row, "square", "Stop track");
        stopButton.onclick = () => {
          const pref = this.plugin.getSoundPref(entry.file!.path);
          void this.plugin.engine.stopByFile(
            entry.file!,
            pref.fadeOutMs ?? this.plugin.settings.defaultFadeOutMs,
          );
        };
      }

      const removeButton = this.createIconButton(row, "x", "Remove track");
      removeButton.onclick = () => {
        this.selectedTracks.splice(index, 1);
        this.renderSelectedTracks();
      };
    });

    window.requestAnimationFrame(() => {
      if (this.selectedListEl.isConnected) {
        this.selectedListEl.scrollTop = previousScrollTop;
      }
    });
  }

  private moveTrack(from: number, to: number) {
    if (to < 0 || to >= this.selectedTracks.length) return;

    const [entry] = this.selectedTracks.splice(from, 1);
    this.selectedTracks.splice(to, 0, entry);
    this.renderSelectedTracks();
  }

  private createIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "ttrpg-sb-icon-btn",
      attr: {
        type: "button",
        "aria-label": label,
      },
    });

    button.title = label;
    setIcon(button, icon);
    return button;
  }

  private async savePlaylist() {
    try {
      const path = await this.plugin.saveJsonPlaylist({
        existingPlaylistPath: this.loadedPlaylistPath,
        parentFolder: this.targetFolderSelect.value,
        name: this.nameInput.value,
        tracks: this.selectedTracks.map((track) => track.storedPath),
				coverPath: this.coverPath || undefined,
      });

      new Notice("JSON playlist saved.");
      this.loadedPlaylistPath = path;
      this.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Could not save JSON playlist: ${message}`);
    }
  }

  private async deleteLoadedPlaylist() {
    if (!this.loadedPlaylistPath) return;

    try {
      await this.plugin.deleteJsonPlaylist(this.loadedPlaylistPath);
      new Notice("JSON playlist deleted.");
      this.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Could not delete JSON playlist: ${message}`);
    }
  }
}