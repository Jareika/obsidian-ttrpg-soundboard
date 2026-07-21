import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  assertExternalDirectory,
  createExternalAudioFile,
  readExternalDirectory,
  resolveExternalPath,
} from "./externalFiles";
import type { LibraryFile } from "./externalFiles";

export const IMG_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const AMBIENCE_FOLDER_NAME = "ambience";

export interface PlaylistInfo {
  path: string; // full folder path (for example: Root/Category/PlaylistA)
  name: string; // folder name
  parent: string; // path of the parent (top-level) folder
  tracks: LibraryFile[]; // audio files inside the playlist folder (recursively)
  cover?: LibraryFile; // vault or external cover image
}

export interface FolderContent {
  folder: string; // top-level folder path
  files: LibraryFile[]; // audio files directly in this folder (+ ambience subfolders)
  playlists: PlaylistInfo[]; // direct subfolders (except Ambience) treated as playlists
}

export interface LibraryModel {
  rootFolder?: string;
  topFolders: string[];
  byFolder: Record<string, FolderContent>;
  allSingles: LibraryFile[]; // union of all "files" from all top-level folders (+ optional root files)
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
export function findAudioFiles(app: App, folders: string[], extensions: string[]): TFile[] {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const roots = (folders ?? []).map((f) => normalizeFolder(f)).filter(Boolean);

  const out: TFile[] = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (!(f instanceof TFile)) continue;
    const ext = (f.extension || "").toLowerCase();
    if (!exts.has(ext)) continue;

    if (roots.length === 0) {
      out.push(f);
      continue;
    }
    const inRoot = roots.some((r) => f.path === r || f.path.startsWith(r + "/"));
    if (inRoot) out.push(f);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Build a library model either:
 * - under a single root folder (recommended), or
 * - from an explicit list of top-level folders (legacy).
 */
export async function buildLibrary(
  app: App,
  opts: {
    location: "vault" | "external";
    rootFolder?: string;
    externalRootFolder?: string;
    foldersLegacy?: string[];
    exts: string[];
    includeRootFiles?: boolean;
    thumbnailFolder?: string;
  },
): Promise<LibraryModel> {
  if (opts.location === "external") {
    return await buildLibraryFromExternalRoot(
      opts.externalRootFolder ?? "",
      opts.exts,
      !!opts.includeRootFiles,
    );
  }

  if (opts.rootFolder?.trim()) {
    return buildLibraryFromRoot(
      app,
      opts.rootFolder,
      opts.exts,
      !!opts.includeRootFiles,
      opts.thumbnailFolder,
    );
  }

  return buildLibraryFromFolders(
    app,
    opts.foldersLegacy ?? [],
    opts.exts,
    opts.thumbnailFolder,
  );
}

function buildLibraryFromRoot(
  app: App,
  rootFolder: string,
  extensions: string[],
  includeRootFiles: boolean,
  thumbnailFolder?: string,
): LibraryModel {
  const root = normalizeFolder(rootFolder);
  const top = listSubfolders(app, root);
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));

  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  // Optionally include files directly in the root folder
  if (includeRootFiles) {
    const rootSingles = filesDirectlyIn(app, root, exts);
    allSingles.push(...rootSingles);
  }

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(
      app,
      folder,
      exts,
      thumbnailFolder,
    );

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
  thumbnailFolder?: string,
): LibraryModel {
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
  const top = folders.map((f) => normalizeFolder(f)).filter(Boolean);
  const byFolder: Record<string, FolderContent> = {};
  const allSingles: TFile[] = [];

  for (const folder of top) {
    const files = filesDirectlyIn(app, folder, exts);
    const { playlists, ambienceSingles } = directChildPlaylistsAndAmbienceSingles(
      app,
      folder,
      exts,
      thumbnailFolder,
    );
    const combinedSingles = [...files, ...ambienceSingles];
    byFolder[folder] = { folder, files: combinedSingles, playlists };
    allSingles.push(...combinedSingles);
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

/**
 * Treat direct subfolders as playlists, with a special case for "Ambience":
 * - Subfolders named "Ambience" / "ambience" are NOT treated as playlists,
 *   but their audio files are merged into the parent's singles instead.
 */
function directChildPlaylistsAndAmbienceSingles(
  app: App,
  folderPath: string,
  exts: Set<string>,
  thumbnailFolder?: string,
): { playlists: PlaylistInfo[]; ambienceSingles: TFile[] } {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder)) return { playlists: [], ambienceSingles: [] };

  const subs = af.children.filter((c): c is TFolder => c instanceof TFolder);
  const playlists: PlaylistInfo[] = [];
  const ambienceSingles: TFile[] = [];

  for (const sub of subs) {
    const isAmbience = sub.name.toLowerCase() === AMBIENCE_FOLDER_NAME.toLowerCase();

    const tracks = collectAudioRecursive(sub, exts);
    if (tracks.length === 0) continue;

    if (isAmbience) {
      // Ambience folder: treat tracks as singles of the parent
      ambienceSingles.push(...tracks);
      continue;
    }

    const cover = findCoverImage(app, sub, thumbnailFolder);
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

function findCoverImage(app: App, playlistFolder: TFolder, thumbnailFolder?: string): TFile | undefined {
  if (thumbnailFolder && thumbnailFolder.trim()) {
    return findImageByBaseName(app, thumbnailFolder, playlistFolder.name);
  }

  // 1) Prefer a cover.xxx file inside the playlist folder
  for (const ext of IMG_EXTS) {
    const cand = playlistFolder.children.find(
      (ch) => ch instanceof TFile && ch.name.toLowerCase() === `cover.${ext}`,
    );
    if (cand instanceof TFile) return cand;
  }

  // 2) Otherwise, use the first image file in the playlist folder
  const imgs = playlistFolder.children.filter(
    (ch): ch is TFile =>
      ch instanceof TFile &&
      !!ch.extension &&
      IMG_EXTS.includes(ch.extension.toLowerCase()),
  );
  imgs.sort((a, b) => a.name.localeCompare(b.name));
  return imgs[0];
}

function findImageByBaseName(app: App, folderPath: string, baseName: string): TFile | undefined {
  const folder = normalizeFolder(folderPath);
  for (const ext of IMG_EXTS) {
    const candPath = `${folder}/${baseName}.${ext}`;
    const af = app.vault.getAbstractFileByPath(candPath);
    if (af instanceof TFile) return af;
  }
  return undefined;
}

export function findAudioFilesUnderRoot(
  app: App,
  rootFolder: string,
  extensions: string[],
  includeRootFiles = false,
): TFile[] {
  const root = normalizeFolder(rootFolder);
  const exts = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")));
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

async function buildLibraryFromExternalRoot(
  externalRootFolder: string,
  extensions: string[],
  includeRootFiles: boolean,
): Promise<LibraryModel> {
  if (!externalRootFolder.trim()) {
    throw new Error("No external sound folder has been configured.");
  }

  const root = resolveExternalPath(externalRootFolder);
  await assertExternalDirectory(root);

  const exts = new Set(
    extensions.map((ext) => ext.toLowerCase().replace(/^\./, "")),
  );

  const rootEntries = await readExternalDirectory(root);
  const topFolderEntries = rootEntries
    .filter((entry) => entry.isDirectory)
    .sort((a, b) => a.name.localeCompare(b.name));

  const topFolders = topFolderEntries.map((entry) => entry.name);
  const byFolder: Record<string, FolderContent> = {};
  const allSingles: LibraryFile[] = [];

  if (includeRootFiles) {
    const rootSingles = await externalFilesDirectlyIn(root, root, exts);
    allSingles.push(...rootSingles);
  }

  for (const folderEntry of topFolderEntries) {
    const folderPath = folderEntry.name;

    const directFiles = await externalFilesDirectlyIn(
      root,
      folderEntry.absolutePath,
      exts,
    );

    const { playlists, ambienceSingles } =
      await externalChildPlaylistsAndAmbienceSingles(
        root,
        folderPath,
        folderEntry.absolutePath,
        exts,
      );

    const files = [...directFiles, ...ambienceSingles].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    byFolder[folderPath] = {
      folder: folderPath,
      files,
      playlists,
    };

    allSingles.push(...files);
  }

  return {
    // Deliberately undefined: paths are already relative to the external root.
    rootFolder: undefined,
    topFolders,
    byFolder,
    allSingles,
  };
}

async function externalFilesDirectlyIn(
  rootPath: string,
  folderPath: string,
  exts: Set<string>,
): Promise<LibraryFile[]> {
  const entries = await readExternalDirectory(folderPath);
  const files: LibraryFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile) continue;

    const extension = getExtension(entry.name);
    if (!exts.has(extension)) continue;

    files.push(
      await createExternalAudioFile(rootPath, entry.absolutePath),
    );
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function externalChildPlaylistsAndAmbienceSingles(
  rootPath: string,
  parentRelativePath: string,
  parentAbsolutePath: string,
  exts: Set<string>,
): Promise<{
  playlists: PlaylistInfo[];
  ambienceSingles: LibraryFile[];
}> {
  const entries = await readExternalDirectory(parentAbsolutePath);
  const folders = entries
    .filter((entry) => entry.isDirectory)
    .sort((a, b) => a.name.localeCompare(b.name));

  const playlists: PlaylistInfo[] = [];
  const ambienceSingles: LibraryFile[] = [];

  for (const folder of folders) {
    const tracks = await collectExternalAudioRecursive(
      rootPath,
      folder.absolutePath,
      exts,
    );

    if (!tracks.length) continue;

    if (folder.name.toLowerCase() === AMBIENCE_FOLDER_NAME) {
      ambienceSingles.push(...tracks);
      continue;
    }

    const cover = await findExternalCoverImage(
      rootPath,
      folder.absolutePath,
    );

    playlists.push({
      path: `${parentRelativePath}/${folder.name}`,
      name: folder.name,
      parent: parentRelativePath,
      tracks,
      cover,
    });
  }

  ambienceSingles.sort((a, b) => a.path.localeCompare(b.path));
  playlists.sort((a, b) => a.name.localeCompare(b.name));

  return { playlists, ambienceSingles };
}

async function collectExternalAudioRecursive(
  rootPath: string,
  folderPath: string,
  exts: Set<string>,
): Promise<LibraryFile[]> {
  const entries = await readExternalDirectory(folderPath);
  const files: LibraryFile[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(
        ...(await collectExternalAudioRecursive(
          rootPath,
          entry.absolutePath,
          exts,
        )),
      );
      continue;
    }

    if (!entry.isFile) continue;

    const extension = getExtension(entry.name);
    if (!exts.has(extension)) continue;

    files.push(
      await createExternalAudioFile(rootPath, entry.absolutePath),
    );
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function findExternalCoverImage(
  rootPath: string,
  playlistFolderPath: string,
): Promise<LibraryFile | undefined> {
  const entries = await readExternalDirectory(playlistFolderPath);
  const imageFiles = entries
    .filter(
      (entry) =>
        entry.isFile && IMG_EXTS.includes(getExtension(entry.name)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const ext of IMG_EXTS) {
    const coverName = `cover.${ext}`;
    const cover = imageFiles.find(
      (entry) => entry.name.toLowerCase() === coverName,
    );

    if (cover) {
      return await createExternalAudioFile(rootPath, cover.absolutePath);
    }
  }

  const firstImage = imageFiles[0];
  if (!firstImage) return undefined;

  return await createExternalAudioFile(rootPath, firstImage.absolutePath);
}

function getExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot < 0 || lastDot === name.length - 1) return "";
  return name.slice(lastDot + 1).toLowerCase();
}

function normalizeFolder(p: string): string {
  if (!p) return "";
  return normalizePath(p);
}