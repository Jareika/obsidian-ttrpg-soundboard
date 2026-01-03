import { App, PluginSettingTab, Setting } from "obsidian";
import type TTRPGSoundboardPlugin from "./main";

export interface SoundboardSettings {
  rootFolder: string; // e.g. "Soundbar"
  includeRootFiles: boolean; // false = only subfolders
  folders: string[]; // legacy fallback when rootFolder is empty
  extensions: string[];
  defaultFadeInMs: number;
  defaultFadeOutMs: number;
  allowOverlap: boolean;
  masterVolume: number;
  mediaElementThresholdMB: number; // 0 disables MediaElement playback
  ambienceVolume: number; // global ambience multiplier 0..1
  simpleView: boolean; // global default: true = simple list
  folderViewModes: Record<string, "grid" | "simple">; // folderPath -> mode
  tileHeightPx: number; // tile height in px
  noteIconSizePx: number; // max height for note button thumbnails in px
  toolbarFourFolders: boolean; // if true, show 4 folder dropdowns instead of 2
  maxAudioCacheMB: number; // upper limit for decoded-audio cache in MB (0 = no caching)

  thumbnailFolderEnabled: boolean; // if enabled, thumbnails are looked up in a dedicated folder
  thumbnailFolderPath: string; // vault path to the thumbnail folder
}

export const DEFAULT_SETTINGS: SoundboardSettings = {
  rootFolder: "Soundbar",
  includeRootFiles: false,
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3000,
  defaultFadeOutMs: 3000,
  allowOverlap: true,
  masterVolume: 1,
  mediaElementThresholdMB: 25,
  ambienceVolume: 1,
  simpleView: false,
  folderViewModes: {},
  tileHeightPx: 100,
  noteIconSizePx: 40,
  toolbarFourFolders: false,
  maxAudioCacheMB: 512, // default 512 MB of decoded audio

  thumbnailFolderEnabled: false,
  thumbnailFolderPath: "",
};

export class SoundboardSettingTab extends PluginSettingTab {
  plugin: TTRPGSoundboardPlugin;

  constructor(app: App, plugin: TTRPGSoundboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Library
    new Setting(containerEl).setName("Library").setHeading();

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Only subfolders under this folder are listed as options.")
      .addText((ti) =>
        ti
          .setPlaceholder("Soundbar")
          .setValue(this.plugin.settings.rootFolder)
          .onChange((v) => {
            this.plugin.settings.rootFolder = v.trim();
            void this.plugin.saveSettings();
            this.plugin.rescan();
          }),
      );

    new Setting(containerEl)
      .setName("Include files directly in root")
      .setDesc(
        "If enabled, files directly in the root folder are listed (otherwise only in subfolders).",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.includeRootFiles)
          .onChange((v) => {
            this.plugin.settings.includeRootFiles = v;
            void this.plugin.saveSettings();
            this.plugin.rescan();
          }),
      );

    new Setting(containerEl)
      .setName("Folders (legacy, comma separated)")
      .setDesc("Used only when the root folder is empty.")
      .addText((ti) =>
        ti
          .setValue(this.plugin.settings.folders.join(", "))
          .onChange((v) => {
            this.plugin.settings.folders = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            void this.plugin.saveSettings();
            this.plugin.rescan();
          }),
      );

    new Setting(containerEl)
      .setName("Allowed extensions")
      .setDesc("E.g., mp3, ogg, wav, m4a, flac.")
      .addText((ti) =>
        ti
          .setValue(this.plugin.settings.extensions.join(", "))
          .onChange((v) => {
            this.plugin.settings.extensions = v
              .split(",")
              .map((s) => s.trim().replace(/^\./, ""))
              .filter(Boolean);
            void this.plugin.saveSettings();
            this.plugin.rescan();
          }),
      );

    // Playback
    new Setting(containerEl).setName("Playback").setHeading();

    new Setting(containerEl)
      .setName("Fade in (ms)")
      .addText((ti) =>
        ti
          .setValue(String(this.plugin.settings.defaultFadeInMs))
          .onChange((v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Fade out (ms)")
      .addText((ti) =>
        ti
          .setValue(String(this.plugin.settings.defaultFadeOutMs))
          .onChange((v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Allow overlap")
      .setDesc("Play multiple sounds at the same time.")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.allowOverlap)
          .onChange((v) => {
            this.plugin.settings.allowOverlap = v;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Master volume")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.01)
          .setValue(this.plugin.settings.masterVolume)
          .onChange((v) => {
            this.plugin.settings.masterVolume = v;
            this.plugin.engine?.setMasterVolume(v);
            void this.plugin.saveSettings();
          }),
      );
	  
    new Setting(containerEl)
      .setName("Threshold for faster large‑file audio playback (mb)")
      .setDesc(
        "Files larger than this threshold are played via the htmlaudioelement for faster startup without full decoding. Set to 0 to disable.",
      )
      .addSlider((s) =>
        s
          .setLimits(0, 512, 1)
          .setValue(this.plugin.settings.mediaElementThresholdMB)
          .setDynamicTooltip()
          .onChange((v) => {
            this.plugin.settings.mediaElementThresholdMB = v;
            this.plugin.engine?.setMediaElementThresholdMB(v);
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Decoded audio cache.")
      .setDesc(
        "Upper limit in megabytes for in-memory decoded audio buffers. 0 disables caching (minimal random access memory, more decoding).",
      )
      .addSlider((s) =>
        s
          .setLimits(0, 2048, 16)
          .setValue(this.plugin.settings.maxAudioCacheMB)
          .setDynamicTooltip()
          .onChange((v) => {
            this.plugin.settings.maxAudioCacheMB = v;
            this.plugin.engine?.setCacheLimitMB(v);
            void this.plugin.saveSettings();
          }),
      );

    // Appearance
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Four pinned folder slots")
      .setDesc(
        "If enabled, show four folder dropdowns in the soundboard toolbar (two rows) instead of two with a switch button.",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.toolbarFourFolders)
          .onChange((v) => {
            this.plugin.settings.toolbarFourFolders = v;
            void this.plugin.saveSettings();
            this.plugin.refreshViews();
          }),
      );

    new Setting(containerEl)
      .setName("Simple list view (global default)")
      .setDesc(
        "Global default: if no per-folder override exists, folders are shown either as grid or simple list.",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.simpleView)
          .onChange((v) => {
            this.plugin.settings.simpleView = v;
            void this.plugin.saveSettings();
            this.plugin.refreshViews();
          }),
      );

    // Per-folder view config
    new Setting(containerEl).setName("Per-folder view mode").setHeading();

    containerEl.createEl("p", {
      text: "For each folder you can override the global default: inherit, grid, or simple list.",
    });

    const lib = this.plugin.library;
    const topFolders = lib?.topFolders ?? [];
    const rootFolder = lib?.rootFolder;
    const rootRegex =
      rootFolder != null && rootFolder !== ""
        ? new RegExp(
            `^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`,
          )
        : null;
    const makeLabel = (f: string) => (rootRegex ? f.replace(rootRegex, "") || f : f);

    if (topFolders.length === 0) {
      containerEl.createEl("p", {
        text: "No top-level folders detected yet. Make sure your root folder exists and contains subfolders.",
      });
    } else {
      for (const folderPath of topFolders) {
        const label = makeLabel(folderPath);
        const map = this.plugin.settings.folderViewModes ?? {};
        const override = map[folderPath]; // "grid" | "simple" | undefined

        const setting = new Setting(containerEl).setName(label).setDesc(folderPath);

        const globalIsSimple = this.plugin.settings.simpleView;
        const inheritLabel = globalIsSimple ? "Inherit (simple list)" : "Inherit (grid)";

        setting.addDropdown((dd) => {
          dd.addOption("inherit", inheritLabel);
          dd.addOption("grid", "Grid");
          dd.addOption("simple", "Simple list");

          const current = override ?? "inherit";
          dd.setValue(current);

          dd.onChange((val) => {
            if (val === "inherit" || val === "grid" || val === "simple") {
              this.plugin.setFolderViewMode(folderPath, val);
            }
          });
        });
      }
    }

    new Setting(containerEl)
      .setName("Tile height (px)")
      .setDesc("Adjust thumbnail tile height for the grid.")
      .addSlider((s) =>
        s
          .setLimits(30, 300, 1)
          .setValue(this.plugin.settings.tileHeightPx)
          .onChange((v) => {
            this.plugin.settings.tileHeightPx = v;
            this.plugin.applyCssVars();
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Note button icon size (px)")
      .setDesc("Height of images used in note buttons.")
      .addSlider((s) =>
        s
          .setLimits(16, 128, 1)
          .setValue(this.plugin.settings.noteIconSizePx)
          .onChange((v) => {
            this.plugin.settings.noteIconSizePx = v;
            this.plugin.applyCssVars();
            void this.plugin.saveSettings();
          }),
      );

    // Thumbnails
    new Setting(containerEl).setName("Thumbnails").setHeading();

    const thumbFolderSetting = new Setting(containerEl)
      .setName("Thumbnail folder path")
      .setDesc(
        "Vault path to the folder containing thumbnails. When enabled, thumbnails are looked up only in this folder (by matching base filename).",
      )
      .addText((ti) =>
        ti
          .setPlaceholder("Soundbar/_thumbnails")
          .setValue(this.plugin.settings.thumbnailFolderPath)
          .onChange((v) => {
            this.plugin.settings.thumbnailFolderPath = v.trim();
            void this.plugin.saveSettings();
            this.plugin.rescan();
            this.plugin.refreshViews();
          }),
      );

    thumbFolderSetting.setDisabled(!this.plugin.settings.thumbnailFolderEnabled);

    new Setting(containerEl)
      .setName("Use shared thumbnail folder")
      .setDesc(
        "If enabled, the plugin looks for thumbnails in the shared folder instead of next to audio files.",
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.thumbnailFolderEnabled).onChange((v) => {
          this.plugin.settings.thumbnailFolderEnabled = v;
          void this.plugin.saveSettings();
          thumbFolderSetting.setDisabled(!v);
          this.plugin.rescan();
          this.plugin.refreshViews();
        }),
      );
  }
}