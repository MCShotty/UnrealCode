# UnrealCode mark

The UC monogram and square accent were redrawn as vector geometry from the
project owner's supplied reference. An ImageGen exploration informed the cleanup;
the production assets are the flat SVG paths here, not the generated raster.

| Asset | Use |
| --- | --- |
| `unrealcode-mark-dark.svg` / `.png` | Off-white `#F5F7FA` with cyan `#00B9DA` on dark surfaces. The SVG is the geometry source. |
| `unrealcode-mark-light.svg` / `.png` | Navy `#122039` with deeper teal `#007C94` on light surfaces. |
| `unrealcode-icon.svg` | Fixed navy tile with rounded corners and the dark-surface mark. |
| `../unrealcode-icon.png` / `.ico` | Window/installer assets; ICO contains 16, 24, 32, 48, 64, 128, and 256 pixel frames. |

All fills are solid. Do not add bloom, glow, gradients, metallic effects, or
drop shadows. Keep both theme variants' geometry identical.

Regenerate derived assets from `desktop/` with `npm run brand:generate`.
The development-only renderer needs Playwright Chromium
(`npx playwright install chromium --only-shell`). It is not bundled in the app.
