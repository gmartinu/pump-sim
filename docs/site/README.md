# site/

Notes on the project homepage in `site/` (kept here, outside `site/`, so they are not published with it;
[DEVIATIONS.md](DEVIATIONS.md) lists the accepted deviations from the approved artboards). The homepage is published to <https://gmartinu.github.io/pump-sim/> by
[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml), which uploads `site/` as is, on every push to `main` that touches `site/`.

- Static: `index.html`, `css/`, `js/` (classic scripts, so it also works opened from disk), `fonts/`, `assets/`.
  No build step, no external request (closed CSP in `index.html`), relative paths only.
- Design source: the approved artboards in the workspace (`Homepage.dc.html`, `Homepage-mobile.dc.html`,
  `homepage-i18n.js`). Copy lives in `js/i18n.js`, pt-BR by default with an EN toggle.
- Theme: dark by default; light only through the toggle (stored in `localStorage`, key
  `pump-sim-site:theme`). `prefers-color-scheme` is ignored on purpose.
- `css/tokens.css` and `css/fonts.css` are copies of `ui/tokens.css` and `ui/fonts.css`; keep them in step.
- `fonts/material-symbols-rounded-subset.woff2` is a subset of `tools/fonts/material-symbols-rounded.woff2`
  (3 MB → 28 KB) holding only the icons the page uses. After adding an icon, regenerate it (from the
  repository root; the web UI's own subset is made the same way by `node tools/gen-icon-subset.mjs`):

  ```sh
  N="download terminal open_in_new verified content_copy lan rule smart_toy history data_object shield swipe menu light_mode dark_mode code arrow_forward close check local_gas_station list_alt settings_input_hdmi sell tune swap_vert badge difference memory expand_more cable schedule radio_button_unchecked lock_open task_alt lock hourglass_top error pan_tool_alt back_hand restart_alt verified_user"
  G=""; for n in $N; do G="$G,$n,$n.fill"; done
  pyftsubset tools/fonts/material-symbols-rounded.woff2 --unicodes="U+0020-007F" --glyphs="${G#,}" \
    --layout-features='*' --no-layout-closure --flavor=woff2 \
    --output-file=site/fonts/material-symbols-rounded-subset.woff2
  ```
