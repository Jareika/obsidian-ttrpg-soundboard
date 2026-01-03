# TTRPG Soundboard (Obsidian Plugin)

A soundboard plugin for Obsidian designed for TTRPG sessions: play sound effects, music and ambience quickly from a folder-based library. Supports multiple simultaneous sounds, per-sound settings, playlists, and note buttons.

## Features

### Soundboard view
- Grid tiles (thumbnail tiles) or a simple list view (per folder configurable).
- Multiple sounds can play at the same time (optional “Allow overlap” behavior).
- Per sound:
  - Play by clicking the tile / row.
  - Stop button (highlights while the sound is active).
  - Loop toggle (persistent).
  - Inline volume slider (persistent).

### Long tracks: faster start (MediaElement mode)
Large audio files (for example 1-hour ambience tracks) can be played using an `HTMLAudioElement` (MediaElement) instead of decoding the entire file into an `AudioBuffer`.

Notes:
- The threshold is configurable in settings: **Threshold for faster large‑file audio playback (mb)**.
  - Files larger than this value will use MediaElement playback.
  - Set it to **0** to disable MediaElement playback completely (always decode to `AudioBuffer`).
- Preloading skips these large files (preloading large files would defeat the purpose).

### Ambience folders (auto loop by default)
Any audio file located inside a folder named `Ambience` / `ambience` is treated as ambience:
- Ambience tracks are affected by the global “Ambience volume” slider.
- Ambience tracks default to **loop enabled**.
- You can still manually disable loop per track (this is stored as an override).

### Playlists (subfolders)
Direct subfolders inside a top-level category are treated as playlists (except `Ambience`):
- Playlists are shown as visually distinct tiles/rows.
- Playback is sequential (track 1 → 2 → 3…).
- Next / Previous controls.
- Stop button (highlights while the playlist is active).
- Playlist settings modal (persistent):
  - Fade in/out
  - Volume
  - Loop playlist
  - Shuffle (optional)

#### Playlist shuffle
- Shuffle can be enabled per playlist (not global).
- If shuffle is enabled:
  - The track order is shuffled when the playlist starts.
  - When the playlist loops back to the beginning, the order is shuffled again.

### Shared thumbnail folder (optional)
Some users prefer separating audio files and images.

If enabled in settings:
- Thumbnails for **single tracks** are searched **only** in the shared thumbnail folder, by matching base filename:
  - Example: `Dragon Roar.mp3` → `SharedThumbs/Dragon Roar.png` (or `.jpg/.jpeg/.webp`)
- Playlist covers can also be found via the shared thumbnail folder (by playlist folder name).

If disabled:
- Thumbnails are searched next to the audio file (same folder, same base name).

### Stop All
A toolbar button stops all currently playing sounds (using the global fade-out time).

### Now Playing view
A separate view that lists currently active sounds:
- Stop and Pause/Resume.
- Inline volume slider.

Playlist bugfix:
- If the currently playing track belongs to an active playlist, the Now Playing volume slider controls the **playlist volume** (so it affects the next/previous tracks as well).

### Note buttons (play from Markdown)
You can trigger sounds directly from notes.

Single sound:
- Text button:
  - `[Rain](ttrpg-sound:Soundbar/Dorf/Ambience/Rain.ogg)`
- Optional image button:
  - `[Rain](ttrpg-sound:Soundbar/Dorf/Ambience/Rain.ogg "Soundbar/Thumbnails/rain.png")`

Playlist:
- `[BossFight](ttrpg-playlist:Soundbar/Dungeon/BossFight#1-4)`
- `#N` plays a single track, `#A-B` plays a range.

In Reading View, these links are replaced by clickable buttons.

You can set up buttons directly from every tile.

## Folder structure

Recommended structure:
```text
Soundbar/                       (Root folder)
  Dorf/                         (Top-level category)
    Ambience/                   (Special: ambience tracks, auto-loop default)
      Rain.ogg
      Crowd.ogg
    Tavern Theme.ogg
    Tavern Theme.png            (Thumbnail next to track if shared folder is disabled)

  Dungeon/
    Battle/                     (Playlist folder)
      cover.png                 (Optional playlist cover)
      Track 01.ogg
      Track 02.ogg