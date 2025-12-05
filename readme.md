# 🎲 TTRPG Soundboard Plugin

A flexible soundboard plugin for Obsidian — ideal for tabletop RPG sessions, ambient storytelling, streaming overlays, or any workflow that benefits from quick-access audio.

---

## ✨ Main Features

### 🔊 Soundboard View (Grid or Simple List)

- **Grid view with tiles**  
  - One tile per sound file.  
  - Optional thumbnail: image file with the same base name as the audio file in the same folder  
    - Example: `dragon_roar.mp3` + `dragon_roar.png`.
  - Click tile to start playback.

- **Simple list view** (optional)  
  - One‑column list with:
    - Track title
    - Duration (mm:ss)
    - Controls below (loop, stop, volume, settings)  
  - Highlight for currently playing tracks.  
  - Can be enabled in the plugin settings: **“Simple list view”**.

- **Per‑sound controls (for each track)**  
  - Loop toggle (stored per file).  
  - Inline volume slider under the tile / list row.  
  - Stop button (highlighted while the sound is playing).  
  - Settings button (gear icon) opens a per‑sound modal with:
    - Fade in (ms)
    - Fade out (ms)
    - Volume (0–1, multiplied by Master / Ambience)
    - Loop by default
    - Buttons: **Restore defaults · Save · Cancel**  
  - Volume changes apply **immediately** to currently playing instances; Cancel restores the original live volume.

### Quick Play Command (Global Sound Search)

The plugin provides a command to quickly play any sound in your library without opening the soundboard view.

- **Command name:** `Quick play sound (modal)`
- **How to use:**
  1. Open the Command Palette (`Ctrl+P` / `Cmd+P`).
  2. Run **Quick play sound (modal)**.
  3. Start typing the title of a sound (searches in both title and folder path).
  4. Press **Enter** to play the selected sound.

- **Duplicates by name are hidden:**  
  If the same audio file name exists in multiple folders (for example, `Desert Campfire` in `Desert/` and in `Camp/`), it is shown only **once** in the quick‑play list. The first match (by path) is used for playback.

- **Hotkey support:**  
  You can assign a keyboard shortcut under **Settings → Hotkeys → TTRPG Soundboard → Quick play sound (modal)** for even faster access.
  
### 🎚️ Global Controls

The toolbar at the top of the Soundboard View is sticky (stays visible while scrolling) and contains:

- **Two folder selectors (A and B)**  
  - Each selects a top‑level sound folder (category).  
  - A central **switch button (⇄)** toggles which folder is currently shown.  
  - The active selector is highlighted.

- **Stop All**  
  - Stops every sound currently playing (with the global fade‑out time).

- **Master volume slider**  
  - Scales the output of all sounds globally.

- **Ambience volume slider**  
  - Scales only sounds coming from special `Ambience` subfolders (see below).

- **Allow overlap toggle** (in settings)  
  - If disabled, starting a sound in the Soundboard View stops other instances of that same file first.

### 🌫️ Ambience Folders

You can create ambience subfolders to handle background loops separately:

- Any subfolder named **`Ambience`** or **`ambience`** under a top‑level sound folder is treated specially.
- All audio files inside these `Ambience` folders (recursively) are:
  - shown as **normal tracks** of the parent category (not as playlists),
  - affected by the global **Ambience volume** slider,
  - still have their own per‑sound prefs (loop, fades, volume).

Example:

~~~text
Soundbar/
  Dorf/
    Ambience/
      Rain.ogg
      Crowd.ogg
~~~
In the Soundboard View, Rain.ogg and Crowd.ogg appear under the Dorf folder and are controlled by the Ambience slider.

📂 Playlists (Subfolders as Sequential Playlists)
Any direct subfolder of a top‑level category that is not named Ambience is treated as a playlist.

Playlists are rendered as golden tiles with:

Title: playlist folder name
Cover image:
cover.png, cover.jpg, etc. if present, or
first image file in the folder.
Playback behavior:

Click the playlist tile to start playback from the first track.
Tracks inside the playlist play sequentially.
When a track ends naturally, the playlist advances automatically.
When the last track ends:
If Loop playlist is enabled (per‑playlist setting), it restarts from the first track.
Otherwise the playlist stops.
Per‑playlist controls (under each playlist tile / list row):

Previous track
Next track
Stop (highlighted while the playlist is active)
Settings (gear):
Fade in (ms)
Fade out (ms)
Playlist volume (0–1, multiplied by Master / Ambience if applicable)
Loop playlist
Restore defaults · Save · Cancel
Volume changes apply immediately to all currently playing tracks from that playlist; Cancel restores the original live volume.
🎛️ Now‑Playing View
A separate view that shows all currently playing sounds, independent of folders:

Opened automatically as an additional tab in the right dock when you open the Soundboard View.
Contains a small grid with:
Track title (file name or playlist track)
Stop button
Inline volume slider (live volume only – does not change saved prefs)
Updates automatically when sounds start or stop.
You can dock this view wherever you like and use it as a compact “mixer”.
📝 Note Buttons in Markdown
You can trigger sounds directly from your notes.

Basic text button
[Rain ambience](ttrpg-sound:Soundbar/Dorf/Rain.ogg)
In Reading View, this will be transformed into a button:

Click → plays the given file (with per‑sound prefs, Master, Ambience, fades).
Click again → stops that file (with fade‑out).
The button gets the same “playing” highlight as Stop buttons in the Soundboard View.
Image button
You can also display an image instead of text:

[Rain ambience](ttrpg-sound:Soundbar/Dorf/Rain.ogg "Soundbar/Thumbnails/rain.png")
The optional "..." part is interpreted as a thumbnail path inside your vault.
If the image is found:
The button shows only the image (no pill background).
On hover, the title is shown as a native tooltip.
While the sound is playing, the image gets a subtle glow outline.
Image size can be adjusted via CSS:

:root {
  --ttrpg-note-icon-size: 40px; /* or any other value */
}
Note: These buttons are transformed only in Reading View.
In Live Preview / Source mode you still see the raw Markdown.

📱 Mobile Icon Snippet
On some mobile setups, icon buttons in the Soundboard View may appear too small or not render as expected.

A helper CSS snippet (ttrpg-soundboard-mobile-fallback.css) is included to:

increase icon size in narrow layouts,
ensure SVG/Font icons remain visible on phones and tablets.
You can enable it via your theme’s snippet settings.

🗂️ Folder Structure & Thumbnails
Root folder & categories
In plugin settings, you configure a Root folder (default suggestion: Soundbar).

Every direct subfolder of the root is treated as a sound category (a top‑level option in the folder dropdowns).
Audio files directly in the root can optionally be included via a setting.
Example:

Soundbar/
  Dorf/
  Dungeon/
  City/
In the Soundboard View, the folder dropdowns will list Dorf, Dungeon, City (relative labels).

Thumbnails for tracks
For each audio file, the plugin looks for an image in the same folder with the same base name:

dragon_roar.mp3 → dragon_roar.png / jpg / jpeg / webp.
If found, this image is used as the tile background.

Playlist covers
For playlists (subfolders):

If a file named cover.png, cover.jpg, etc. exists in the playlist folder, it is used as the cover.
Otherwise, the first image file in the folder is used.
⚙️ Settings Overview
You can find all settings under Settings → Community Plugins → TTRPG Soundboard.

Library
Root folder
Base folder that contains your sound categories (subfolders).

Include files directly in root
If enabled, audio files directly in the root folder are also listed as tracks.

Folders (legacy, comma separated)
Used only when the root folder is empty; older mode where you list folders explicitly.

Allowed extensions
Comma‑separated list of audio file types, e.g. mp3, ogg, wav, m4a, flac.

Playback
Fade in (ms) / Fade out (ms)
Global defaults for new playback, can be overridden per sound / playlist.

Allow overlap
If disabled, starting a sound or note‑button for file X will stop other instances of X first.

Master volume
Global 0–1 multiplier applied to all audio.

Ambience volume
0–1 multiplier applied only to files under Ambience subfolders.

Appearance
Simple list view
Switch between:

Grid (with thumbnails) and
Simple one‑column list (title + duration).
Tile height (px)
Vertical size of thumbnail tiles in the grid.

🧪 Example Folder Setup
Soundbar/
  Dorf/
    Ambience/
      Rain.ogg
      Crowd.ogg
    Cat Meow Nah.ogg
    Cat Meow Nah.png
    Tavern Theme.ogg
    Tavern Theme.png

  Dungeon/
    Ambience/
      Dripping Water.ogg
    Battle/
      Orc Fight.ogg
      Orc Fight.png
Dorf and Dungeon appear in the folder dropdowns.
Dorf/Ambience/* and Dungeon/Ambience/* are treated as ambience tracks.
Dungeon/Battle becomes a playlist inside the Dungeon category.
Cat Meow Nah.png and Tavern Theme.png are used as tile thumbnails.
📝 Notes
The plugin currently uses the Web Audio API for playback.
All settings (including per‑sound and per‑playlist preferences) are stored persistently in your vault’s plugin data.
No external network access is required; all audio is loaded from local files in your Obsidian vault.
💬 Feedback & Contributions
Suggestions and contributions are very welcome.

If something doesn’t behave as you expect (e.g. layout, mobile behavior, volume interaction), please open an issue.
Pull requests for bug fixes, new view modes, or integrations with other Obsidian workflows are appreciated.
