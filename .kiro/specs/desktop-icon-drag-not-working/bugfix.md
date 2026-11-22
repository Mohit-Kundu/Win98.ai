# Bugfix Requirements Document

## Introduction

Desktop app icons cannot be moved around the desktop. The user reports "I can't still move app icons around on desktop", which means an earlier attempt to add drag-to-rearrange (documented in FUNCTIONALITY.md as "drag to rearrange; positions are saved") did not work. Dragging an icon shows no visible movement, and the icon does not end up in a new position. Icon layout code lives in `src/desktop/Desktop.tsx` and `src/desktop/desktop.css`.

Investigation found two defects in the existing drag implementation:

- The `.desktop-icon` CSS rule has no `position: absolute`. The icons are flex items in a column-wrapping `.desktop-icons` container, so the inline `left` and `top` values set during and after a drag are ignored. Icons always stay at their flex-flow positions.
- The grid cell key helper (`key` in `resolveCells`) and the key expressions in `nearestFreeCell` and `endDrag` all produce the same constant string for every cell. The occupancy check therefore treats every cell as taken once any icon is placed. Saved positions are rejected for all but one icon, and the drop-target search cannot find a free cell, so it falls back to the raw target cell.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user presses on a desktop icon and drags it more than 4 px THEN the system does not move the icon visually, because the inline `left`/`top` offsets have no effect on an icon that is not absolutely positioned.

1.2 WHEN the user releases a dragged icon over a new grid cell THEN the system leaves the icon at its original flex-flow position, so the icon appears not to have moved.

1.3 WHEN the icon layout is resolved and more than one icon exists THEN the system treats all grid cells as occupied after the first icon is placed, because the cell key is the same for every cell. Saved cells for the remaining icons are discarded and they are reassigned by column-major order.

1.4 WHEN a dragged icon is dropped and the drop target is searched THEN the system cannot find a free cell, because every cell compares as taken. It does not snap to the nearest free cell and does not prevent two icons from being assigned the same cell.

1.5 WHEN the page is reloaded after an attempted drag THEN the system shows icons in their default column-major layout, not in the positions the user dragged them to.

### Expected Behavior (Correct)

2.1 WHEN the user presses on a desktop icon and drags it more than 4 px THEN the system SHALL move the icon so it follows the pointer, with the dragging style applied.

2.2 WHEN the user releases a dragged icon over a new grid cell THEN the system SHALL place the icon in that cell, snapped to the grid and clamped to the visible desktop area above the taskbar.

2.3 WHEN the icon layout is resolved THEN the system SHALL identify each cell by its own unique column and row, so that saved cells for all icons are honored when they are valid and unique.

2.4 WHEN a dragged icon is dropped on a cell occupied by another icon THEN the system SHALL place it in the nearest free cell, and no two icons SHALL share a cell.

2.5 WHEN the page is reloaded after an icon has been moved THEN the system SHALL restore every icon to its saved cell, falling back to the next free cell only for icons whose saved cell is missing, out of range, or duplicated.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user double-clicks a desktop icon THEN the system SHALL CONTINUE TO launch the associated app.

3.2 WHEN the user presses Enter on a focused desktop icon THEN the system SHALL CONTINUE TO launch the associated app.

3.3 WHEN the user single-clicks a desktop icon THEN the system SHALL CONTINUE TO select it, and WHEN the user clicks empty desktop space THEN the system SHALL CONTINUE TO clear the selection.

3.4 WHEN the user presses and releases an icon without moving it more than 4 px THEN the system SHALL CONTINUE TO leave the icon in its current cell and not save a new position.

3.5 WHEN no positions have been saved, or saved data is missing, malformed, or unreadable THEN the system SHALL CONTINUE TO lay icons out in column-major order from the top-left without crashing.

3.6 WHEN the browser window is resized THEN the system SHALL CONTINUE TO recompute the grid, and icons whose saved cell falls outside the new grid SHALL CONTINUE TO be reassigned to free cells.

3.7 WHEN an app is registered with `desktopIcon: false` THEN the system SHALL CONTINUE TO omit it from the desktop.

3.8 WHEN the user drags a window title bar, resizes a window, or uses the taskbar, Start menu, or Clippy THEN the system SHALL CONTINUE TO behave as before.

## Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type IconInteraction  // pointer drag of a desktop icon, or layout resolution with saved cells
  OUTPUT: boolean

  RETURN (X.kind = Drag AND X.distance >= 4 px)
      OR (X.kind = ResolveLayout AND count(X.icons) > 1)
END FUNCTION
```

```pascal
// Property: Fix Checking - Icon drag and placement
FOR ALL X WHERE isBugCondition(X) DO
  result ← desktop'(X)
  ASSERT result.iconFollowsPointerDuringDrag
     AND result.iconCellAfterDrop = nearestFreeCell(snap(X.dropPoint))
     AND all icon cells are pairwise distinct
     AND result.savedCells = result.iconCells
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT desktop(X) = desktop'(X)
END FOR
```

Counterexample: with three icons, saved cells `{A:(0,0), B:(2,1), C:(3,0)}`, `resolveCells` keeps only A. B and C are reassigned to default cells, and dragging B to (5,2) leaves it at its flex-flow position.
