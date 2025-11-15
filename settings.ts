import { App, PluginSettingTab, Setting } from "obsidian";
import type TTRPGSoundboardPlugin from "./main";

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
  plugin: TTRPGSoundboardPlugin;
  constructor(app: App, plugin: TTRPGSoundboardPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Keine Plugin-Namen in Überschriften – generische Section-Überschrift
    new Setting(containerEl)
      .setName("General")
      .setHeading();

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Only subfolders under this folder are listed as options. Example: Soundbar")
      .addText(ti => ti
        .setPlaceholder("Soundbar")
        .setValue(this.plugin.settings.rootFolder)
        .onChange(v => {
          this.plugin.settings.rootFolder = v.trim();
          void this.plugin.saveSettings();
          this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Include files directly in root")
      .setDesc("If enabled, files directly in the root folder are listed (otherwise only in subfolders).")
      .addToggle(tg => tg
        .setValue(this.plugin.settings.includeRootFiles)
        .onChange(v => {
          this.plugin.settings.includeRootFiles = v;
          void this.plugin.saveSettings();
          this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Folders (legacy, comma-separated)")
      .setDesc("Used only when the root folder is empty. Example: TTRPG Sounds, Audio/SFX")
      .addText(ti => ti
        .setValue(this.plugin.settings.folders.join(", "))
        .onChange(v => {
          this.plugin.settings.folders = v.split(",").map(s => s.trim()).filter(Boolean);
          void this.plugin.saveSettings();
          this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Allowed extensions")
      .setDesc("Comma-separated, e.g. mp3, ogg, wav, m4a, flac (flac may not be supported on iOS).")
      .addText(ti => ti
        .setValue(this.plugin.settings.extensions.join(", "))
        .onChange(v => {
          this.plugin.settings.extensions = v.split(",").map(s => s.trim().replace(/^\./,"")).filter(Boolean);
          void this.plugin.saveSettings();
          this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Fade-in (ms)")
      .addText(ti => ti
        .setValue(String(this.plugin.settings.defaultFadeInMs))
        .onChange(v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Fade-out (ms)")
      .addText(ti => ti
        .setValue(String(this.plugin.settings.defaultFadeOutMs))
        .onChange(v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Allow overlap")
      .setDesc("Play multiple sounds at the same time.")
      .addToggle(tg => tg
        .setValue(this.plugin.settings.allowOverlap)
        .onChange(v => {
          this.plugin.settings.allowOverlap = v;
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Master volume")
      .addSlider(s => s
        .setLimits(0, 1, 0.01)
        .setValue(this.plugin.settings.masterVolume)
        .onChange(v => {
          this.plugin.settings.masterVolume = v;
          this.plugin.engine?.setMasterVolume(v);
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Tile height (px)")
      .setDesc("Adjust thumbnail tile height for the grid.")
      .addSlider(s => s
        .setLimits(30, 300, 1)
        .setValue(this.plugin.settings.tileHeightPx)
        .onChange(v => {
          this.plugin.settings.tileHeightPx = v;
          this.plugin.applyCssVars();
          void this.plugin.saveSettings();
        }));
  }
}