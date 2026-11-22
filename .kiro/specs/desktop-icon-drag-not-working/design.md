# Desktop Icon Drag Not Working Bugfix Design

## Overview

Desktop app icons cannot be moved. Two independent defects cause this. First, `.desktop-icon` in `src/desktop/desktop.css` is not `position: absolute`, so the inline `left`/`top` set by `Desktop.tsx` are ignored and icons stay in the flex flow of `.desktop-icons`. Second, the cell-key expressions in `resolveCells`, `nearestFreeCell` and `endDrag` in `src/desktop/Desktop.tsx` return the same constant string for every cell (they omit the column and row). Every cell then looks occupied once one icon is placed, so saved positions are discarded and the drop search cannot find a free cell.

The fix is minimal: add `position: absolute` to `.desktop-icon`, and make all three key expressions include `col` and `row`. Ideally they share one `cellKey(c: Cell)` helper so they cannot diverge again.

## Glossary

- **Bug_Condition (C)**: The user drags an icon 4 px or more, or the layout is resolved with more than one icon.
- **Property (P)**: The icon follows the pointer, lands in the nearest free cell on drop, all cells are unique, and positions persist across reloads.
- **Preservation**: Launch (double-click, Enter), selection, click-without-move, default layout, resize handling, `desktopIcon: false` filtering, and window/taskbar/Start/Clippy behavior must not change.
- **resolveCells**: Function in `src/desktop/Desktop.tsx` that assigns each icon a cell, using the saved cell if valid and unique, else the next free cell in column-major order.
- **nearestFreeCell**: Function in `src/desktop/Desktop.tsx` that returns the free cell closest to a target cell.
- **endDrag**: Handler in `Desktop` that converts the pointer delta to a cell, finds the nearest free cell, and saves the result.
- **cell key**: String identifying a grid cell in a `taken` set. It should be unique per `(col, row)`.

## Bug Details

### Bug Condition

The bug manifests when an icon is dragged, or when the layout is resolved with several icons. `.desktop-icon` is not absolutely positioned, so the inline offsets have no effect. The cell key also does not depend on `col` or `row`, so `taken.has(key)` is true for every cell after the first insert.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type IconInteraction
  OUTPUT: boolean

  RETURN (input.kind = Drag AND input.distance >= 4px)
         OR (input.kind = ResolveLayout AND count(input.icons) > 1)
END FUNCTION
```

### Examples

- Drag icon B 200 px to the right. Expected: B follows the pointer and lands in a new cell. Actual: B does not move at all.
- Three icons with saved cells `{A:(0,0), B:(2,1), C:(3,0)}`. Expected: all three are honored. Actual: only A is kept, and B and C are reassigned to column-major cells.
- Drop an icon on a cell occupied by another icon. Expected: it snaps to the nearest free cell. Actual: no free cell is found, so the raw target cell is used and two icons can share a cell.
- Reload after a drag. Expected: icons appear in their saved cells. Actual: default column-major layout.
- Edge case: press and release without moving more than 4 px. Expected: no position change and nothing saved (unchanged).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Double-click or Enter on an icon launches the app.
- Single click selects an icon, and clicking empty desktop clears the selection.
- A click without a 4 px move leaves the icon in place and saves nothing.
- With no, malformed, or unreadable saved data, icons are laid out column-major from the top-left without crashing.
- Window resize recomputes the grid, and icons whose saved cell is out of range are reassigned to free cells.
- Apps with `desktopIcon: false` stay off the desktop.

**Scope:**
All inputs that are not an icon drag of 4 px or more, and not a multi-icon layout resolution, should be unaffected. This includes:
- Window title bar drags, window resizing, taskbar, Start menu, and Clippy interactions
- Keyboard and click interactions on icons
- Single-icon layouts

## Hypothesized Root Cause

Both causes are confirmed by code inspection:

1. **Missing absolute positioning**: `.desktop-icon` has no `position` rule. The parent `.desktop-icons` is `position: absolute` with `display: flex` and column wrap, so the icons are flex items and `left`/`top` do nothing. This explains why no visible movement occurs and why the position after drop does not change.

2. **Constant cell key**: `key` in `resolveCells`, the `taken.has(...)` call in `nearestFreeCell`, and the `.map(([, c]) => ...)` in `endDrag` all produce one string regardless of the cell. The `taken` set therefore holds one entry that matches every cell. This explains why saved cells are rejected after the first icon, why the free-cell search never finds a cell, and why the raw target is used on drop.

Together they mean that even if icons could move, the positions would not be validated or persisted correctly.

## Correctness Properties

Property 1: Bug Condition - Icons move, snap to free cells, and persist

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed code SHALL render the icon at its pointer-following position during the drag, place it on drop in the nearest free cell to the snapped and clamped drop point, keep all icon cells pairwise distinct, honor every valid and unique saved cell, and save and restore those cells across reloads.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-drag and non-layout behavior

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce the same result as the original code, preserving launch, selection, click-without-move, default layout, resize handling, `desktopIcon: false` filtering, and window, taskbar, Start menu and Clippy behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/desktop/desktop.css`

**Rule**: `.desktop-icon`

**Specific Changes**:
1. **Absolute positioning**: add `position: absolute;`. The parent `.desktop-icons` is already `position: absolute`, so it acts as the containing block, and `left`/`top` of `PAD + col * CELL_W` and `PAD + row * CELL_H` are relative to it.

**File**: `src/desktop/Desktop.tsx`

**Functions**: `resolveCells`, `nearestFreeCell`, `endDrag`

**Specific Changes**:
2. **Shared key helper**: add a module-level `const cellKey = (c: Cell) => \`${c.col},${c.row}\`;`.
3. **resolveCells**: replace the local `key` with `cellKey`.
4. **nearestFreeCell**: use `taken.has(cellKey({ col, row }))`.
5. **endDrag**: build `taken` with `.map(([, c]) => cellKey(c))`.

No change is needed to the drag threshold, pointer capture, storage format, or `gridSize`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Render `Desktop` with several icons. Check the computed style of an icon, simulate a pointer drag, and call the layout helpers with multiple saved cells. Run these on the UNFIXED code to observe failures.

**Test Cases**:
1. **Computed Position Test**: Assert `getComputedStyle(icon).position === 'absolute'` (will fail on unfixed code).
2. **Saved Cells Honored Test**: Seed storage with `{A:(0,0), B:(2,1), C:(3,0)}` and assert each icon's `left`/`top` matches its cell (will fail on unfixed code).
3. **Drag Test**: Drag an icon by several cells and assert the stored cell changed to the expected one (will fail on unfixed code).
4. **Occupied Drop Test**: Drop on an occupied cell and assert the result is a different, nearest free cell (will fail on unfixed code).

**Expected Counterexamples**:
- Icon position is `static`, and stored cells collapse to default values.
- Drop result equals the occupied target cell.
- Possible causes: missing `position: absolute`, constant cell key.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := desktop_fixed(input)
  ASSERT expectedBehavior(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT desktop_original(input) = desktop_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for launch, selection, short pointer moves, and single-icon layouts, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Launch Preservation**: Double-click and Enter still launch the app.
2. **Selection Preservation**: Click selects, and clicking empty space clears.
3. **Short Move Preservation**: A press and release under 4 px does not change or save a cell.
4. **Fallback Layout Preservation**: Missing or malformed storage gives column-major layout.

### Unit Tests

- `cellKey` returns distinct strings for distinct `(col, row)` and equal strings for equal cells.
- `resolveCells` honors valid unique saved cells, and reassigns out-of-range, duplicate, or missing ones.
- `nearestFreeCell` returns the closest free cell and skips taken ones.
- `.desktop-icon` has `position: absolute`.

### Property-Based Tests

- For random icon counts and random saved cells, `resolveCells` returns pairwise distinct, in-range cells, and keeps every valid unique saved cell.
- For random taken sets and targets, `nearestFreeCell` returns a cell not in the set when one exists.
- For random pointer deltas under 4 px, nothing is saved and the cell is unchanged.

### Integration Tests

- Drag an icon to a new cell, confirm it is placed there, reload, and confirm it is restored.
- Drag an icon onto another icon and confirm both end up in distinct cells.
- Resize the window so a saved cell falls outside the grid and confirm the icon is reassigned to a free cell.
- Double-click an icon after dragging and confirm the app launches.
