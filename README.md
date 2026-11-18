# TTRPG Tools - Soundboard (Obsidian Plugin)

A soundboard plugin for Obsidian designed for TTRPG sessions: play sound effects, music and ambience quickly from a folder-based library. Supports multiple simultaneous sounds, per-sound settings, playlists, and note buttons.

## Example page with tutorial videos and more

https://ttrpg-tools-obsidian.org/

## Features

### Soundboard view
- Grid tiles (thumbnail tiles) or a simple list view (per folder configurable).
- Multiple sounds can play at the same time (optional “Allow overlap” behavior).
- Per sound:
  - Play by clicking the tile / row.
  - Stop button (highlights while the sound is active).
  - Loop toggle (persistent).
  - Inline volume slider (persistent).
- Optional delayed loop sequence per sound, for example `20, 30, 60` seconds between repeats.
 
### Playback behavior
- **Allow retrigger overlap** controls whether the same sound may be stacked multiple times.
- **Exclusive playback** fades out all currently playing sounds before starting a new sound or playlist.


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
	- Random track loop (optional)

#### Playlist shuffle
- Shuffle can be enabled per playlist (not global).
- If shuffle is enabled:
  - The track order is shuffled when the playlist starts.
  - When the playlist loops back to the beginning, the order is shuffled again.

#### Random track loop
- Can be enabled per playlist.
- When started, the playlist selects one random track and loops that track continuously.
- **Next** and **Previous** select another random track.
- This also works with playlist buttons in notes:
  - `#1-4` chooses randomly from tracks 1 through 4.
  - `#3` loops track 3, because it is the only selected track.

### JSON playlists (virtual playlists)
In addition to folder-based playlists, the plugin supports virtual playlists
stored as `*.playlist.json` files directly inside a top-level sound category.

JSON playlists reference existing audio files instead of copying them into a
playlist folder. The same audio file can therefore appear in any number of
playlists, including multiple times in the same playlist.

Example location:

```text
Soundbar/
  Music/
    Battle at the ruins.playlist.json
```

Example content:

```json
{
  "format": "ttrpg-soundboard-playlist",
  "version": 1,
  "name": "Battle at the ruins",
	"cover": "Soundbar/Thumbnails/Battle at the ruins.png",
  "tracks": [
    "Dungeon/Combat/Combat 01.ogg",
    "Dungeon/Ambience/Drip.ogg",
    "Dungeon/Combat/Combat 01.ogg"
  ]
}
```

Track paths are relative to the configured sound-library root. JSON playlists
can be created and edited with:

- the **Create or edit JSON playlist** command;
- the playlist button in the soundboard toolbar;
- the settings button on an existing JSON playlist tile or list row.

The editor provides an expandable folder tree, add/preview/stop controls,
reordering, deletion and an explicit target category. Missing tracks stay in
the editor and are marked clearly, so they can be fixed without losing the
remaining playlist order.

An optional playlist cover can be selected through the vault image picker.
The selected vault-relative image path is stored in the JSON playlist's
optional `cover` property.

In the Soundboard view, the options button for JSON playlists opens the same
playback settings as folder-based playlists (fade in/out, volume, loop,
shuffle and random-track loop). Right-click the options button to open the
JSON playlist editor and change its tracks, name, category or cover.

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
- Exclusive sound button:
  - `[Battle Theme](ttrpg-exclusive-sound:Soundbar/Music/Battle Theme.ogg)`
  - Stops all currently playing sounds before starting this sound.
- Optional image button:
  - `[Rain](ttrpg-sound:Soundbar/Dorf/Ambience/Rain.ogg "Soundbar/Thumbnails/rain.png")`
  - `[Rain](ttrpg-sound:Soundbar/Dorf/Ambience/Rain.ogg "Soundbar/Thumbnails/rain.png | 64")`
    - The optional number after `|` is the image height in pixels for this
      button only. Without it, the global note-button icon size is used.

Playlist:
- `[BossFight](ttrpg-playlist:Soundbar/Dungeon/BossFight#1-4)`
- `[BossFight](ttrpg-exclusive-playlist:Soundbar/Dungeon/BossFight#1-4)`
  - Stops all currently playing sounds before starting the playlist.
- Playlists may also use an optional image:
  - `[BossFight](ttrpg-playlist:Soundbar/Dungeon/BossFight "Soundbar/Thumbnails/boss.png | 72")`
- `#N` plays a single track, `#A-B` plays a range.
- Multiple track selections can be combined with commas:
  - `#1,3,5-7`
  - If **Random track loop** is enabled for the playlist, the range limits
    the pool from which the looping random track is selected.

In Reading View, these links are replaced by clickable buttons.

You can set up buttons directly from every tile.
You can also use the **Insert sound or playlist button into note** command.
It opens a visual editor for selecting a sound or playlist, choosing individual
playlist tracks, enabling exclusive playback, setting a custom label and
optionally choosing a vault image with an individual size.

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
```

# F.A.Q
-  why do I need to set a threshold for large audio files.
 - HTMLAudio is not as precise as AudioBuffer/WebAudio. AudioBuffer uses uncompressed PCM, which requires more RAM, but it allows seamless looping and can play multiple sounds simultaneously with high quality. HTMLAudio does not buffer in the same way, and for long tracks it is often better because it starts faster.
  - What is then Decoded audio cache?
   - The decoded audio cache is that amount of cache you hold up for the AudioBuffer. For thooses ambiences you like to have seamless loop or when you want play multiple sounds at once that aren't played with HTMLAudio. They are stored in RAM and if you would play many sounds in one session they could use quite much of it, so you can decide how much RAM you can spare for faster and better audio access. Only useful for looping and multiple sounds.
- Why does my iPad stops playing sound when the screens shut off.
 - This plugin works with audio buffer to support seamless looping but this route pauses when the screen shut down.
  - Use the iPad/iPhone compatibilty mode to prevent this. The sound routing is then directly over HTMLAudioElement in Obsdian.

## License
MIT