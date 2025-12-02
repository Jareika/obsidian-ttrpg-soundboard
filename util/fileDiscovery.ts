import { App, TFile, TFolder, normalizePath } from "obsidian";

export const IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const AMBIENCE_FOLDER_NAME = "ambience";

export interface PlaylistInfo {
  path: string; // full folder path (for example: Root/Category/PlaylistA)
  name: string; // folder name
  parent: string; // path of the parent (top-level) folder
  tracks: TFile[]; // audio files inside the playlist folder (recursively)
  cover?: TFile; // cover.xx file if present, otherwise first image file
}

export interface FolderContent {
  folder: string; // top-level folder path
  files: TFile[]; // audio files directly in this folder (+ ambience subfolders)
  playlists: PlaylistInfo[]; // direct subfolders (except Ambience) treated as playlists
}

export interface LibraryModel {
  rootFolder?: string;
  topFolders: string[];
  byFolder: Record<string, FolderContent>;
  allSingles: TFile[]; // union of all "files" from all top-level folders (+ optional root files)
}

/**
 * Return the direct child folders of a root folder (no deep recursion).
 */
export function listSubfolders(app: App, rootFolder: string): string[] {
  const root = normalizeFolder(rootFolder);
  const af = app.vault.getAbstractFileByPath(root);
  if (!(af instanceof TFolder)) return [];
  const subs = af.children
    .filter((c): c is TFolder => c instanceof TFolder)
    .map((c) => c.path);
  return subs.sort((a, b) => a.localeCompare(b));
}

/**
 * Legacy helper: search a list of folders recursively for audio files.
 */
export function findAudioFiles(
  app: App,
  folders: string[],
  extensions: string[],
): TFile[] {
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
  );
  const roots = (folders ?? [])
    .map((f) => normalizeFolder(f))
    .filter(Boolean);

  const out: TFile[] = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;

    if (roots.length === 0) {
      out.push(f);
      continue;
    }
    const inRoot = roots.some(
      (r) => f.path === r || f.path.startsWith(r + "/"),
    );
    if (inRoot) out.push(f);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Build a library model either:
 * - under a single root folder (recommended), or
 * - from an explicit list of top-level folders (legacy).
 */
export function buildLibrary(
  app: App,
  opts: {
    rootFolder?: string;
    foldersLegacy?: string[];
    exts: string[];
    includeRootFiles?: boolean;
  },
): LibraryModel {
  if (opts.rootFolder && opts.rootFolder.trim()) {
    return buildLibraryFromRoot(
      app,
      opts.rootFolder,
      opts.exts,
      !!opts.includeRootFiles,
    );
  }
  const folders = (opts.foldersLegacy ?? []).filter(Boolean);
  return buildLibraryFromFolders(app, folders, opts.exts);
}

function buildLibraryFromRoot(
  app: App,
  rootFolder: string,
  extensions: string[],
  includeRootFiles: boolean,
): LibraryModel {
  const root = normalizeFolder(rootFolder);
  const top = listSubfolders(app, root);
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
  );

  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  // Optionally include files directly in the root folder
  if (includeRootFiles) {
    const rootSingles = filesDirectlyIn(app, root, exts);
    allSingles.push(...rootSingles);
  }

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } =
      directChildPlaylistsAndAmbienceSingles(app, folder, exts);

    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }

  return { rootFolder: root, topFolders: top, byFolder, allSingles };
}

function buildLibraryFromFolders(
  app: App,
  folders: string[],
  extensions: string[],
): LibraryModel {
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
  );
  const top = folders.map((f) => normalizeFolder(f)).filter(Boolean);
  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } =
      directChildPlaylistsAndAmbienceSingles(app, folder, exts);
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
  }

  return { rootFolder: undefined, topFolders: top, byFolder, allSingles };
}

function filesDirectlyIn(
  app: App,
  folderPath: string,
  exts: Set<string>,
): TFile[] {
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

/**
 * Treat direct subfolders as playlists, with a special case for "Ambience":
 * - Subfolders named "Ambience" / "ambience" are NOT treated as playlists,
 *   but their audio files are merged into the parent's singles instead.
 */
function directChildPlaylistsAndAmbienceSingles(
  app: App,
  folderPath: string,
  exts: Set<string>,
): { playlists: PlaylistInfo[]; ambienceSingles: TFile[] } {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder))
    return { playlists: [], ambienceSingles: [] };

  const subs = af.children.filter(
    (c): c is TFolder => c instanceof TFolder,
  );
  const playlists: PlaylistInfo[] = [];
  const ambienceSingles: TFile[] = [];

  for (const sub of subs) {
    const isAmbience =
      sub.name.toLowerCase() === AMBIENCE_FOLDER_NAME.toLowerCase();

    const tracks = collectAudioRecursive(sub, exts);
    if (tracks.length === 0) continue;

    if (isAmbience) {
      // Ambience folder: treat tracks as singles of the parent
      ambienceSingles.push(...tracks);
      continue;
    }

    const cover = findCoverImage(sub);
    playlists.push({
      path: sub.path,
      name: sub.name,
      parent: folderPath,
      tracks,
      cover,
    });
  }

  playlists.sort((a, b) => a.name.localeCompare(b.name));
  ambienceSingles.sort((a, b) => a.path.localeCompare(b.path));
  return { playlists, ambienceSingles };
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
  // 1) Prefer a cover.xxx file
  for (const ext of IMG_EXTS) {
    const cand = folder.children.find(
      (ch) =>
        ch instanceof TFile &&
        ch.name.toLowerCase() === `cover.${ext}`,
    );
    if (cand instanceof TFile) return cand;
  }
  // 2) Otherwise, use the first image file in the folder
  const imgs = folder.children.filter(
    (ch): ch is TFile =>
      ch instanceof TFile &&
      !!ch.extension &&
      IMG_EXTS.includes(ch.extension.toLowerCase()),
  );
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}

export function findAudioFilesUnderRoot(
  app: App,
  rootFolder: string,
  extensions: string[],
  includeRootFiles = false,
): TFile[] {
  const root = normalizeFolder(rootFolder);
  const exts = new Set(
    extensions.map((e) => e.toLowerCase().replace(/^\./, "")),
  );
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
  if (!p) return "";
  return normalizePath(p);
}