import { App, TFile, TFolder } from "obsidian";

export const IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

export interface PlaylistInfo {
  path: string;     // vollständiger Ordnerpfad (z.B. Root/Cat1/PlaylistA)
  name: string;     // Ordnername
  parent: string;   // Pfad des Eltern-Ordners (Top-Level)
  tracks: TFile[];  // Audiodateien im Playlist-Ordner (rekursiv)
  cover?: TFile;    // cover.jpg usw. oder erstes Bild
}

export interface FolderContent {
  folder: string;         // Top-Level-Ordner
  files: TFile[];         // Audios direkt in diesem Ordner
  playlists: PlaylistInfo[]; // direkte Unterordner, behandelt als Playlist
}

export interface LibraryModel {
  rootFolder?: string;
  topFolders: string[];
  byFolder: Record<string, FolderContent>;
  allSingles: TFile[]; // Summe aller "files" aus allen Top-Level-Ordnern (+ evtl. Dateien direkt im Root)
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
 * Erstellt eine Library-Struktur entweder:
 * - unterhalb eines Root-Ordners (empfohlen) oder
 * - für eine gegebene Liste von Top-Level-Ordnern (Legacy).
 */
export function buildLibrary(app: App, opts: {
  rootFolder?: string;
  foldersLegacy?: string[];
  exts: string[];
  includeRootFiles?: boolean;
}): LibraryModel {
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(app, opts.rootFolder, opts.exts, !!opts.includeRootFiles);
  }
  const folders = (opts.foldersLegacy ?? []).filter(Boolean);
  return buildLibraryFromFolders(app, folders, opts.exts);
}

function buildLibraryFromRoot(app: App, rootFolder: string, extensions: string[], includeRootFiles: boolean): LibraryModel {
  const root = normalizeFolder(rootFolder);
  const top = listSubfolders(app, root);
  const exts = new Set(extensions.map(e => e.toLowerCase().replace(/^\./, "")));

  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  // Optional: Dateien direkt im Root
  if (includeRootFiles) {
    const rootSingles = filesDirectlyIn(app, root, exts);
    allSingles.push(...rootSingles);
  }

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const playlists = directChildPlaylists(app, folder, exts);

    byFolder[folder] = { folder, files, playlists };
    allSingles.push(...files);
  }

  return { rootFolder: root, topFolders: top, byFolder, allSingles };
}

function buildLibraryFromFolders(app: App, folders: string[], extensions: string[]): LibraryModel {
  const exts = new Set(extensions.map(e => e.toLowerCase().replace(/^\./, "")));
  const top = folders.map(f => normalizeFolder(f)).filter(Boolean);
  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const playlists = directChildPlaylists(app, folder, exts);
    byFolder[folder] = { folder, files, playlists };
    allSingles.push(...files);
  }

  return { rootFolder: undefined, topFolders: top, byFolder, allSingles };
}

function filesDirectlyIn(app: App, folderPath: string, exts: Set<string>): TFile[] {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder)) return [];
  const out: TFile[] = [];
  for (const ch of af.children) {
    if (ch instanceof TFile) {
      const ext = ch.extension?.toLowerCase();
      if (ext && exts.has(ext)) out.push(ch);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function directChildPlaylists(app: App, folderPath: string, exts: Set<string>): PlaylistInfo[] {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder)) return [];
  const subs = af.children.filter((c): c is TFolder => c instanceof TFolder);
  const out: PlaylistInfo[] = [];
  for (const sub of subs) {
    const tracks = collectAudioRecursive(sub, exts);
    if (tracks.length === 0) continue;
    const cover = findCoverImage(sub);
    out.push({
      path: sub.path,
      name: sub.name,
      parent: folderPath,
      tracks,
      cover,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function collectAudioRecursive(folder: TFolder, exts: Set<string>): TFile[] {
  const out: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const ch of f.children) {
      if (ch instanceof TFile) {
        const ext = ch.extension?.toLowerCase();
        if (ext && exts.has(ext)) out.push(ch);
      } else if (ch instanceof TFolder) {
        walk(ch);
      }
    }
  };
  walk(folder);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function findCoverImage(folder: TFolder): TFile | undefined {
  // 1) cover.xxx bevorzugen
  for (const ext of IMG_EXTS) {
    const cand = folder.children.find(ch => ch instanceof TFile && ch.name.toLowerCase() === `cover.${ext}`);
    if (cand instanceof TFile) return cand;
  }
  // 2) sonst erstes Bild
  const imgs = folder.children.filter((ch): ch is TFile => ch instanceof TFile && IMG_EXTS.includes(ch.extension.toLowerCase()));
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}

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
        if (parent === root) continue;
      }
      out.push(f);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeFolder(p: string): string {
  return (p || "").replace(/^\/+|\/+$/g, "");
}