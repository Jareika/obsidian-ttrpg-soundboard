import { App, FuzzySuggestModal, TFile } from "obsidian";
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
    this.setPlaceholder("Search sound to play…");
  }

  getItems(): QuickPlayItem[] {
    return this.items;
  }

  getItemText(item: QuickPlayItem): string {
    if (item.context && item.context !== "(root)") {
      return `${item.label} — ${item.context}`;
    }
    return item.label;
  }

  onChooseItem(item: QuickPlayItem): void {
    void this.plugin.playFromQuickPicker(item.file);
  }
}