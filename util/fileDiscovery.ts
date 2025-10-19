import { App, TFile } from "obsidian";

export function findAudioFiles(app: App, folders: string[], extensions: string[]): TFile[] {
  const exts = new Set(extensions.map(e => e.toLowerCase().replace(/^\./, "")));
  const roots = (folders ?? []).map(f => f.replace(/^\/+|\/+$/g, "")).filter(Boolean);

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