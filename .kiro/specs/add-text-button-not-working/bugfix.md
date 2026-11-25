# Bugfix Requirements Document

## Introduction

The Paint app has a Text tool (the "T" icon labelled "Text" in the tool palette). With it selected, clicking the canvas should open a text input at that point, and pressing Enter or clicking elsewhere should draw the typed text onto the canvas. The user confirmed the affected control: "when I click on the textbox icon it doesn't allow me to create a text box to enter text." The control is therefore the Text tool icon, and the symptom is that no text box appears or accepts typing.

The report does not say which step fails, so the defect could be at any of three points in the flow:

- **Tool activation**: clicking the Text icon does not make Text the active tool (no pressed state, no text cursor, canvas still in the previous tool's mode).
- **Text box creation**: the Text tool is active, but clicking the canvas does not open the text input at all.
- **Text box retention**: the input opens but is dismissed or loses focus at once, so the user cannot type.

The most likely cause is the third point, a focus race. The canvas click opens the input and focuses it. The browser's default mousedown focus change, together with the surface's `onPointerDown` handler that focuses the Paint root, then blurs the input. The input's `onBlur` handler commits an empty string, which closes the overlay before the user can type. The same `onPointerDown` handler also runs when the user clicks inside the open input, because the input is a child of the surface, so that click can also blur the input and close it. Reading the code shows no obvious fault in tool activation (the button calls `setTool`) or in creation (the canvas `mouse:down` handler sets the overlay state for the Text tool), but none of the three points has been reproduced in a browser, and the Text tool has no automated tests. The design phase should confirm which point fails.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Text tool is selected and the user clicks on the canvas THEN the system closes the text input immediately, or never keeps it focused, so the user cannot type any text
1.2 WHEN the user clicks the Text tool and then clicks the canvas THEN the system draws no text, adds no history entry, and shows no error
1.3 WHEN the text input loses focus because of the click that opened it THEN the system treats the loss of focus as a commit of empty text and discards the pending text position
1.4 WHEN the user clicks the Text tool icon THEN the system may fail to make Text the active tool, so the icon does not show as pressed and the canvas keeps the previous tool's behaviour
1.5 WHEN the Text tool is active and the user clicks on the canvas THEN the system may fail to open a text input at the clicked point, so no text box appears
1.6 WHEN the text input is open and the user clicks inside it to position the caret or continue typing THEN the system may move focus to the Paint root, which blurs the input and closes it

### Expected Behavior (Correct)

2.1 WHEN the Text tool is selected and the user clicks on the canvas THEN the system SHALL show a text input at the clicked point and keep it focused until the user commits or cancels
2.2 WHEN the user types text in the input and presses Enter, or clicks elsewhere on the canvas or window THEN the system SHALL draw the text on the canvas at the clicked point in the current colour and record one history entry
2.3 WHEN the input receives focus from the click that opened it, or from the Paint root being focused by the surface pointer handler THEN the system SHALL NOT treat that as a commit or cancel
2.4 WHEN the user clicks the Text tool icon THEN the system SHALL make Text the active tool, show the icon as pressed, and show the text cursor over the canvas
2.5 WHEN the Text tool is active and the user clicks on the canvas THEN the system SHALL open a text input at the clicked point, on the first click, regardless of which tool was active before
2.6 WHEN the text input is open and the user clicks inside it THEN the system SHALL keep it open and focused so the user can position the caret and keep typing

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user presses Escape in the text input THEN the system SHALL CONTINUE TO close the input without drawing text
3.2 WHEN the user clicks a tool palette button while the text input is open THEN the system SHALL CONTINUE TO cancel the pending text and switch tools
3.3 WHEN the text input is committed with only whitespace THEN the system SHALL CONTINUE TO draw nothing and add no history entry
3.4 WHEN a tool other than Text is active (pencil, brush, eraser, line, rectangle, ellipse, fill) THEN the system SHALL CONTINUE TO draw, fill, and record history exactly as before
3.5 WHEN the user commits text and then uses Undo or Redo THEN the system SHALL CONTINUE TO restore the canvas state through the existing history stack
3.6 WHEN the Paint root is focused by clicking the surface with a non-Text tool THEN the system SHALL CONTINUE TO receive keyboard shortcuts as before
3.7 WHEN the user clicks any tool icon other than Text THEN the system SHALL CONTINUE TO activate that tool and update the pressed state and cursor as before
