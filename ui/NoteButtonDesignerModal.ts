import { App, Modal, Notice } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import type { LibraryFile } from "../util/externalFiles";
import { VaultImagePickerModal } from "./VaultImagePickerModal";

type ButtonTargetKind = "sound" | "playlist";

interface TargetOption {
  value: string;
  label: string;
}

export class NoteButtonDesignerModal extends Modal {
  private readonly plugin: TTRPGSoundboardPlugin;
  private readonly onInsert: (markdown: string) => void;

  private targetKind: ButtonTargetKind = "sound";
  private selectedTrackIndices = new Set<number>();
  private imagePath = "";

  private categorySelect!: HTMLSelectElement;
  private targetKindSelect!: HTMLSelectElement;
  private targetSelect!: HTMLSelectElement;
  private labelInput!: HTMLInputElement;
  private exclusiveToggle!: HTMLInputElement;
  private imagePathInput!: HTMLInputElement;
  private imageSizeInput!: HTMLInputElement;
  private playlistTrackSection!: HTMLElement;
  private playlistTrackList!: HTMLElement;

  constructor(
    app: App,
    plugin: TTRPGSoundboardPlugin,
    onInsert: (markdown: string) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.onInsert = onInsert;
    this.titleEl.setText("Insert soundboard button");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ttrpg-sb-note-button-designer");

    const categories = this.plugin.library.topFolders;
    if (!categories.length) {
      contentEl.createEl("p", {
        text: "No sound-library categories are available yet.",
      });
      return;
    }

    const fields = contentEl.createDiv({
      cls: "ttrpg-sb-note-button-designer-fields",
    });

    this.createTargetKindField(fields);
    this.createCategoryField(fields, categories);
    this.createTargetField(fields);
    this.createLabelField(fields);
    this.createExclusiveField(fields);
    this.createImageField(fields);
    this.createImageSizeField(fields);

    this.playlistTrackSection = contentEl.createDiv({
      cls: "ttrpg-sb-note-button-designer-tracks",
    });
    this.playlistTrackSection.createEl("h3", {
      text: "Playlist tracks",
    });
    this.playlistTrackSection.createEl("p", {
      text: "Leave all tracks selected to play the complete playlist.",
      cls: "setting-item-description",
    });
    this.playlistTrackList = this.playlistTrackSection.createDiv({
      cls: "ttrpg-sb-playlist-editor-list",
    });

    const actions = contentEl.createDiv({
      cls: "ttrpg-sb-playlist-editor-actions",
    });

    const cancelButton = actions.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    cancelButton.onclick = () => this.close();

    const insertButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "Insert button",
      attr: { type: "button" },
    });
    insertButton.onclick = () => this.insertButton();

    this.refreshTargetOptions();
  }

  onClose(): void {
    this.contentEl.removeClass("ttrpg-sb-note-button-designer");
  }

  private createTargetKindField(parent: HTMLElement) {
    const field = this.createField(parent, "Button type");
    this.targetKindSelect = field.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": "Button type" },
    });
    this.targetKindSelect.createEl("option", {
      value: "sound",
      text: "Single sound",
    });
    this.targetKindSelect.createEl("option", {
      value: "playlist",
      text: "Playlist",
    });
    this.targetKindSelect.value = this.targetKind;

    this.targetKindSelect.onchange = () => {
      this.targetKind =
        this.targetKindSelect.value === "playlist" ? "playlist" : "sound";
      this.refreshTargetOptions();
    };
  }

  private createCategoryField(parent: HTMLElement, categories: string[]) {
    const field = this.createField(parent, "Category");
    this.categorySelect = field.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": "Sound-library category" },
    });

    for (const category of categories) {
      this.categorySelect.createEl("option", {
        value: category,
        text: this.getCategoryLabel(category),
      });
    }

    this.categorySelect.onchange = () => {
      this.refreshTargetOptions();
    };
  }

  private createTargetField(parent: HTMLElement) {
    const field = this.createField(parent, "Sound or playlist");
    this.targetSelect = field.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": "Selected sound or playlist" },
    });

    this.targetSelect.onchange = () => {
      this.updateDefaultLabel();
      this.renderPlaylistTrackSelection();
    };
  }

  private createLabelField(parent: HTMLElement) {
    const field = this.createField(parent, "Button label");
    this.labelInput = field.createEl("input", {
      type: "text",
      placeholder: "Button label",
      attr: { "aria-label": "Button label" },
    });
  }

  private createExclusiveField(parent: HTMLElement) {
    const field = this.createField(parent, "Playback behavior");

    field.createSpan({
      cls: "ttrpg-sb-note-button-designer-description",
    });

    const label = field.createEl("label", {
      cls: "ttrpg-sb-note-button-designer-checkbox",
    });
    this.exclusiveToggle = label.createEl("input", {
      type: "checkbox",
			cls: "ttrpg-sb-note-button-designer-checkbox-input",
      attr: {
        "aria-label": "Stop all other sounds before starting",
      },
    });

    label.createSpan({
      text: "Stop all other sounds before starting",
    });
  }

  private createImageField(parent: HTMLElement) {
    const field = this.createField(parent, "Button image (optional)");
    const controls = field.createDiv({
      cls: "ttrpg-sb-playlist-editor-cover-controls",
    });

    this.imagePathInput = controls.createEl("input", {
      type: "text",
      attr: {
        readonly: "true",
        "aria-label": "Selected button image",
      },
    });
    this.updateImagePathInput();

    const chooseButton = controls.createEl("button", {
      text: "Choose vault image",
      attr: { type: "button" },
    });
    chooseButton.onclick = () => {
      new VaultImagePickerModal(this.app, (file) => {
        this.imagePath = file.path;
        this.updateImagePathInput();
      }).open();
    };

    const clearButton = controls.createEl("button", {
      text: "Clear",
      attr: { type: "button" },
    });
    clearButton.onclick = () => {
      this.imagePath = "";
      this.updateImagePathInput();
    };
  }

  private createImageSizeField(parent: HTMLElement) {
    const field = this.createField(
      parent,
      "Image size in px (optional)",
      "ttrpg-sb-note-button-designer-image-size",
    );
    field.createSpan({
      cls: "ttrpg-sb-note-button-designer-description",
      text: "Overrides the global note-button icon size for this button only.",
    });

    this.imageSizeInput = field.createEl("input", {
      type: "number",
      attr: {
        min: "8",
        max: "512",
        step: "1",
        "aria-label": "Button image size in pixels",
      },
      placeholder: "Uses global size",
    });
  }

  private createField(
    parent: HTMLElement,
    label: string,
    className = "",
  ): HTMLElement {
    const field = parent.createDiv({
      cls: `ttrpg-sb-playlist-editor-field ${className}`.trim(),
    });
    field.createSpan({ text: label });
    return field;
  }

  private refreshTargetOptions() {
    const options = this.getTargetOptions();
    this.targetSelect.empty();

    for (const option of options) {
      this.targetSelect.createEl("option", {
        value: option.value,
        text: option.label,
      });
    }

    if (!options.length) {
      this.targetSelect.createEl("option", {
        value: "",
        text:
          this.targetKind === "sound"
            ? "No sounds found in this category"
            : "No playlists found in this category",
      });
      this.targetSelect.disabled = true;
    } else {
      this.targetSelect.disabled = false;
      this.targetSelect.value = options[0].value;
    }

    this.updateDefaultLabel();
    this.renderPlaylistTrackSelection();
  }

  private getTargetOptions(): TargetOption[] {
    const category = this.categorySelect.value;

    if (this.targetKind === "playlist") {
      const content = this.plugin.library.byFolder[category];
      if (!content) return [];

      return content.playlists.map((playlist) => ({
        value: playlist.path,
        label: `${playlist.name} (${playlist.tracks.length} tracks)`,
      }));
    }

    return this.plugin
      .getAllAudioFiles()
      .filter(
        (file) =>
          file.path === category || file.path.startsWith(`${category}/`),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({
        value: file.path,
        label: this.getFileLabel(file, category),
      }));
  }

  private getFileLabel(file: LibraryFile, category: string): string {
    const relative = file.path
      .slice(category.length)
      .replace(/^\/+/, "");

    return relative ? `${file.basename} — ${relative}` : file.basename;
  }

  private getCategoryLabel(category: string): string {
    const root = this.plugin.library.rootFolder;

    if (root && category.startsWith(`${root}/`)) {
      return category.slice(root.length + 1);
    }

    return category;
  }

  private updateDefaultLabel() {
    const targetPath = this.targetSelect.value;
    if (!targetPath) {
      this.labelInput.value = "";
      return;
    }

    if (this.targetKind === "playlist") {
      this.labelInput.value =
        this.plugin.findPlaylistByPath(targetPath)?.name ?? targetPath;
      return;
    }

    this.labelInput.value =
      this.plugin.findLibraryFileByPath(targetPath)?.basename ??
      targetPath.split("/").pop() ??
      targetPath;
  }

  private renderPlaylistTrackSelection() {
    if (!this.playlistTrackSection || !this.playlistTrackList) return;

    const isPlaylist = this.targetKind === "playlist";
    this.playlistTrackSection.toggleClass("is-hidden", !isPlaylist);

    if (!isPlaylist) {
      this.selectedTrackIndices.clear();
      return;
    }

    const playlist = this.plugin.findPlaylistByPath(this.targetSelect.value);
    this.playlistTrackList.empty();
    this.selectedTrackIndices.clear();

    if (!playlist || !playlist.tracks.length) {
      this.playlistTrackList.createDiv({
        cls: "ttrpg-sb-playlist-editor-empty",
        text: "This playlist has no playable tracks.",
      });
      return;
    }

    playlist.tracks.forEach((track, index) => {
      this.selectedTrackIndices.add(index);

      const row = this.playlistTrackList.createEl("label", {
        cls: "ttrpg-sb-note-button-track-checkbox",
      });
      const checkbox = row.createEl("input", {
        type: "checkbox",
      });
      checkbox.checked = true;
      checkbox.setAttr(
        "aria-label",
        `Include track ${index + 1}: ${track.basename}`,
      );

      row.createSpan({
        text: `${index + 1}. ${track.basename}`,
        title: track.path,
      });

      checkbox.onchange = () => {
        if (checkbox.checked) {
          this.selectedTrackIndices.add(index);
        } else {
          this.selectedTrackIndices.delete(index);
        }
      };
    });
  }

  private updateImagePathInput() {
    if (!this.imagePathInput) return;
    this.imagePathInput.value = this.imagePath;
    this.imagePathInput.placeholder = "No image selected";
    this.imagePathInput.title = this.imagePath;
  }

  private insertButton() {
    const targetPath = this.targetSelect.value.trim();
    if (!targetPath) {
      new Notice("Choose a sound or playlist first.");
      return;
    }

    const label = this.labelInput.value.trim();
    if (!label) {
      new Notice("Enter a button label.");
      return;
    }

    const imageSize = this.parseImageSize();
    if (imageSize === null) return;

    let targetWithSelection = targetPath;

    if (this.targetKind === "playlist") {
      const playlist = this.plugin.findPlaylistByPath(targetPath);
      if (!playlist || !playlist.tracks.length) {
        new Notice("The selected playlist has no playable tracks.");
        return;
      }

      const selected = [...this.selectedTrackIndices].sort((a, b) => a - b);
      if (!selected.length) {
        new Notice("Select at least one playlist track.");
        return;
      }

      const selectionSpec = this.createTrackSelectionSpec(
        selected,
        playlist.tracks.length,
      );

      if (selectionSpec) {
        targetWithSelection += `#${selectionSpec}`;
      }
    }

    const scheme =
      this.targetKind === "sound"
        ? this.exclusiveToggle.checked
          ? "ttrpg-exclusive-sound"
          : "ttrpg-sound"
        : this.exclusiveToggle.checked
          ? "ttrpg-exclusive-playlist"
          : "ttrpg-playlist";

    const title = this.createPresentationTitle(imageSize);
    const escapedLabel = label.replace(/([\\\]])/g, "\\$1");
    const markdown = `[${escapedLabel}](${scheme}:${targetWithSelection}${title})`;

    this.onInsert(markdown);
    this.close();
  }

  private parseImageSize(): number | undefined | null {
    const raw = this.imageSizeInput.value.trim();
    if (!raw) return undefined;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 8 || value > 512) {
      new Notice("Image size must be a whole number between 8 and 512.");
      return null;
    }

    if (!this.imagePath) {
      new Notice("Choose an image before setting an individual image size.");
      return null;
    }

    return value;
  }

  private createPresentationTitle(imageSize: number | undefined): string {
    if (!this.imagePath) return "";

    const presentation = imageSize
      ? `${this.imagePath} | ${imageSize}`
      : this.imagePath;

    return ` "${presentation.replace(/"/g, '\\"')}"`;
  }

  /**
   * Creates compact note syntax from checkbox selections:
   * [0, 2, 3, 4, 7] -> "1,3-5,8"
   *
   * No fragment is generated for a full selection, because an omitted range
   * already means "play the complete playlist".
   */
  private createTrackSelectionSpec(
    selectedIndices: number[],
    trackCount: number,
  ): string | undefined {
    if (selectedIndices.length === trackCount) {
      return undefined;
    }

    const parts: string[] = [];
    let start = selectedIndices[0];
    let previous = start;

    const pushRange = () => {
      if (start === previous) {
        parts.push(String(start + 1));
      } else {
        parts.push(`${start + 1}-${previous + 1}`);
      }
    };

    for (let index = 1; index < selectedIndices.length; index++) {
      const current = selectedIndices[index];

      if (current === previous + 1) {
        previous = current;
        continue;
      }

      pushRange();
      start = current;
      previous = current;
    }

    pushRange();
    return parts.join(",");
  }
}