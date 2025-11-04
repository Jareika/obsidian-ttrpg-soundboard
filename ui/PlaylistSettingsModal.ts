import { App, Modal, Setting } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export class PlaylistSettingsModal extends Modal {
  plugin: TTRPGSoundboardPlugin;
  folderPath: string;

  constructor(app: App, plugin: TTRPGSoundboardPlugin, folderPath: string) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
    this.titleEl.setText("Playlist settings");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const pref = this.plugin.getPlaylistPref(this.folderPath);
    let fadeInStr = pref.fadeInMs != null ? String(pref.fadeInMs) : "";
    let fadeOutStr = pref.fadeOutMs != null ? String(pref.fadeOutMs) : "";
    let vol = pref.volume ?? 1;
    let loop = !!pref.loop;

    new Setting(contentEl)
      .setName("Fade-in (ms)")
      .setDesc("Leer lassen, um den globalen Standard zu verwenden.")
      .addText(ti => ti
        .setPlaceholder(String(this.plugin.settings.defaultFadeInMs))
        .setValue(fadeInStr)
        .onChange(v => { fadeInStr = v; }));

    new Setting(contentEl)
      .setName("Fade-out (ms)")
      .setDesc("Leer lassen, um den globalen Standard zu verwenden.")
      .addText(ti => ti
        .setPlaceholder(String(this.plugin.settings.defaultFadeOutMs))
        .setValue(fadeOutStr)
        .onChange(v => { fadeOutStr = v; }));

    new Setting(contentEl)
      .setName("Volume")
      .setDesc("0–1, wird mit der Master-Lautstärke multipliziert.")
      .addSlider(s => s
        .setLimits(0, 1, 0.01)
        .setValue(vol)
        .onChange(v => { vol = v; })
      );

    new Setting(contentEl)
      .setName("Loop (gesamte Playlist)")
      .addToggle(tg => tg.setValue(loop).onChange(v => { loop = v; }));

    new Setting(contentEl)
      .addButton(b => b
        .setButtonText("Restore defaults")
        .onClick(async () => {
          delete pref.fadeInMs;
          delete pref.fadeOutMs;
          delete pref.volume;
          delete pref.loop;
          this.plugin.setPlaylistPref(this.folderPath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.close();
        }))
      .addButton(b => b
        .setCta()
        .setButtonText("Save")
        .onClick(async () => {
          const fi = fadeInStr.trim() === "" ? undefined : Number(fadeInStr);
          const fo = fadeOutStr.trim() === "" ? undefined : Number(fadeOutStr);
          if (fi != null && Number.isNaN(fi)) return;
          if (fo != null && Number.isNaN(fo)) return;

          pref.fadeInMs = fi;
          pref.fadeOutMs = fo;
          pref.volume = vol;
          pref.loop = loop;
          this.plugin.setPlaylistPref(this.folderPath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.close();
        }))
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
  }
}