# DIJP GitHub Pages Viewer

This directory is the static viewer for DIJP/0.7. It contains no generator,
Python runtime, localhost API, Pyodide, Node dependency, or build step.

## STANDARD and DEDICATED

Both modes use the same `assets/dual_interpretation.jpg`.

- **STANDARD** uses the browser's native JPEG decoder and displays canonical M.
- **DEDICATED** reads the DIJP APP15 metadata and shared entropy stream in
  JavaScript, then displays A, M, B, and bijective transitions between them.

The dedicated transition does not add mapping collisions, gaps, coefficient
damage, crossfades, or post-render noise.

## Local preview

Serve the repository root with any static HTTP server, then open
`/works/2607-2/`.
For example:

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/works/2607-2/`. Direct `file://` access is not
supported because the viewer fetches its JPEG asset.

## GitHub Pages

Publish the repository root or copy this directory to `works/2607-2/` in a
personal Pages repository. Every runtime URL is relative, so the viewer works
at:

```text
https://<username>.github.io/works/2607-2/
```

This viewer uses a fixed JPEG and does not include the two-image generation UI.
