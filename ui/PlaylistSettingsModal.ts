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

    let fadeInStr = typeof pref.fadeInMs === "number" ? String(pref.fadeInMs) : "";
    let fadeOutStr = typeof pref.fadeOutMs === "number" ? String(pref.fadeOutMs) : "";
    let vol = typeof pref.volume === "number" ? pref.volume : 1;
    const originalVol = vol; // for restoring on Cancel
    let loop = !!pref.loop;
    let shuffle = !!pref.shuffle;

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
            // Live-adjust the volume for all currently playing tracks of this playlist
            this.plugin.updateVolumeForPlaylistFolder(this.folderPath, v);
          }),
      );

    new Setting(contentEl).setName("Loop playlist").addToggle((tg) =>
      tg.setValue(loop).onChange((v) => {
        loop = v;
      }),
    );

    new Setting(contentEl)
      .setName("Shuffle")
      .setDesc("If enabled, playback order is shuffled. On each loop restart, it is reshuffled.")
      .addToggle((tg) =>
        tg.setValue(shuffle).onChange((v) => {
          shuffle = v;
        }),
      );

    new Setting(contentEl)
      .setName("Insert playlist button")
      .setDesc("Insert a Markdown button for this playlist into the active note.")
      .addButton((b) =>
        b.setButtonText("Insert button").onClick(() => {
          this.plugin.insertPlaylistButtonIntoActiveNote(this.folderPath);
        }),
      );

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Restore defaults").onClick(async () => {
          delete pref.fadeInMs;
          delete pref.fadeOutMs;
          delete pref.volume;
          delete pref.loop;
          delete pref.shuffle;

          this.plugin.setPlaylistPref(this.folderPath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();

          // Reset volume of all currently playing tracks in this playlist back to 1
          this.plugin.updateVolumeForPlaylistFolder(this.folderPath, 1);

          this.close();
        }),
      )
      .addButton((b) =>
        b.setCta().setButtonText("Save").onClick(async () => {
          const fi = fadeInStr.trim() === "" ? undefined : Number(fadeInStr);
          const fo = fadeOutStr.trim() === "" ? undefined : Number(fadeOutStr);

          if (fi != null && Number.isNaN(fi)) return;
          if (fo != null && Number.isNaN(fo)) return;

          pref.fadeInMs = fi;
          pref.fadeOutMs = fo;
          pref.volume = vol;
          pref.loop = loop;

          if (shuffle) pref.shuffle = true;
          else delete pref.shuffle;

          this.plugin.setPlaylistPref(this.folderPath, pref);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.close();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => {
          // Restore the original live playlist volume
          this.plugin.updateVolumeForPlaylistFolder(this.folderPath, originalVol);
          this.close();
        }),
      );
  }
}