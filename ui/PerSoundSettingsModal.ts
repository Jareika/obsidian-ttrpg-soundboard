import { App, Modal, Setting } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export class PerSoundSettingsModal extends Modal {
  plugin: TTRPGSoundboardPlugin;
  filePath: string;

  constructor(app: App, plugin: TTRPGSoundboardPlugin, filePath: string) {
    super(app);
    this.plugin = plugin;
    this.filePath = filePath;
    this.titleEl.setText("Sound settings");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const pref = this.plugin.getSoundPref(this.filePath);
    const defaultLoop = this.plugin.getDefaultLoopForPath(this.filePath);
    const isAmbience = this.plugin.isAmbiencePath(this.filePath);

    let fadeInStr = typeof pref.fadeInMs === "number" ? String(pref.fadeInMs) : "";
    let fadeOutStr = typeof pref.fadeOutMs === "number" ? String(pref.fadeOutMs) : "";
    let vol = typeof pref.volume === "number" ? pref.volume : 1;
    const originalVol = vol;
    let loop = typeof pref.loop === "boolean" ? pref.loop : defaultLoop;
    let crossfadeStr =
      typeof pref.crossfadeMs === "number" ? String(pref.crossfadeMs) : "";

    new Setting(contentEl)
      .setName("Fade in (ms)")
      .setDesc("Leave empty to use the global default.")
      .addText((ti) =>
        ti
          .setPlaceholder(String(this.plugin.settings.defaultFadeInMs))
          .setValue(fadeInStr)
          .onChange((v) => {
            fadeInStr = v;
          }),
      );

    new Setting(contentEl)
      .setName("Fade out (ms)")
      .setDesc("Leave empty to use the global default.")
      .addText((ti) =>
        ti
          .setPlaceholder(String(this.plugin.settings.defaultFadeOutMs))
          .setValue(fadeOutStr)
          .onChange((v) => {
            fadeOutStr = v;
          }),
      );

    new Setting(contentEl)
      .setName("Volume")
      .setDesc("0–1, multiplied by the master volume.")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.01)
          .setValue(vol)
          .onChange((v) => {
            vol = v;
            // Live-adjust the volume for all currently playing instances of this file
            this.plugin.applyEffectiveVolumeForSingle(this.filePath, vol);
          }),
      );

    new Setting(contentEl)
      .setName("Loop by default")
      .addToggle((tg) =>
        tg.setValue(loop).onChange((v) => {
          loop = v;
        }),
      );
	  
    if (isAmbience) {
      new Setting(contentEl)
        .setName("Crossfade (ms)")
        .setDesc("When looping, restart earlier by this amount to skip silence at the end. Leave empty for default.")
        .addText((ti) =>
          ti
            .setPlaceholder("E.g. 1500")
            .setValue(crossfadeStr)
            .onChange((v) => {
              crossfadeStr = v;
            }),
        );
    }

    new Setting(contentEl)
      .setName("Insert note button")
      .setDesc("Insert a Markdown button for this sound into the active note.")
      .addButton((b) =>
        b.setButtonText("Insert button").onClick(() => {
          this.plugin.insertSoundButtonIntoActiveNote(this.filePath);
        }),
      );

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Restore defaults").onClick(async () => {
          delete pref.fadeInMs;
          delete pref.fadeOutMs;
          delete pref.volume;
          delete pref.loop;
		  delete pref.crossfadeMs;

          this.plugin.setSoundPref(this.filePath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();

          // Reset volume of currently playing instances for this file back to 1
          this.plugin.applyEffectiveVolumeForSingle(this.filePath, 1);

          this.close();
        }),
      )
      .addButton((b) =>
        b.setCta().setButtonText("Save").onClick(async () => {
          const fi = fadeInStr.trim() === "" ? undefined : Number(fadeInStr);
          const fo = fadeOutStr.trim() === "" ? undefined : Number(fadeOutStr);
          const cf =
            crossfadeStr.trim() === "" ? undefined : Number(crossfadeStr);

          if (fi != null && Number.isNaN(fi)) return;
          if (fo != null && Number.isNaN(fo)) return;
          if (cf != null && Number.isNaN(cf)) return;

          pref.fadeInMs = fi;
          pref.fadeOutMs = fo;
          pref.volume = vol;

          // Store loop only if it differs from the computed default loop.
          if (loop === defaultLoop) {
            delete pref.loop;
          } else {
            pref.loop = loop;
          }

          if (isAmbience) {
            if (cf == null || cf <= 0) delete pref.crossfadeMs;
            else pref.crossfadeMs = cf;
          }

          this.plugin.setSoundPref(this.filePath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.close();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          // Restore the original live volume if it was changed via the slider
          this.plugin.applyEffectiveVolumeForSingle(this.filePath, originalVol);
          // Preferences are unchanged; just close the modal
          this.close();
        }),
      );
  }
}