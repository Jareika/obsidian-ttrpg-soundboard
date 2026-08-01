import {
  App,
  Platform,
  PluginSettingTab,
  Setting,
  type SettingControl,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import type TTRPGSoundboardPlugin from "./main";
import { StyleSettingsModal } from "./ui/StyleSettingsModal";

export interface StyleCategorySettings {
  cardBg: string;
  cardBorder: string;
  tileBorder: string;
  buttonBg: string;
  buttonBorder: string;
  buttonColor: string;
}

export interface SoundboardStyleSettings {
  sounds: StyleCategorySettings;
  ambience: StyleCategorySettings;
  playlists: StyleCategorySettings;
}

export type ArrangementGroup = "sounds" | "ambience" | "playlists";

export type TileSizingMode = "fixed-height" | "aspect-ratio";
export type SoundLibraryLocation = "vault" | "external";

export interface SoundboardSettings {
  soundLibraryLocation: SoundLibraryLocation;
  externalSoundFolderPath: string;

  rootFolder: string; // e.g. "Soundbar"
  includeRootFiles: boolean; // false = only subfolders
  folders: string[]; // legacy fallback when rootFolder is empty
  extensions: string[];
  defaultFadeInMs: number;
  defaultFadeOutMs: number;
  allowOverlap: boolean;
  exclusivePlayback: boolean;
  masterVolume: number;
  mediaElementThresholdMB: number; // 0 disables MediaElement playback
  ambienceVolume: number; // global ambience multiplier 0..1
  simpleView: boolean; // global default: true = simple list
  folderViewModes: Record<string, "grid" | "simple">; // folderPath -> mode
  tileSizingMode: TileSizingMode; // fixed height or aspect ratio based sizing
  tileAspectRatioPreset: string; // e.g. "16:9"
  tileHeightPx: number; // tile height in px
  limitTileTitlesToOneLine: boolean; // truncate long tile titles with "..."
  noteIconSizePx: number; // max height for note button thumbnails in px
  toolbarFourFolders: boolean; // if true, show 4 folder dropdowns instead of 2
  showAllFoldersOption: boolean; // if false, hide "All folders" from toolbar dropdowns
  maxAudioCacheMB: number; // upper limit for decoded-audio cache in MB (0 = no caching)
  iosLockscreenCompatibilityMode: boolean; // force direct HTML audio playback without Web Audio routing

  thumbnailFolderEnabled: boolean; // if enabled, thumbnails are looked up in a dedicated folder
  thumbnailFolderPath: string; // vault path to the thumbnail folder

  // Arrangement
  arrangementEnabled: boolean;
  arrangementFirst: ArrangementGroup | "default";
  arrangementSecond: ArrangementGroup | "default";
  arrangementThird: ArrangementGroup | "default";

  // Styles
  style: SoundboardStyleSettings;
}

export const DEFAULT_SETTINGS: SoundboardSettings = {
  soundLibraryLocation: "vault",
  externalSoundFolderPath: "",

  rootFolder: "Soundbar",
  includeRootFiles: false,
  folders: ["TTRPG Sounds"],
  extensions: ["mp3", "ogg", "wav", "m4a", "flac"],
  defaultFadeInMs: 3000,
  defaultFadeOutMs: 3000,
  allowOverlap: true,
  exclusivePlayback: false,
  masterVolume: 1,
  mediaElementThresholdMB: 25,
  ambienceVolume: 1,
  simpleView: false,
  folderViewModes: {},
  tileSizingMode: "fixed-height",
  tileAspectRatioPreset: "16:9",
  tileHeightPx: 100,
  limitTileTitlesToOneLine: false,
  noteIconSizePx: 40,
  toolbarFourFolders: false,
  showAllFoldersOption: true,
  maxAudioCacheMB: 512, // default 512 MB of decoded audio
  iosLockscreenCompatibilityMode: false,

  thumbnailFolderEnabled: false,
  thumbnailFolderPath: "",

  arrangementEnabled: false,
  arrangementFirst: "default",
  arrangementSecond: "default",
  arrangementThird: "default",

  style: {
    sounds: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: "",
    },
    ambience: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: "",
    },
    playlists: {
      cardBg: "",
      cardBorder: "",
      tileBorder: "",
      buttonBg: "",
      buttonBorder: "",
      buttonColor: "",
    },
  },
};

export class SoundboardSettingTab extends PluginSettingTab {
  plugin: TTRPGSoundboardPlugin;

  constructor(app: App, plugin: TTRPGSoundboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  getSettingDefinitions(): SettingDefinitionItem[] {
    const externalLibraryVisible = () =>
      this.plugin.settings.soundLibraryLocation === "external";

    const topFolders = this.plugin.library?.topFolders ?? [];
    const rootFolder = this.plugin.library?.rootFolder;
    const rootRegex =
      rootFolder != null && rootFolder !== ""
        ? new RegExp(
            `^${rootFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`,
          )
        : null;
    const makeFolderLabel = (folderPath: string) =>
      rootRegex ? folderPath.replace(rootRegex, "") || folderPath : folderPath;

    const perFolderItems: SettingDefinition[] =
      topFolders.length > 0
        ? topFolders.map((folderPath) => {
            const globalIsSimple = this.plugin.settings.simpleView;
            const inheritLabel = globalIsSimple
              ? "Inherit (simple list)"
              : "Inherit (grid)";

            return this.renderSetting(
              makeFolderLabel(folderPath),
              folderPath,
              (setting) => {
                setting.addDropdown((dropdown) => {
                  dropdown.addOption("inherit", inheritLabel);
                  dropdown.addOption("grid", "Grid");
                  dropdown.addOption("simple", "Simple list");

                  const mode =
                    this.plugin.settings.folderViewModes?.[folderPath] ??
                    "inherit";
                  dropdown.setValue(mode);

                  dropdown.onChange((value) => {
                    if (
                      value === "inherit" ||
                      value === "grid" ||
                      value === "simple"
                    ) {
                      this.plugin.setFolderViewMode(folderPath, value);
                    }
                  });
                });
              },
            );
          })
        : [
            this.renderSetting(
              "No top-level folders detected yet",
              "Make sure your root folder exists and contains subfolders.",
              () => {},
            ),
          ];

    return [
      {
        type: "group",
        heading: "Library",
        items: [
          this.control(
            "Sound library location",
            "soundLibraryLocation",
            {
              type: "dropdown",
              options: {
                vault: "Inside this vault",
                external: "External folder (desktop only)",
              },
              disabled: !Platform.isDesktopApp,
            },
            "Choose whether sounds are read from this vault or from a shared external folder. External folders are available on desktop only.",
          ),
          {
            ...this.control(
              "External sound folder",
              "externalSoundFolderPath",
              {
                type: "text",
                placeholder: "D:\\TTRPG Audio",
                disabled: !Platform.isDesktopApp,
              },
              "Absolute desktop path to the shared audio library. Use the Reload audio list command after changing files outside Obsidian.",
            ),
            visible: externalLibraryVisible,
          },
          this.renderSetting(
            "Load / reload external sound library",
            "Loads the configured external folder once. Use this after changing the path or after adding files outside Obsidian.",
            (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText("Load external library")
                  .setDisabled(
                    !Platform.isDesktopApp ||
                      this.plugin.settings.soundLibraryLocation !== "external",
                  )
                  .onClick(() => {
                    void this.plugin.rescan();
                  }),
              );
            },
            externalLibraryVisible,
          ),
          this.control(
            "Root folder",
            "rootFolder",
            {
              type: "text",
              placeholder: "Soundbar",
            },
            "Only subfolders under this folder are listed as options.",
          ),
          this.control(
            "Include files directly in root",
            "includeRootFiles",
            { type: "toggle" },
            "If enabled, files directly in the root folder are listed (otherwise only in subfolders).",
          ),
          this.commaSeparatedSetting(
            "Folders (legacy, comma separated)",
            "folders",
            "Used only when the root folder is empty.",
            "TTRPG Sounds",
          ),
          this.commaSeparatedSetting(
            "Allowed extensions",
            "extensions",
            "E.g., mp3, ogg, wav, m4a, flac.",
            "mp3, ogg, wav",
            (value) =>
              value
                .split(",")
                .map((extension) =>
                  extension.trim().replace(/^\./, "").toLowerCase(),
                )
                .filter(Boolean),
          ),
        ],
      },
      {
        type: "group",
        heading: "Playback",
        items: [
          this.control(
            "Fade in (ms)",
            "defaultFadeInMs",
            { type: "number", min: 0, step: 1 },
          ),
          this.control(
            "Fade out (ms)",
            "defaultFadeOutMs",
            { type: "number", min: 0, step: 1 },
          ),
          this.control(
            "Allow retrigger overlap",
            "allowOverlap",
            { type: "toggle" },
            "Allow the same sound to play multiple times at once. Disable this to prevent stacking the same file by repeated clicks.",
          ),
          this.control(
            "Exclusive playback",
            "exclusivePlayback",
            { type: "toggle" },
            "When starting a new sound or playlist, fade out all currently playing sounds first. Useful if you want only one track at a time.",
          ),
          this.control(
            "Master volume",
            "masterVolume",
            { type: "slider", min: 0, max: 1, step: 0.01 },
          ),
          this.control(
            "Threshold for faster large-file audio playback (mb)",
            "mediaElementThresholdMB",
            { type: "slider", min: 0, max: 512, step: 1 },
            "Files larger than this threshold are played via the HTMLAudioElement for faster startup without full decoding. Set to 0 to disable.",
          ),
          this.control(
            "Decoded audio cache",
            "maxAudioCacheMB",
            { type: "slider", min: 0, max: 2048, step: 16 },
            "Upper limit in megabytes for in-memory decoded audio buffers. 0 disables caching (minimal RAM, more decoding).",
          ),
          this.control(
            "iPad/iPhone lock-screen compatibility mode",
            "iosLockscreenCompatibilityMode",
            { type: "toggle" },
            "This can help if sounds become silent after screen lock. Applies to newly started sounds.",
          ),
        ],
      },
      {
        type: "group",
        heading: "Appearance",
        items: [
          this.renderSetting(
            "Soundboard style",
            "Configure card/tile/button colors for sounds, ambience and playlists.",
            (setting) => {
              setting.addButton((button) =>
                button.setButtonText("Open style editor").onClick(() => {
                  new StyleSettingsModal(this.app, this.plugin).open();
                }),
              );
            },
          ),
          this.control(
            "Four pinned folder slots",
            "toolbarFourFolders",
            { type: "toggle" },
            "If enabled, show four folder dropdowns in the soundboard toolbar (two rows) instead of two with a switch button.",
          ),
          this.control(
            'Show "All folders" in soundboard dropdowns',
            "showAllFoldersOption",
            { type: "toggle" },
            "If disabled, the toolbar dropdowns only show concrete folders. Empty selections automatically fall back to the first available folder, which can reduce lag in very large libraries.",
          ),
          this.control(
            "Simple list view (global default)",
            "simpleView",
            { type: "toggle" },
            "Global default: if no per-folder override exists, folders are shown either as grid or simple list.",
          ),
          this.control(
            "Tile sizing mode",
            "tileSizingMode",
            {
              type: "dropdown",
              options: {
                "fixed-height": "Fixed height",
                "aspect-ratio": "Aspect ratio",
              },
            },
            "Choose whether grid tiles use a fixed height or a fixed aspect ratio.",
          ),
          {
            ...this.control(
              "Tile aspect ratio",
              "tileAspectRatioPreset",
              {
                type: "dropdown",
                options: {
                  "16:9": "16:9",
                  "3:2": "3:2",
                  "4:3": "4:3",
                  "1:1": "1:1",
                  "21:9": "21:9",
                },
              },
              "Used only when tile sizing mode is set to aspect ratio. Images still fill the tile and may crop slightly.",
            ),
            visible: () =>
              this.plugin.settings.tileSizingMode === "aspect-ratio",
          },
          {
            ...this.control(
              "Tile height (px)",
              "tileHeightPx",
              { type: "slider", min: 30, max: 300, step: 1 },
              "Adjust thumbnail tile height for the grid.",
            ),
            visible: () =>
              this.plugin.settings.tileSizingMode === "fixed-height",
          },
          this.control(
            "Limit tile titles to one line",
            "limitTileTitlesToOneLine",
            { type: "toggle" },
            'Long titles are shortened to fit the tile and end with "...".',
          ),
          this.control(
            "Note button icon size (px)",
            "noteIconSizePx",
            { type: "slider", min: 16, max: 128, step: 1 },
            "Height of images used in note buttons.",
          ),
        ],
      },
      {
        type: "group",
        heading: "Arrangement",
        items: [
          this.control(
            "Enable arrangement",
            "arrangementEnabled",
            { type: "toggle" },
            "If enabled, the soundboard groups sounds by category and shows them in your chosen order.",
          ),
          this.arrangementControl("First group", "arrangementFirst"),
          this.arrangementControl("Second group", "arrangementSecond"),
          this.arrangementControl("Third group", "arrangementThird"),
        ],
      },
      {
        type: "group",
        heading: "Per-folder view mode",
        items: perFolderItems,
      },
      {
        type: "group",
        heading: "Thumbnails",
        items: [
          this.control(
            "Use shared thumbnail folder",
            "thumbnailFolderEnabled",
            { type: "toggle" },
            "If enabled, the plugin looks for thumbnails in the shared folder instead of next to audio files.",
          ),
          {
            ...this.control(
              "Thumbnail folder path",
              "thumbnailFolderPath",
              {
                type: "text",
                placeholder: "Soundbar/_thumbnails",
              },
              "Vault path to the folder containing thumbnails. When enabled, thumbnails are looked up only in this folder (by matching base filename).",
            ),
            visible: () => this.plugin.settings.thumbnailFolderEnabled,
          },
        ],
      },
    ];
  }

  /**
   * Declarative controls automatically persist through this method.
   * Keep all existing imperative side effects centralised here.
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;

    if (
      key === "rootFolder" ||
      key === "externalSoundFolderPath" ||
      key === "thumbnailFolderPath"
    ) {
      settings[key] = typeof value === "string" ? value.trim() : value;
    } else {
      settings[key] = value;
    }

    await this.plugin.saveSettings();

    switch (key) {
      case "masterVolume":
        this.plugin.engine?.setMasterVolume(this.plugin.settings.masterVolume);
        break;
      case "mediaElementThresholdMB":
        this.plugin.engine?.setMediaElementThresholdMB(
          this.plugin.settings.mediaElementThresholdMB,
        );
        break;
      case "maxAudioCacheMB":
        this.plugin.engine?.setCacheLimitMB(this.plugin.settings.maxAudioCacheMB);
        break;
      case "iosLockscreenCompatibilityMode":
        this.plugin.engine?.setIOSLockscreenCompatibilityMode(
          this.plugin.settings.iosLockscreenCompatibilityMode,
        );
        break;
      case "ambienceVolume":
        this.plugin.updateVolumesForPlayingAmbience();
        break;
    }

    const requiresRescan = new Set([
      "rootFolder",
      "includeRootFiles",
      "folders",
      "extensions",
      "thumbnailFolderEnabled",
      "thumbnailFolderPath",
    ]);
    const requiresViewRefresh = new Set([
      "toolbarFourFolders",
      "showAllFoldersOption",
      "simpleView",
      "tileSizingMode",
      "tileAspectRatioPreset",
      "tileHeightPx",
      "limitTileTitlesToOneLine",
      "noteIconSizePx",
      "arrangementEnabled",
      "arrangementFirst",
      "arrangementSecond",
      "arrangementThird",
      "thumbnailFolderEnabled",
      "thumbnailFolderPath",
    ]);

    if (requiresRescan.has(key)) {
      await this.plugin.rescan();
      this.plugin.refreshViews();
      this.updateDeclarativeSettings();
      return;
    }

    if (requiresViewRefresh.has(key)) {
      this.plugin.refreshViews();
    }
  }

  private updateDeclarativeSettings(): void {
    const declarativeTab = this as unknown as { update?: () => void };
    declarativeTab.update?.();
  }

  private control(
    name: string,
    key: keyof SoundboardSettings,
    control: Omit<SettingControl, "key">,
    desc?: string,
  ): SettingDefinition {
    return {
      name,
      desc,
      control: {
        ...control,
        key,
      } as SettingControl,
    };
  }

  private renderSetting(
    name: string,
    desc: string,
    render: (setting: Setting) => void,
    visible?: boolean | (() => boolean),
  ): SettingDefinition {
    return {
      name,
      desc,
      visible,
      render: (setting) => {
        render(setting);
      },
    };
  }

  private commaSeparatedSetting(
    name: string,
    key: "folders" | "extensions",
    desc: string,
    placeholder: string,
    parse: (value: string) => string[] = (value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
  ): SettingDefinition {
    return this.renderSetting(name, desc, (setting) => {
      setting.addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key].join(", "))
          .onChange((value) => {
            void this.setControlValue(key, parse(value));
          }),
      );
    });
  }

  private arrangementControl(
    name: string,
    key: "arrangementFirst" | "arrangementSecond" | "arrangementThird",
  ): SettingDefinition {
    return this.control(
      name,
      key,
      {
        type: "dropdown",
        options: {
          default: "Default",
          sounds: "Sounds",
          ambience: "Ambience",
          playlists: "Playlists",
        },
      },
      "Default means: remaining groups are appended in the default order.",
    );
  }
  
  display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Library
    new Setting(containerEl).setName("Library").setHeading();

    let externalFolderSetting: Setting | undefined;
    let externalReloadSetting: Setting | undefined;

    new Setting(containerEl)
      .setName("Sound library location")
      .setDesc(
        "Choose whether sounds are read from this vault or from a shared external folder. External folders are available on desktop only.",
      )
      .addDropdown((dd) => {
        dd.addOption("vault", "Inside this vault");
        dd.addOption("external", "External folder (desktop only)");
        dd.setValue(this.plugin.settings.soundLibraryLocation);
        dd.setDisabled(!Platform.isDesktopApp);
        dd.onChange((v) => {
          if (v !== "vault" && v !== "external") return;
		  
          this.plugin.settings.soundLibraryLocation = v;
          externalFolderSetting?.setDisabled(
            !Platform.isDesktopApp || v !== "external",
          );
          externalReloadSetting?.setDisabled(
            !Platform.isDesktopApp || v !== "external",
          );

          void this.plugin.saveSettings();
        });
      });

    externalFolderSetting = new Setting(containerEl)
      .setName("External sound folder")
      .setDesc(
        "Absolute desktop path to the shared audio library. Use the reload audio list command after changing files outside Obsidian.",
      )
      .addText((ti) =>
        ti
          .setPlaceholder("D:\\TTRPG Audio")
          .setValue(this.plugin.settings.externalSoundFolderPath)
          .onChange((v) => {
            this.plugin.settings.externalSoundFolderPath = v.trim();
            void this.plugin.saveSettings();
          }),
      );

    externalFolderSetting.setDisabled(
      !Platform.isDesktopApp ||
        this.plugin.settings.soundLibraryLocation !== "external",
    );
	
    externalReloadSetting = new Setting(containerEl)
      .setName("Load / reload external sound library")
      .setDesc(
        "Loads the configured external folder once. Use this after changing the path or after adding files outside Obsidian.",
      )
      .addButton((b) =>
        b.setButtonText("Load external library").onClick(() => {
          void this.plugin.rescan();
        }),
      );

    externalReloadSetting.setDisabled(
      !Platform.isDesktopApp ||
        this.plugin.settings.soundLibraryLocation !== "external",
    );

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
            void this.plugin.rescan();
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
            void this.plugin.rescan();
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
            void this.plugin.rescan();
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
            void this.plugin.rescan();
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
      .setName("Allow retrigger overlap")
      .setDesc(
        "Allow the same sound to play multiple times at once. Disable this to prevent stacking the same file by repeated clicks.",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.allowOverlap)
          .onChange((v) => {
            this.plugin.settings.allowOverlap = v;
            void this.plugin.saveSettings();
          }),
      );
	  
    new Setting(containerEl)
      .setName("Exclusive playback")
      .setDesc(
        "When starting a new sound or playlist, fade out all currently playing sounds first. Useful if you want only one track at a time.",
      )
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.exclusivePlayback).onChange((v) => {
          this.plugin.settings.exclusivePlayback = v;
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
      .setName("Threshold for faster large-file audio playback (mb)")
      .setDesc(
        "Files larger than this threshold are played via the htmlaudioelement for faster startup without full decoding. Set to 0 to disable.",
      )
      .addSlider((s) =>
        s
          .setLimits(0, 512, 1)
          .setValue(this.plugin.settings.mediaElementThresholdMB)
          .onChange((v) => {
            this.plugin.settings.mediaElementThresholdMB = v;
            this.plugin.engine?.setMediaElementThresholdMB(v);
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Decoded audio cache")
      .setDesc(
        "Upper limit in megabytes for in-memory decoded audio buffers. 0 Disables caching (minimal random access memory, more decoding).",
      )
      .addSlider((s) =>
        s
          .setLimits(0, 2048, 16)
          .setValue(this.plugin.settings.maxAudioCacheMB)
          .onChange((v) => {
            this.plugin.settings.maxAudioCacheMB = v;
            this.plugin.engine?.setCacheLimitMB(v);
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Ipad/iphone lock-screen compatibility mode")
      .setDesc(
        "This can help if sounds become silent after screen lock. Applies to newly started sounds.",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.iosLockscreenCompatibilityMode)
          .onChange((v) => {
            this.plugin.settings.iosLockscreenCompatibilityMode = v;
            this.plugin.engine?.setIOSLockscreenCompatibilityMode(v);
            void this.plugin.saveSettings();
          }),
      );

    // Appearance
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Soundboard style")
      .setDesc("Configure card/tile/button colors for sounds, ambience and playlists.")
      .addButton((b) =>
        b.setButtonText("Open style editor").onClick(() => {
          new StyleSettingsModal(this.app, this.plugin).open();
        }),
      );

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
      .setName('Show "all folders" in soundboard dropdowns')
      .setDesc(
        "If disabled, the toolbar dropdowns only show concrete folders. Empty selections automatically fall back to the first available folder, which can reduce lag in very large libraries.",
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.showAllFoldersOption)
          .onChange((v) => {
            this.plugin.settings.showAllFoldersOption = v;
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

    // Arrangement
    new Setting(containerEl).setName("Arrangement").setHeading();

    new Setting(containerEl)
      .setName("Enable arrangement")
      .setDesc("If enabled, the soundboard groups sounds by category and shows them in your chosen order.")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.arrangementEnabled).onChange((v) => {
          this.plugin.settings.arrangementEnabled = v;
          void this.plugin.saveSettings();
          this.plugin.refreshViews();
        }),
      );

    const addArrDropdown = (name: string, key: "arrangementFirst" | "arrangementSecond" | "arrangementThird") => {
      new Setting(containerEl)
        .setName(name)
        .setDesc("Default means: remaining groups are appended in the default order.")
        .addDropdown((dd) => {
          dd.addOption("default", "Default");
          dd.addOption("sounds", "Sounds");
          dd.addOption("ambience", "Ambience");
          dd.addOption("playlists", "Playlists");
          dd.setValue(this.plugin.settings[key]);
          dd.onChange((val) => {
            if (val === "default" || val === "sounds" || val === "ambience" || val === "playlists") {
              this.plugin.settings[key] = val;
              void this.plugin.saveSettings();
              this.plugin.refreshViews();
            }
          });
        });
    };

    addArrDropdown("First group", "arrangementFirst");
    addArrDropdown("Second group", "arrangementSecond");
    addArrDropdown("Third group", "arrangementThird");

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
        const override = map[folderPath];

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
      .setName("Tile sizing mode")
      .setDesc("Choose whether grid tiles use a fixed height or a fixed aspect ratio.")
      .addDropdown((dd) => {
        dd.addOption("fixed-height", "Fixed height");
        dd.addOption("aspect-ratio", "Aspect ratio");
        dd.setValue(this.plugin.settings.tileSizingMode);
        dd.onChange((val) => {
          if (val === "fixed-height" || val === "aspect-ratio") {
            this.plugin.settings.tileSizingMode = val;
            this.plugin.applyCssVars();
            void this.plugin.saveSettings();
            this.plugin.refreshViews();
            this.renderLegacySettings();
          }
        });
      });

    const ratioSetting = new Setting(containerEl)
      .setName("Tile aspect ratio")
      .setDesc("Used only when tile sizing mode is set to aspect ratio. Images still fill the tile and may crop slightly.")
      .addDropdown((dd) => {
        dd.addOption("16:9", "16:9");
        dd.addOption("3:2", "3:2");
        dd.addOption("4:3", "4:3");
        dd.addOption("1:1", "1:1");
        dd.addOption("21:9", "21:9");
        dd.setValue(this.plugin.settings.tileAspectRatioPreset);
        dd.onChange((val) => {
          this.plugin.settings.tileAspectRatioPreset = val;
          this.plugin.applyCssVars();
          void this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });

    ratioSetting.setDisabled(this.plugin.settings.tileSizingMode !== "aspect-ratio");

    const tileHeightSetting = new Setting(containerEl)
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
			this.plugin.refreshViews();
          }),
      );
	  
    tileHeightSetting.setDisabled(this.plugin.settings.tileSizingMode !== "fixed-height");
	
    new Setting(containerEl)
      .setName("Limit tile titles to one line")
      .setDesc(
        'Long titles are shortened to fit the tile and end with "...".',
      )
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.limitTileTitlesToOneLine)
          .onChange((v) => {
            this.plugin.settings.limitTileTitlesToOneLine = v;
            void this.plugin.saveSettings();
            this.plugin.refreshViews();
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
            void this.plugin.rescan();
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
          void this.plugin.rescan();
          this.plugin.refreshViews();
        }),
      );
  }
}