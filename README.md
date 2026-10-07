# PDF Paint

A Windows 98 Paint-style PDF editor that runs entirely in the browser.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Features
- Open a PDF (File > Open, Ctrl+O, or drag & drop). It never leaves the browser; the file and your edits are autosaved to IndexedDB so a refresh picks up where you left off. File > Close Document clears it.
- Page thumbnails sidebar: click to jump, drag to reorder, ▲ ▼ to move pages.
  - Toolbar buttons (+ ✂ copy paste ✕), a right-click menu, and the Page menu add a blank page, or cut, copy, paste and delete pages. A copied page brings its shapes, text and pictures with it, and a new blank page matches the size of the page before it.
  - The dashed **+** tile at the end of the list adds a blank page at the end.
  - While the page list has focus (click a thumbnail), Ctrl/Cmd+X, C, V, Delete and the ↑ ↓ arrow keys act on pages. Click the document to go back to acting on drawn objects.
- Tools (keyboard shortcut in brackets): Select [S], Insert Picture [I], Redact [R], Pencil [P], Text [T], Line [L], Rectangle [B], Ellipse [E].
- Paint-style color box: left-click picks the primary color (outline / text), right-click picks the secondary color (fill / text background), double-click edits a palette color.
- Pencil draws freehand; Line draws straight lines (Shift snaps to 45°). Both have five thicknesses (1, 2, 3, 5, 8 pt), can be moved, resized and recolored, and are saved as vector paths.
- Shape options: outline, outline + fill, or fill only, plus the same five line widths. Shift draws squares and circles.
- Text: Arial, Times New Roman, or Courier New, 8–72pt, bold / italic / underline, opaque or transparent background.
- Pictures: JPG, PNG, BMP (BMP is converted to PNG). Insert from the tool, drag & drop, or paste. Drag to move, use the handles to resize (Shift keeps proportions).
- Undo / redo, cut / copy / paste / duplicate, arrow-key nudging, bring to front / send to back, zoom.
- Redact draws black boxes that always sit on top of everything else.
- Save as PDF: drawings, text and images are written as vector PDF content on top of the original pages. With "Permanently remove content under redactions" checked (the default), pages that have redactions are flattened to 216 DPI images, so the covered text really is gone. Without it, or with a plain black rectangle, the box only covers the text and it can still be copied out.
