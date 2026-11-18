export const JSON_PLAYLIST_FORMAT = "ttrpg-soundboard-playlist";
export const JSON_PLAYLIST_VERSION = 1;
export const JSON_PLAYLIST_SUFFIX = ".playlist.json";

export interface JsonPlaylistDocument {
  format: typeof JSON_PLAYLIST_FORMAT;
  version: typeof JSON_PLAYLIST_VERSION;
  name: string;
  tracks: string[];
  cover?: string;
}

export function isJsonPlaylistFileName(name: string): boolean {
  return name.toLowerCase().endsWith(JSON_PLAYLIST_SUFFIX);
}

export function getJsonPlaylistBaseName(fileName: string): string {
  if (!isJsonPlaylistFileName(fileName)) {
    return fileName;
  }

  return fileName.slice(0, -JSON_PLAYLIST_SUFFIX.length);
}

export function toJsonPlaylistFileName(name: string): string {
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  if (!safeName) {
    throw new Error("A playlist name is required.");
  }

  return `${safeName}${JSON_PLAYLIST_SUFFIX}`;
}

/**
 * Playlist paths are stored relative to the configured sound-library root.
 * Backslashes are normalised so JSON playlists can be shared between systems.
 */
export function normalizeJsonPlaylistTrackPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized) {
    throw new Error("Playlist tracks must not use an empty path.");
  }

  if (normalized.split("/").includes("..")) {
    throw new Error(`Playlist track path must not contain "..": ${path}`);
  }

  return normalized;
}

export function normalizeJsonPlaylistCoverPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized) {
    throw new Error("Playlist cover path must not be empty.");
  }

  if (normalized.split("/").includes("..")) {
    throw new Error(`Playlist cover path must not contain "..": ${path}`);
  }

  return normalized;
}

export function parseJsonPlaylistDocument(
  text: string,
  sourceLabel = "playlist",
): JsonPlaylistDocument {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${sourceLabel}.`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must contain a JSON object.`);
  }

  const value = raw as Record<string, unknown>;

  if (value.format !== JSON_PLAYLIST_FORMAT) {
    throw new Error(
      `${sourceLabel} does not use the "${JSON_PLAYLIST_FORMAT}" format.`,
    );
  }

  if (value.version !== JSON_PLAYLIST_VERSION) {
    throw new Error(
      `${sourceLabel} uses unsupported playlist version "${String(value.version)}".`,
    );
  }

  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error(`${sourceLabel} needs a non-empty "name".`);
  }

  if (!Array.isArray(value.tracks)) {
    throw new Error(`${sourceLabel} needs a "tracks" array.`);
  }

  const tracks = value.tracks.map((track, index) => {
    if (typeof track !== "string") {
      throw new Error(
        `${sourceLabel}: track ${index + 1} must be a string path.`,
      );
    }

    return normalizeJsonPlaylistTrackPath(track);
  });
	
  let cover: string | undefined;
  if (value.cover != null) {
    if (typeof value.cover !== "string") {
      throw new Error(`${sourceLabel}: "cover" must be a string path.`);
    }

    cover = normalizeJsonPlaylistCoverPath(value.cover);
  }

  return {
    format: JSON_PLAYLIST_FORMAT,
    version: JSON_PLAYLIST_VERSION,
    name: value.name.trim(),
    tracks,
		...(cover ? { cover } : {}),
  };
}

export function createJsonPlaylistDocument(
  name: string,
  tracks: string[],
	coverPath?: string,
): JsonPlaylistDocument {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("A playlist name is required.");
  }

  const cover = coverPath?.trim()
    ? normalizeJsonPlaylistCoverPath(coverPath)
    : undefined;

  return {
    format: JSON_PLAYLIST_FORMAT,
    version: JSON_PLAYLIST_VERSION,
    name: trimmedName,
    tracks: tracks.map(normalizeJsonPlaylistTrackPath),
		...(cover ? { cover } : {}),
  };
}

export function stringifyJsonPlaylistDocument(
  document: JsonPlaylistDocument,
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}