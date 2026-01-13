import { App, Modal, Setting } from "obsidian";
import type { ColorComponent } from "obsidian";
import type TTRPGSoundboardPlugin from "../main";
import type { SoundboardStyleSettings } from "../settings";

type StyleGroupKey = "sounds" | "ambience" | "playlists";
type StyleProp = "cardBg" | "cardBorder" | "tileBorder";

const STYLE_GROUPS: readonly StyleGroupKey[] = ["sounds", "ambience", "playlists"] as const;
const STYLE_PROPS: readonly StyleProp[] = ["cardBg", "cardBorder", "tileBorder"] as const;

function cloneStyleSettings(v: SoundboardStyleSettings): SoundboardStyleSettings {
  return {
    sounds: { ...v.sounds },
    ambience: { ...v.ambience },
    playlists: { ...v.playlists },
  };
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export class StyleSettingsModal extends Modal {
  private plugin: TTRPGSoundboardPlugin;

  constructor(app: App, plugin: TTRPGSoundboardPlugin) {
    super(app);
    this.plugin = plugin;
    this.titleEl.setText("Soundboard style");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const working = cloneStyleSettings(this.plugin.settings.style);

    this.renderGroupSounds(contentEl, working);
    this.renderGroupAmbience(contentEl, working);
    this.renderGroupPlaylists(contentEl, working);

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Restore defaults").onClick(async () => {
          for (const g of STYLE_GROUPS) {
            for (const p of STYLE_PROPS) {
              working[g][p] = "";
            }
          }

          this.plugin.settings.style = working;
          await this.plugin.saveSettings();
          this.plugin.applyCssVars();
          this.plugin.refreshViews();
          this.close();
        }),
      )
      .addButton((b) =>
        b.setCta().setButtonText("Save").onClick(async () => {
          this.plugin.settings.style = working;
          await this.plugin.saveSettings();
          this.plugin.applyCssVars();
          this.plugin.refreshViews();
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  private renderGroupSounds(parent: HTMLElement, working: SoundboardStyleSettings) {
    new Setting(parent).setName("Sounds").setHeading();
    this.addColorSetting(parent, working, "sounds", "cardBg");
    this.addColorSetting(parent, working, "sounds", "cardBorder");
    this.addColorSetting(parent, working, "sounds", "tileBorder");
  }

  private renderGroupAmbience(parent: HTMLElement, working: SoundboardStyleSettings) {
    new Setting(parent).setName("Ambience").setHeading();
    this.addColorSetting(parent, working, "ambience", "cardBg");
    this.addColorSetting(parent, working, "ambience", "cardBorder");
    this.addColorSetting(parent, working, "ambience", "tileBorder");
  }

  private renderGroupPlaylists(parent: HTMLElement, working: SoundboardStyleSettings) {
    new Setting(parent).setName("Playlists").setHeading();
    this.addColorSetting(parent, working, "playlists", "cardBg");
    this.addColorSetting(parent, working, "playlists", "cardBorder");
    this.addColorSetting(parent, working, "playlists", "tileBorder");
  }

  private addColorSetting(
    parent: HTMLElement,
    working: SoundboardStyleSettings,
    group: StyleGroupKey,
    prop: StyleProp,
  ) {
    const setting = new Setting(parent);

    if (prop === "cardBg") setting.setName("Card background");
    else if (prop === "cardBorder") setting.setName("Card border");
    else setting.setName("Tile border");

    setting.setDesc("Pick a color.");

    const statusEl = setting.descEl.createEl("div");
    const refreshStatus = () => {
      const stored = (working[group][prop] ?? "").trim();
      statusEl.setText(stored ? `Current: ${stored}` : "Current: (uses theme default)");
    };
    refreshStatus();

    const stored = (working[group][prop] ?? "").trim();
    const pickerValue = isHexColor(stored) ? stored : "#000000";

    let picker: ColorComponent | null = null;
    let suppressPickerChange = false;

    setting.addColorPicker((cp) => {
      picker = cp;
      cp.setValue(pickerValue);

      cp.onChange((v) => {
        if (suppressPickerChange) return;
        working[group][prop] = String(v ?? "").trim();
        refreshStatus();
      });
    });

    setting.addButton((b) =>
      b.setButtonText("Clear").onClick(() => {
        // Clearing means: store empty string so CSS falls back to theme defaults.
        working[group][prop] = "";
        refreshStatus();

        // Color pickers cannot show "empty", so we set a neutral value just to update the preview.
        if (picker) {
          suppressPickerChange = true;
          picker.setValue("#000000");
          suppressPickerChange = false;
        }
      }),
    );
  }
}