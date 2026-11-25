# Text tool (T) for Paint

Adds a "T" tool to the Paint toolbar. Clicking the canvas with the tool active opens an absolutely positioned input. Enter or blur draws the text as a Fabric `IText` (16px sans-serif, foreground color). Escape or a tool switch cancels. The range under review is the last of four commits, which only changes `onBlur` so that clicking a toolbar button cancels the in-flight text instead of committing it. I read the full feature in `Paint.tsx` and `paint.css` to judge it against the task. The coder reports `tsc` clean for `Paint.tsx` and an untested browser run. The build fails on existing errors in two unrelated test files.

Watch for: no automated tests cover the text tool (confirmed). Cancel-on-tool-switch depends on `relatedTarget`, which is null in browsers that don't focus buttons on click (likely). The overlay input is about 3px off from where the text is drawn (likely).

**Verdict**: APPROVED

## High-level view

The tool follows the existing pattern. It is a new `Tool` union member with an inline SVG icon, an entry in `TOOLS`, and a branch in the Fabric `mouse:down` handler. Buttons render through the existing `.paint-tool-btn` and `aria-pressed` path, so selecting T deselects the previous tool. The font is hard-coded to 16px sans-serif, which matches the requirement because Paint has no font controls.

The final commit resolves an ordering problem. Clicking a toolbar button blurs the input before the `[tool]` effect runs, so the blur used to commit text on a tool switch. The blur handler now checks whether focus moved into `.paint-tools` and cancels in that case. Clicks elsewhere commit.

<details>
<summary>Issues (3)</summary>

1. **No tests for the text tool** (confirmed): add tests for commit on Enter, cancel on Escape, cancel on tool switch, and that history records one entry.
2. **Tool-switch cancel relies on `relatedTarget`** (likely): Safari and Firefox on macOS don't focus buttons on click, so `relatedTarget` is null. The blur then commits the text, and a tool switch commits instead of cancelling. Text is not lost, so this is acceptable, but consider `onMouseDown` preventDefault on tool buttons, or an explicit cancel in the tool click handler.
3. **Overlay offset** (likely): the input has a 1px border and 2px horizontal padding in `paint.css`, so the typed text sits slightly right of and below where the committed `IText` is drawn. Offset the overlay or the commit position.

</details>

<details>
<summary>Details</summary>

### Blur versus tool-switch ordering

The `[tool]` effect that cancels the overlay runs after the blur event. Without the last commit, the blur would commit the text before the effect could cancel it. The `relatedTarget?.closest('.paint-tools')` check fixes that ordering where focus does move to the button. In browsers that leave focus off buttons on click, `relatedTarget` is null. The handler then takes the commit path, and the later effect finds nothing to cancel. Clicking the other toolbar buttons (New, Undo) or the palette also commits, which matches "clicking elsewhere commits".

### Overlay and commit coordinates

The overlay position uses `offsetX/offsetY` minus the surface scroll. The committed `IText` uses the scene point. The input's border and padding shift the visible caret text a few pixels from the final render, so the text jumps on commit.

### Test coverage

The text tool has no unit or integration tests. The existing paint tests cover pencil strokes and history only. Not tested: commit on Enter, Escape cancel, tool-switch cancel, and undo after a text commit. The coder did not run it in a browser.

</details>

<details>
<summary>File map</summary>

Last commit: `src/apps/paint/Paint.tsx` (onBlur cancels when focus moves into the tool palette). Earlier commits in the feature also touched `paint.css` and the docs. Full diff: `git diff HEAD~1...HEAD`.

</details>
