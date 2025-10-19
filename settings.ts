import { App, PluginSettingTab, Setting } from "obsidian";

export interface SoundboardSettings {
  folders: string[];
  extensions: string[];
  defaultFadeInMs: number;
  defaultFadeOutMs: number;
  allowOverlap: boolean;
  masterVolume: number;
}

export const DEFAULT_SETTINGS: SoundboardSettings = {
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3000,
  defaultFadeOutMs: 3000,
  allowOverlap: true,
  masterVolume: 1
};

export class SoundboardSettingTab extends PluginSettingTab {
  plugin: any;
  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTRPG Soundboard – Einstellungen" });

    new Setting(containerEl)
      .setName("Ordner (kommagetrennt)")
      .setDesc("Vault-relative Ordner, die durchsucht werden.")
      .addText(t => t
        .setPlaceholder("z.B. TTRPG Sounds, Audio/SFX")
        .setValue(this.plugin.settings.folders.join(", "))
        .onChange(async v => {
          this.plugin.settings.folders = v.split(",").map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Erlaubte Endungen")
      .setDesc("Kommagetrennt, z.B. mp3, ogg, wav, m4a, flac (Achtung: flac nicht überall unterstützt).")
      .addText(t => t
        .setValue(this.plugin.settings.extensions.join(", "))
        .onChange(async v => {
          this.plugin.settings.extensions = v.split(",").map(s => s.trim().replace(/^\./,"")).filter(Boolean);
          await this.plugin.saveSettings();
          await this.plugin.rescan();
        }));

    new Setting(containerEl)
      .setName("Fade-In (ms)")
      .addText(t => t
        .setValue(String(this.plugin.settings.defaultFadeInMs))
        .onChange(async v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeInMs = n;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Fade-Out (ms)")
      .addText(t => t
        .setValue(String(this.plugin.settings.defaultFadeOutMs))
        .onChange(async v => {
          const n = Number(v); if (!Number.isNaN(n)) this.plugin.settings.defaultFadeOutMs = n;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Overlap erlauben")
      .setDesc("Mehrere Sounds gleichzeitig abspielen.")
      .addToggle(t => t
        .setValue(this.plugin.settings.allowOverlap)
        .onChange(async v => {
          this.plugin.settings.allowOverlap = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Master-Volume")
      .addSlider(s => s
        .setLimits(0, 1, 0.01)
        .setValue(this.plugin.settings.masterVolume)
        .onChange(async v => {
          this.plugin.settings.masterVolume = v;
          this.plugin.engine?.setMasterVolume(v);
          await this.plugin.saveSettings();
        }));
  }
}