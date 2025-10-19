# Obsidian TTRPG Soundboard

Use Obsidian as a soundboard for your TTRPG sessions. Play multiple sounds at once with per-title loop and fades, a master volume, and a simple tile UI with thumbnails.

Thumbnails: place an image file (png/jpg/jpeg/webp) with the same base name as the sound in the same folder (e.g., dragon.mp3 ? dragon.jpg).

## Features
- Root folder (default: `Soundbar`), choose subfolders per pane
- Image tiles (thumbnails), adjustable tile height in Settings (Tile height in px)
- Per-title loop, volume, and fades (persisted)
- Stop per title + Stop All
- Fade in/out (defaults 3000 ms; per-title overrides)
- Formats: mp3, ogg, wav, m4a (flac may not be supported on iOS)
- “adjustable tile height in Settings (30–300 px)”.

## Installation (manual)
1. Download release assets (manifest.json, main.js, styles.css, versions.json).
2. Place them in `[Vault]/.obsidian/plugins/obsidian-ttrpg-soundboard/`.
3. Enable the plugin in Obsidian.

## Usage
- Ribbon icon or command “Open Soundboard View”
- Set your root folder in settings; choose subfolder in the pane dropdown
- Click a tile to play (fade-in). Loop/Stop on each card. Gear button opens per-title settings (loop, per-title volume, fade in/out).
- Stop All in the toolbar

## Development

npm i
npm run dev


## Notes
- iOS/Safari may not decode FLAC; prefer mp3/wav/m4a/ogg for mobile.
- Playback continues when switching panes. All sounds stop when the plugin is disabled.

## License
MIT