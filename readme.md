# 🎲 TTRPG Soundboard Plugin

A customizable soundboard plugin for Obsidian — ideal for tabletop RPG sessions, ambient storytelling, or any workflow that benefits from quick-access audio triggers.

---

## 🔧 Features

- **🎛️ Grid-based Soundboard View**  
  Clickable thumbnails arranged in a grid to trigger sounds visually.

- **🎚️ Per-Sound Controls**  
  Each sound supports:
  - Loop toggle
  - Individual volume control (**Changes to volume do not affect currently playing sounds** – they take effect **only after restarting the sound**)
  - Fade in/out settings
  All parameters are saved per sound.

- **🛑 Global Controls**  
  - “Stop All” button to halt all active sounds  
  - Master volume slider  
  - Multiple sounds can play simultaneously

- **🎨 Theme Switching**  
  Dropdown menu to switch between different soundboard themes (based on folder structure).

- **📐 Adjustable Thumbnail Height**  
  Customize thumbnail size via plugin settings.

---

## 📦 Installation & Setup

1. **Create a Soundboard Root Folder**  
   Choose or create a folder (e.g., `Soundbar`) where your soundboard themes will live.  
   Each theme should be a subfolder containing sound files and matching thumbnails.

2. **Configure Plugin Settings**  
   In the plugin settings, set your chosen folder as the **Root Folder**.  
   This enables the dropdown theme selector.

3. **Thumbnail Naming Convention**  
   Thumbnails must have the **same filename** as their corresponding sound file.  
   Example:  dragon_roar.mp3 dragon_roar.png

4. **Folder Setting (Experimental)**  
The “Folders” setting is currently under evaluation.  
It doesn’t interfere with functionality, but its purpose is still being explored.

---

## 🧪 Example Folder Structure

Soundbar/ 
├── ForestAmbience/ 
	│ ├── birds.mp3 
	│ ├── birds.png 
	│ ├── wind.mp3 
	│ ├── wind.png 
├── DungeonCrawl/ 
	│ ├── footsteps.mp3 
	│ ├── footsteps.png 
	│ ├── dripping.mp3 
	│ ├── dripping.png


---

## 🎵 (New) Playlist Feature

- Copy a subfolder into any theme folder. This subfolder will now be treated as a **playlist** and displayed within the theme using a dedicated grid tile.
- The **playlist name** is derived from the folder name.
- The **thumbnail** is taken from `cover.jpg` or `cover.png` (if present), otherwise from the **first image file** found in the folder.

---

## 💬 Feedback

Suggestions for improvement are welcome.  
Feel free to open an issue or submit a pull request if you have ideas for enhancements or refinements.

---

