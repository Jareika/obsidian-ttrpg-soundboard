import { App, PluginSettingTab, Setting } from "obsidian";

export interface SoundboardSettings {
  rootFolder: string;        // e.g. "Soundbar"
  includeRootFiles: boolean; // false = only subfolders
  folders: string[];         // legacy fallback when rootFolder is empty
  extensions: string[];
  defaultFadeInMs: number;
  defaultFadeOutMs: number;
  allowOverlap: boolean;
  masterVolume: number;
  tileHeightPx: number;      // tile height in px
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
  tileHeightPx: 100
};

export class SoundboardSettingTab extends PluginSettingTab {
  plugin: any;
  constructor(app: App, plugin: any) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTRPG Soundboard - Settings" });

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Only subfolders under this folder are listed as options. Example: Soundbar")
      .addText(ti => ti
        .setPlaceholder("Soundbar")
        .setValue(this.plugin.settings.rootFolder)
        .onChange(async v => {
          this.plugin.settings.rootFolder = v.trim();
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Include files directly in root")
      .setDesc("If enabled, files directly in the root folder are listed (otherwise only in subfolders).")
      .addToggle(tg => tg
        .setValue(this.plugin.settings.includeRootFiles)
        .onChange(async v => {
          this.plugin.settings.includeRootFiles = v;
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Folders (legacy, comma-separated)")
      .setDesc("Used only when the root folder is empty. Example: TTRPG Sounds, Audio/SFX")
      .addText(ti => ti
        .setValue(this.plugin.settings.folders.join(", "))
        .onChange(async v => {
          this.plugin.settings.folders = v.split(",").map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Allowed extensions")
      .setDesc("Comma-separated, e.g. mp3, ogg, wav, m4a, flac (flac may not be supported on iOS).")
      .addText(ti => ti
        .setValue(this.plugin.settings.extensions.join(", "))
        .onChange(async v => {
          this.plugin.settings.extensions = v.split(",").map(s => s.trim().replace(/^\./,"")).filter(Boolean);
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Fade-In (ms)")
      .addText(ti => ti
        .setValue(String(this.plugin.settings.defaultFadeInMs))
        .onChange(async v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Fade-Out (ms)")
      .addText(ti => ti
        .setValue(String(this.plugin.settings.defaultFadeOutMs))
        .onChange(async v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Allow overlap")
      .setDesc("Play multiple sounds at the same time.")
      .addToggle(tg => tg
        .setValue(this.plugin.settings.allowOverlap)
        .onChange(async v => {
          this.plugin.settings.allowOverlap = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Master volume")
      .addSlider(s => s
        .setLimits(0, 1, 0.01)
        .setValue(this.plugin.settings.masterVolume)
        .onChange(async v => {
          this.plugin.settings.masterVolume = v;
          this.plugin.engine?.setMasterVolume(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Tile height (px)")
      .setDesc("Adjust thumbnail tile height for the grid.")
      .addSlider(s => s
        .setLimits(30, 300, 1)
        .setValue(this.plugin.settings.tileHeightPx)
        .onChange(async v => {
          this.plugin.settings.tileHeightPx = v;
          this.plugin.applyCssVars();
          await this.plugin.saveSettings();
        }));
  }
}