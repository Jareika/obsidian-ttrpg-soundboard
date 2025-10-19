import { App, Modal, Setting } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export class PerSoundSettingsModal extends Modal {
  plugin: TTRPGSoundboardPlugin;
  filePath: string;

  constructor(app: App, plugin: TTRPGSoundboardPlugin, filePath: string) {
    super(app);
    this.plugin = plugin;
    this.filePath = filePath;
    this.titleEl.setText("Title settings");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const pref = this.plugin.getSoundPref(this.filePath);
    let fadeInStr = pref.fadeInMs != null ? String(pref.fadeInMs) : "";
    let fadeOutStr = pref.fadeOutMs != null ? String(pref.fadeOutMs) : "";
    let vol = pref.volume ?? 1;
    let loop = !!pref.loop;

    new Setting(contentEl)
      .setName("Fade-In (ms)")
      .setDesc("Leave empty to use global default.")
      .addText(ti => ti
        .setPlaceholder(String(this.plugin.settings.defaultFadeInMs))
        .setValue(fadeInStr)
        .onChange(v => { fadeInStr = v; }));

    new Setting(contentEl)
      .setName("Fade-Out (ms)")
      .setDesc("Leave empty to use global default.")
      .addText(ti => ti
        .setPlaceholder(String(this.plugin.settings.defaultFadeOutMs))
        .setValue(fadeOutStr)
        .onChange(v => { fadeOutStr = v; }));

    new Setting(contentEl)
      .setName("Volume")
      .setDesc("0–1, multiplied by master volume.")
      .addSlider(s => s
        .setLimits(0, 1, 0.01)
        .setValue(vol)
        .onChange(v => { vol = v; })
      );

    new Setting(contentEl)
      .setName("Loop by default")
      .addToggle(tg => tg.setValue(loop).onChange(v => { loop = v; }));

    new Setting(contentEl)
      .addButton(b => b
        .setButtonText("Restore defaults")
        .onClick(async () => {
          delete pref.fadeInMs;
          delete pref.fadeOutMs;
          delete pref.volume;
          delete pref.loop;
          this.plugin.setSoundPref(this.filePath, pref);
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
          this.plugin.setSoundPref(this.filePath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.close();
        }))
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
  }
}