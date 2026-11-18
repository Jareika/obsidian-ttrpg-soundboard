import { App, FuzzySuggestModal, TFile } from "obsidian";
import { IMG_EXTS } from "../util/fileDiscovery";

export class VaultImagePickerModal extends FuzzySuggestModal<TFile> {
  private readonly items: TFile[];
  private readonly onChoose: (file: TFile) => void;

  constructor(
    app: App,
    onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.onChoose = onChoose;
    this.items = app.vault
      .getAllLoadedFiles()
      .filter(
        (file): file is TFile =>
          file instanceof TFile &&
          IMG_EXTS.includes(file.extension.toLowerCase()),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    this.setPlaceholder("Search vault image…");
  }

  getItems(): TFile[] {
    return this.items;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}