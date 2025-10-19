# Obsidian TTRPG Soundboard

Spiele mehrere Sounds gleichzeitig (Loop, Fade-In/Out, per-Sound-Volume, Master-Volume). Mobile-first. Thumbnails: Lege eine Bilddatei (png/jpg/jpeg/webp) mit gleichem Namen wie der Sound in denselben Ordner (dragon.mp3 ? dragon.jpg).

## Features
- Pro Pane Ordner wählen (Dropdown)
- Bild-Buttons (Thumbnails)
- Loop & Volume pro Sound (persistiert)
- Stop pro Sound & Stop All
- Fade-In/Out (Standard 3000 ms)
- Formate: mp3, ogg, wav, m4a (flac eingeschränkt auf iOS)

## Installation (manuell)
1. Release-Assets (manifest.json, main.js, styles.css, versions.json) herunterladen.
2. In [Vault]/.obsidian/plugins/obsidian-ttrpg-soundboard/ ablegen.
3. Plugin in Obsidian aktivieren.

## Nutzung
- Ribbon-Icon oder Command „Open Soundboard View“.
- Ordner im Dropdown wählen.
- Tile anklicken ? Play (mit Fade-In). Loop/Stop/Per-Sound-Volume unter jedem Tile.
- Stop All in der Toolbar.

## Entwicklung
```
npm i
npm run dev
```
Symlink ins Vault optional.

## Hinweise
- iOS/Safari unterstützen FLAC meist nicht – mp3/wav/m4a/ogg bevorzugen.
- Wiedergabe läuft beim Pane-Wechsel weiter. Beim Deaktivieren des Plugins werden alle Sounds gestoppt.