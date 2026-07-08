# Changelog

## 1.1.1

- Renamed the plugin display name to `Rename_img`.
- Added English and Chinese interface language switching.

## 1.0.4

- Fixed Base name style color rules not applying reliably in Bases views.
- Improved Base name styling for nested text and links inside name cells.
- Removed the active-file reveal setting because Obsidian's File Explorer can still auto-expand from internal behavior outside the plugin.
- Added a dedicated Obsidian ribbon page and command palette action for plugin controls.

## 1.0.3

- Prepared the plugin for Obsidian community plugin review.
- Removed unsupported bundled theme release assets.
- Kept plugin styles in the supported `styles.css` file.
- Removed dynamic style element creation.
- Removed direct static style assignments for Base name styling.
- Removed vault-wide file enumeration for Base style extension options.
- Rewrote README content in English for plugin directory review.
- Clarified that Baseline is a personal theme recommendation and must be installed separately.
- Added a GitHub Actions release workflow that builds, attests, and uploads supported release assets.
- Replaced deprecated workspace leaf access with `getLeaf(false)`.
- Removed an unnecessary `activeDocument` type assertion.
- Avoided internal calls to the deprecated setting tab `display()` method.
- Fixed Base name style color rules not applying reliably in Bases views.
- Fixed the active-file reveal toggle so disabling it also tries to disable Obsidian File Explorer auto-reveal.

## 1.0.2

- Added default PNG hiding in the file explorer.
- Added default Canvas image filename display mode: `Show on hover`.
- Added a setting to enable or disable revealing the active file in the file explorer.
- Added default `Files.base` creation with filters for non-PNG and non-Base files.
- Added default Base properties for name, extension, tags, aliases, backlinks, and modified time.
- Added multiple Base name style rules by file extension.
- Added default Base style rules: `canvas #f9a8d4` and `md #3f3f46`.
- Added hex color input and color picker support for Base style rules.
- Improved Markdown and Canvas reference repair after automatic image renaming.
- Moved plugin UI styles into the supported `styles.css` file.
- Removed bundled Baseline theme files from release assets because Obsidian does not download unsupported plugin release files.
