# Deviations from the approved artboards

Reference: the approved homepage artboards, kept outside this repository: `Homepage.dc.html` (desktop, 1280 px frame) and
`Homepage-mobile.dc.html` (390 px frame). Reviewed 2026-10-17 by rendering each artboard frame and the
site side by side in headless Chrome (1280/1440 and 390 px, dark and light, PT and EN) and comparing
element boxes.

## Requested changes (normative)

- Dark is the default theme; light only through the toggle, remembered in `localStorage`
  (`pump-sim-site:theme`). `prefers-color-scheme` is ignored for the default.
- The "Executável assinado" card is removed. The footer keeps one SignPath attribution line
  linking `CODE_SIGNING.md`, as SignPath Foundation's terms require.

## Accepted deviations

- **`END n` tag and lado header in the channel cards.** The homepage artboards use `.endtag` and
  `.lado-h` without defining them, so the artboard renders `END 1` as plain 15 px sans text and the
  "Retirar/Recolocar bico" button right next to the badge. The site uses the definitions from
  `Pista.dc.html` / `ui/app.css` (11 px mono, ink-3; button pushed to the right), which is what the
  real app shows. Side effect: each lado header is ~2 px shorter, so the hero card is 2 px (desktop)
  / 4 px (mobile) shorter and everything below shifts up by that amount.
- **Hero horizontal gutter below 1200 px.** The artboard's `.hero { padding: 84px 0 64px }` zeroes
  the `.wrap` side padding; at the artboard's 1280 px width this is invisible. The site keeps the
  40 px gutter so the hero does not touch the viewport edge between 761 and 1200 px. Identical at
  1280 px and wider.
- **Live data.** The hero card and the interface preview animate (totals, volumes, clock), so the
  numbers differ from the static artboard values frame to frame.
- **Tablet band (761-1080 px).** Not in the artboards; added so the desktop layout does not
  overflow between the two designed widths.

## Fixed during review

- `.bb` buttons were `border-box` (44/48 px tall); the artboard is `content-box` (46/50 px).
- `.icbtn` is a `<button>` (UA `border-box`, 32/44 px); set `content-box` to match 34/46 px.
- `.seg` buttons used line-height 1.2 (31 px segment); the artboard spans inherit 1.5 (35 px).
- Mobile: the quick-start segment did not get the 9 px side padding the artboard applies to every
  `.seg` (151 vs 143 px wide).
- Mobile: footer links grid did not stretch to the full width (links 84 px wide instead of two
  171 px columns).
