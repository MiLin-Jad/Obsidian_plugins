# Image Auto Rename

An Obsidian plugin that automatically renames newly created, pasted, or current-file images with the note name and a per-file sequence.

## Features

- Renames `png`, `jpg`, and `jpeg` files.
- Uses names like `Note-Name_000001.png`.
- Supports Markdown embeds and Canvas file nodes.
- Can hide Canvas image file names or show them on hover.
- Does not collect telemetry or send files over the network.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The production build writes `main.js`.

## Release Assets

Upload these files to each GitHub Release:

- `main.js`
- `manifest.json`
- `styles.css`

## License

MIT
