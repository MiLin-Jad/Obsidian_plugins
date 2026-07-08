# Rename Img

Rename Img is an Obsidian plugin for keeping pasted image workflows tidy. It can rename newly created or pasted images, repair image links after renaming, hide PNG files from the file explorer, and add small helpers for Obsidian Bases.

## Version

Current version: `1.1.3`

## Default Settings

- `Image filename display`: `Show on hover`
- `Hide PNG files in file list`: Enabled
- `Base style rule 1`: `canvas` / `#f9a8d4`
- `Base style rule 2`: `md` / `#3f3f46`

## Features

- Automatically rename newly created or pasted PNG, JPG, and JPEG images.
- Rename images with the current file name plus a six-digit sequence number.
- Repair Markdown and Canvas image references after automatic renaming.
- Hide PNG files from Obsidian's file explorer visually.
- Control Canvas image filename labels: show, hide, or show on hover.
- Create a default `Files.base` file with filters for non-PNG and non-Base files.
- Show default Base properties for name, extension, tags, aliases, backlinks, and modified time.
- Add multiple Base name style rules by file extension.
- Style matching Base name cells with a custom color and bold font weight, including nested text and links inside the cell.
- Choose Base style colors with either hex input or the color picker.
- Open a dedicated plugin page from the Obsidian ribbon or command palette.
- Switch the plugin interface between English and Chinese.

## Default Base

The `Create default base` command creates a `Files.base` file with these filters:

```text
file.ext is not png
file.ext is not base
```

The default visible properties are:

- Name
- Extension
- Tags
- Aliases
- File backlinks
- Modified time

## Personal Theme Recommendation

Baseline is my personal recommended Obsidian theme for this workflow. It is not bundled with this plugin, and the plugin does not download, install, or switch to Baseline automatically.

If you want the same visual style, install the Baseline theme separately through Obsidian's theme system. Obsidian community plugin releases only download supported plugin assets, so full theme files should stay outside this plugin release.

## Release Assets

Upload these supported files to GitHub Releases:

- `main.js`
- `manifest.json`
- `styles.css`

For artifact attestations, create or push the release tag and let the GitHub Actions release workflow build and upload these assets. Assets uploaded manually from a local machine usually do not have GitHub artifact attestations.

Do not upload `node_modules/`. Dependencies can be restored locally with `npm install`.

## Build

```bash
npm install
npm run build
```
