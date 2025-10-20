# 🎲 TTRPG Soundboard Plugin

A customizable soundboard plugin for Obsidian — ideal for tabletop RPG sessions, ambient storytelling, or any workflow that benefits from quick-access audio triggers.

---

## 🔧 Features

- **🎛️ Grid-based Soundboard View**  
  Clickable thumbnails arranged in a grid to trigger sounds visually.

- **🎚️ Per-Sound Controls**  
  Each sound supports:
  - Loop toggle
  - Individual volume control
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

## 🗺️ Roadmap

- **Playlist Support (planned)**  
  Possibly introducing a playlist feature:  
  If a folder is placed inside a theme folder, it could be treated as a playlist.  
  This playlist would appear as a single tile inside the theme— with a distinct color, custom buttons, and separate playback settings.

---

## 💬 Feedback

Suggestions for improvement are welcome.  
Feel free to open an issue or submit a pull request if you have ideas for enhancements or refinements.

---

