import { App, TAbstractFile, TFile, TFolder } from "obsidian";

/**
 * Legacy: Suche in einer Liste von Ordnern (rekursiv).
 */
export function findAudioFiles(app: App, folders: string[], extensions: string[]): TFile[] {
  const exts = new Set(extensions.map(e => e.toLowerCase().replace(/^\./, "")));
  const roots = (folders ?? []).map(f => normalizeFolder(f)).filter(Boolean);

  const out: TFile[] = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;

    if (roots.length === 0) { out.push(f); continue; }
    const inRoot = roots.some(r => f.path === r || f.path.startsWith(r + "/"));
    if (inRoot) out.push(f);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Liefert die direkten Subfolder eines Root-Ordners (keine tiefe Rekursion).
 */
export function listSubfolders(app: App, rootFolder: string): string[] {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof TFolder)) return [];
  const subs = af.children.filter((c): c is TFolder => c instanceof TFolder).map(c => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}

/**
 * Suche nach Audiodateien unterhalb eines Root-Ordners.
 * - includeRootFiles=false: Dateien direkt im Root werden ignoriert; nur in Subordnern.
 */
export function findAudioFilesUnderRoot(app: App, rootFolder: string, extensions: string[], includeRootFiles = false): TFile[] {
  const root = normalizeFolder(rootFolder);
  const exts = new Set(extensions.map(e => e.toLowerCase().replace(/^\./, "")));
  const out: TFile[] = [];

  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;

    if (f.path === root || f.path.startsWith(root + "/")) {
      if (!includeRootFiles) {
        const parent = f.parent?.path ?? "";
        if (parent === root) continue; // direkt im Root -> überspringen
      }
      out.push(f);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeFolder(p: string): string {
  return (p || "").replace(/^\/+|\/+$/g, "");
}