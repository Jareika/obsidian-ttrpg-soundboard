import { Platform, TFile } from "obsidian";

export interface ExternalAudioFile {
  kind: "external";
  path: string; // Relativ zum konfigurierten externen Sound-Root
  absolutePath: string;
  name: string;
  basename: string;
  extension: string;
  parentPath: string;
  stat: {
    mtime: number;
    size: number;
  };
}

export type LibraryFile = TFile | ExternalAudioFile;

export interface ExternalDirectoryEntry {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface NodeFs {
  promises: {
    readFile(path: string): Promise<Uint8Array>;
    readdir(
      path: string,
      options: { withFileTypes: true },
    ): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
    stat(path: string): Promise<{
      mtimeMs: number;
      size: number;
      isDirectory(): boolean;
    }>;
  };
  existsSync(path: string): boolean;
}

interface NodePath {
  basename(path: string, suffix?: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  resolve(...parts: string[]): string;
}

interface NodeUrl {
  pathToFileURL(path: string): { href: string };
}

type NodeModuleLoader = (moduleName: string) => unknown;

function getNodeRequire(): NodeModuleLoader {
  const maybeRequire = (
    window as unknown as { require?: unknown }
  ).require;

  if (typeof maybeRequire !== "function") {
    throw new Error("Node.js APIs are unavailable in this Obsidian environment.");
  }

  return maybeRequire as NodeModuleLoader;
}

function getFs(): NodeFs {
  return getNodeRequire()("fs") as NodeFs;
}

function getPath(): NodePath {
  return getNodeRequire()("path") as NodePath;
}

function getUrl(): NodeUrl {
  return getNodeRequire()("url") as NodeUrl;
}

export function isExternalAudioFile(file: LibraryFile): file is ExternalAudioFile {
  return "kind" in file && file.kind === "external";
}

export function resolveExternalPath(path: string): string {
  return getPath().resolve(path.trim());
}

export async function assertExternalDirectory(path: string): Promise<void> {
  if (!canUseExternalFiles()) {
    throw new Error("External sound libraries are available on desktop only.");
  }

  const stat = await getFs().promises.stat(path);
  if (!stat.isDirectory()) {
    throw new Error(`External sound-library path is not a folder: ${path}`);
  }
}

export async function readExternalDirectory(
  folderPath: string,
): Promise<ExternalDirectoryEntry[]> {
  const nodePath = getPath();
  const entries = await getFs().promises.readdir(folderPath, {
    withFileTypes: true,
  });

  return entries.map((entry) => ({
    name: entry.name,
    absolutePath: nodePath.join(folderPath, entry.name),
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
  }));
}

export async function createExternalAudioFile(
  rootPath: string,
  absolutePath: string,
): Promise<ExternalAudioFile> {
  const nodePath = getPath();
  const stat = await getFs().promises.stat(absolutePath);
  const extension = nodePath.extname(absolutePath).replace(/^\./, "").toLowerCase();

  return {
    kind: "external",
    path: nodePath.relative(rootPath, absolutePath).replace(/\\/g, "/"),
    absolutePath,
    name: nodePath.basename(absolutePath),
    basename: nodePath.basename(absolutePath, nodePath.extname(absolutePath)),
    extension,
    parentPath: nodePath.dirname(absolutePath),
    stat: {
      mtime: stat.mtimeMs,
      size: stat.size,
    },
  };
}

export function canUseExternalFiles(): boolean {
  return Platform.isDesktopApp;
}

export function getLibraryFileResourcePath(
  app: { vault: { getResourcePath(file: TFile): string } },
  file: LibraryFile,
): string {
  if (file instanceof TFile) {
    return app.vault.getResourcePath(file);
  }

  return getUrl().pathToFileURL(file.absolutePath).href;
}

export async function getLibraryImageResourceUrl(
  app: {
    vault: {
      getResourcePath(file: TFile): string;
    };
  },
  file: LibraryFile,
): Promise<string> {
  if (file instanceof TFile) {
    return app.vault.getResourcePath(file);
  }

  const binary = await readLibraryFileBinary(app, file);
  const mimeType = getImageMimeType(file.extension);
  const blob = new Blob([binary], { type: mimeType });
  return URL.createObjectURL(blob);
}

function getImageMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export async function readLibraryFileBinary(
  app: { vault: { readBinary(file: TFile): Promise<ArrayBuffer> } },
  file: LibraryFile,
): Promise<ArrayBuffer> {
  if (file instanceof TFile) {
    return app.vault.readBinary(file);
  }

  const bytes = await getFs().promises.readFile(file.absolutePath);

  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function externalPathExists(path: string): boolean {
  if (!canUseExternalFiles() || !path.trim()) return false;
  return getFs().existsSync(path);
}

export function findExternalSiblingImage(
  audioFile: ExternalAudioFile,
  imageExtensions: string[],
): ExternalAudioFile | null {
  const nodePath = getPath();
  const parent = nodePath.dirname(audioFile.absolutePath);

  for (const ext of imageExtensions) {
    const absolutePath = nodePath.join(parent, `${audioFile.basename}.${ext}`);

    if (!getFs().existsSync(absolutePath)) continue;

    const relativePath = nodePath.relative(audioFile.parentPath, absolutePath);

    return {
      kind: "external",
      path: relativePath.replace(/\\/g, "/"),
      absolutePath,
      name: nodePath.basename(absolutePath),
      basename: nodePath.basename(absolutePath, `.${ext}`),
      extension: ext,
      parentPath: parent,
      stat: {
        mtime: 0,
        size: 0,
      },
    };
  }

  return null;
}