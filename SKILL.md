---
name: render-mermaid
description: Render Mermaid `.mmd` diagrams into faithful, polished SVG and transparent high-resolution PNG files. Use when Codex must convert, redraw, restyle, repair, or visually verify Mermaid flowcharts and other Mermaid diagrams, especially when the user requests ClaudeLike styling, rounded Chinese typography, transparent backgrounds, concentrated layouts, browser-accurate SVG rendering, or default 2× PNG output.
---

# Render Mermaid

Treat the MMD as the diagram specification. Preserve its meaning exactly, then produce a real SVG and a browser-rendered PNG. Never use image generation to redraw a diagram.

## Workflow

1. Read the complete MMD and enumerate its nodes, groups, edge labels, directions, and line styles.
2. Preserve every user-provided label and relationship. Do not add, remove, merge, summarize, translate, or rename content unless requested.
3. Choose the rendering route:
   - Use direct Mermaid rendering for faithful conversion or when the source layout is already sound.
   - Author a designed SVG from the MMD when the user requests ClaudeLike styling or the direct layout is scattered, cramped, or visually weak. Start from `assets/claude-like-template.svg`; keep the MMD semantics unchanged.
4. Render with `scripts/render.cjs`. Default to SVG plus transparent 2× PNG.
5. Open the PNG and visually inspect it. Iterate until labels, borders, arrows, spacing, and transparency are correct.
6. Deliver only the requested artifacts. Keep source `.mmd` unchanged unless the user explicitly requests an edit.

## Commands

Render MMD directly:

```bash
node scripts/render.cjs input.mmd --out-dir output --scale 2
```

Render a designed SVG to PNG:

```bash
node scripts/render.cjs designed.svg --out-dir output --scale 2
```

Pass `--browser /absolute/path/to/chrome-headless-shell` only when automatic browser discovery fails. Use `--help` for all options.

## Visual system

- Keep the canvas transparent unless the user requests a background.
- Use rounded cards and panels; avoid sharp rectangular UI.
- Prefer a restrained palette: ink `#202938`, muted `#667085`, blue `#3976D8`, soft blue `#EAF2FF`, panel `#F7F8FA`, border `#D7DEE8`.
- Use rounded Chinese sans-serif typography with readable hierarchy. Never use FangSong.
- Use solid edges for implemented/current relationships and dashed edges for planned/future relationships when the source makes that distinction.
- Keep nodes concentrated and balanced. Avoid tiny text, excessive whitespace, missing borders, clipped labels, or loose columns.
- Add no title, subtitle, English gloss, legend, summary, platform, or decorative element absent from the source unless requested.

## Quality gate

Accept the output only when all checks pass:

- The script exits successfully and reports no zero-size or clipped text.
- SVG node/group/edge counts and visible labels agree with the MMD.
- PNG dimensions equal SVG CSS dimensions multiplied by the requested scale.
- Transparent output has a genuinely transparent canvas.
- A visual inspection confirms readable text, intact borders, sensible arrow routing, balanced density, and no unintended content.

If direct Mermaid output fails the visual gate, switch to a designed SVG. Do not silently change semantics to improve layout.

## Resources

- `scripts/render.cjs`: deterministic MMD→SVG→PNG and SVG→PNG browser renderer with geometry audits.
- `assets/claude-like-template.svg`: reusable SVG styling, markers, rounded panels, and soft shadows.
- `assets/mermaid.min.js`: vendored Mermaid runtime for offline rendering.
- `assets/NotoSansSC.ttf`: local CJK font used for reproducible browser screenshots.
