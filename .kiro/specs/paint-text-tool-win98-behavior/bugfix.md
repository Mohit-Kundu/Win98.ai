# Bugfix Requirements Document

## Introduction

The Paint app has a Text tool (the "T" button in the toolbox). The user asked for the Text tool to work exactly like it does in Microsoft Paint on Windows 98, and did not ask for a literal textbox. The current implementation, built under the earlier `add-text-button-not-working` spec and the `paint-textbox` task, is a literal textbox. Clicking the canvas opens a single-line HTML `<input type="text">` laid over the canvas (class `paint-text-input`, 80px minimum width, `1px dashed` border). Pressing Enter commits the text. Committing adds one Fabric `IText` object (16px sans-serif, foreground color) to the canvas. The typed text looks like a web form field and not like Windows 98 Paint.

The differences from Windows 98 Paint are:

- The Text tool has no drag-to-define region, no resize handles, and no move.
- Text cannot wrap or span lines.
- There is no Fonts toolbar for font family, size, Bold, Italic, or Underline.
- There is no opaque or transparent background mode, and Paint has no background (secondary) color at all. It has only one color.
- Committed text stays a vector object instead of becoming part of the bitmap.
- Switching tools and pressing Escape discard the typed text.

The existing e2e file `e2e/paint-text-tool.spec.ts` asserts the `.paint-text-input` element and the Enter, Escape and tool-switch behavior above, so it encodes the defective behavior. `FUNCTIONALITY.md` also describes the old behavior.

This spec covers only the Text tool and what it needs to match Windows 98: a background color, and the Fonts toolbar. It adds nothing beyond what Windows 98 Paint does.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Text tool is selected and the user presses and drags on the canvas THEN the system defines no text region. It opens a single-line input at the press point only and ignores the dragged rectangle.

1.2 WHEN the user clicks the canvas with the Text tool THEN the system shows a generic web-style single-line input with a dashed border and no resize handles, instead of a dotted selection rectangle with resize handles.

1.3 WHEN the user types text that is wider than the input, or presses Enter THEN the system scrolls the text inside the single-line input and cannot wrap it, and Enter commits the text instead of starting a new line.

1.4 WHEN the Text tool is active THEN the system shows no Fonts toolbar. The text is always 16px sans-serif, with no Bold, Italic, or Underline.

1.5 WHEN the Text tool is active THEN the system offers no opaque or transparent background mode, and Paint has no background (secondary) color. The committed text always draws only glyphs.

1.6 WHEN a text input is open THEN the system provides no way to move it or resize it before it is committed.

1.7 WHEN the text is committed THEN the system adds a trimmed Fabric `IText` vector object to the canvas, so the text is not part of the bitmap. The same step drops leading and trailing whitespace and blank lines the user typed.

1.8 WHEN the user selects a different tool, or presses Escape, while text is pending THEN the system discards the typed text without drawing it.

1.9 WHEN the user clicks Save, Save As, New, or AI Automate while text is pending THEN the system does not finish the text first. The pending text either is lost or is committed only as a side effect of the input losing focus.

### Expected Behavior (Correct)

2.1 WHEN the Text tool is selected and the user presses and drags on the canvas THEN the system SHALL define a text region from the press point to the release point, clamped to the canvas, and SHALL open it for typing at the release.

2.2 WHEN the Text tool is selected and the user clicks the canvas without dragging THEN the system SHALL create a text region of a default size anchored at the click point, and SHALL draw the region as a dotted border with resize handles, with no form-input styling such as a solid border, a bottom border, or an input background.

2.3 WHEN the user types in an open text region THEN the system SHALL insert the text directly into the region, SHALL wrap it at the region's right edge, and SHALL start a new line when the user presses Enter.

2.4 WHEN a text region is open THEN the system SHALL show a Fonts toolbar with a font family choice, a font size choice, and Bold, Italic, and Underline toggles. Changing them SHALL restyle all the text in the region, and the committed text SHALL use the chosen style. The text SHALL use the current foreground (primary) color.

2.5 WHEN the Text tool is active THEN the system SHALL offer an opaque and a transparent background mode, with transparent as the default. Opaque SHALL fill the whole region with the background (secondary) color when committed, and transparent SHALL draw only the glyphs. Paint SHALL have a background color that defaults to white and that the user sets by right-clicking a palette swatch. The current foreground and background colors SHALL be shown.

2.6 WHEN a text region is open THEN the system SHALL let the user move it by dragging its border and resize it by dragging its handles, and SHALL rewrap the text to the new width. The region SHALL stay editable until it is committed.

2.7 WHEN the text is committed THEN the system SHALL draw it onto the canvas bitmap as pixels, in the region's font, size, style, and colors, with every line and the user's own spaces kept as typed. The text SHALL no longer be editable and SHALL NOT remain as a separate object. The system SHALL record exactly one history entry for the commit.

2.8 WHEN the user clicks outside the region, selects a different tool, or presses Escape THEN the system SHALL commit the text as described in 2.7. WHEN the region is empty at that point THEN the system SHALL remove it and leave the canvas and history unchanged. Windows 98 Paint's treatment of Escape is assumed to be commit. Confirm this during review.

2.9 WHEN the user clicks Save, Save As, New, or AI Automate while a text region is open THEN the system SHALL commit the region first, so the saved or processed image includes the text.

2.10 WHEN the user clicks outside an open region with the Text tool still selected THEN the system SHALL commit the open region, and a drag or click on that same gesture SHALL start a new region.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a tool other than Text is active (pencil, brush, eraser, line, rectangle, ellipse, fill) THEN the system SHALL CONTINUE TO draw, fill, and record history exactly as before.

3.2 WHEN the user commits text and then uses Undo or Redo, from the toolbar or with Ctrl+Z, Ctrl+Y, or Ctrl+Shift+Z THEN the system SHALL CONTINUE TO restore the canvas through the existing history stack, with the committed text as one step.

3.3 WHEN the user clicks the Text tool button THEN the system SHALL CONTINUE TO make Text the active tool, show the button as pressed, and show the text cursor over the canvas. Selecting any other tool SHALL CONTINUE TO activate that tool and update the pressed state and cursor.

3.4 WHEN the user saves a drawing, saves it under a new name, or reopens it from the file system THEN the system SHALL CONTINUE TO export the canvas as PNG, persist it, and load it back, including any committed text.

3.5 WHEN the user runs AI Automate THEN the system SHALL CONTINUE TO send the current canvas image, show the loading overlay, and replace the canvas with the result, as before.

3.6 WHEN the user picks a foreground color with the left-click palette action or changes the brush size THEN the system SHALL CONTINUE TO apply it to the drawing tools as before.

3.7 WHEN the Paint root has focus and no text region is open THEN the system SHALL CONTINUE TO receive Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z keyboard shortcuts as before.

3.8 WHEN the user opens, moves, resizes, or closes the Paint window, or uses any other app (desktop, Explorer, WordPad, Recycle Bin, Clippy) THEN the system SHALL CONTINUE TO behave as before.
