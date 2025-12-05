import {
  App,
  FuzzySuggestModal,
  TFile,
} from "obsidian";
import type TTRPGSoundboardPlugin from "../main";

export interface QuickPlayItem {
  file: TFile;
  label: string;
  context: string;
}

export class QuickPlayModal extends FuzzySuggestModal<QuickPlayItem> {
  private plugin: TTRPGSoundboardPlugin;
  private items: QuickPlayItem[];

  constructor(
    app: App,
    plugin: TTRPGSoundboardPlugin,
    items: QuickPlayItem[],
  ) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.setPlaceholder("Type to search sounds...");
  }

  // All items that can be chosen in this modal
  getItems(): QuickPlayItem[] {
    return this.items;
  }

  // Text used both for fuzzy search and for display in the list
  getItemText(item: QuickPlayItem): string {
    if (item.context) {
      return `${item.label} — ${item.context}`;
    }
    return item.label;
  }

  // Called when the user picks an item (Enter/Klick)
  onChooseItem(item: QuickPlayItem) {
    void this.plugin.playFromQuickPicker(item.file);
  }
}