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

  constructor(app: App, plugin: TTRPGSoundboardPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Type to search sounds...");
  }

  getItems(): QuickPlayItem[] {
    return this.plugin.buildQuickPlayItems();
  }

  getItemText(item: QuickPlayItem): string {
    if (item.context) {
      return `${item.label} — ${item.context}`;
    }
    return item.label;
  }

  renderSuggestion(item: QuickPlayItem, el: HTMLElement) {
    el.empty();

    const nameEl = el.createDiv();
    nameEl.textContent = item.label;

    if (item.context) {
      const ctxEl = el.createDiv();
      ctxEl.addClass("mod-muted");
      ctxEl.textContent = item.context;
    }
  }

  onChooseItem(item: QuickPlayItem) {
    void this.plugin.playFromQuickPicker(item.file);
  }
}