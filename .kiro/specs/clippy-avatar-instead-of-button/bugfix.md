# Bugfix Requirements Document

## Introduction

The desktop shows only a grey "Ask Clippy" button in the bottom-right corner above the status bar. The animated Clippy character is not visible, so users cannot see or click the real agent. The code already mounts a clippyjs agent next to the button, and the assets exist in `public/clippy`. The agent is therefore failing to load or is not visible when it does load. Users should see the actual Clippy character and use it to open the chat. The existing ask-Clippy chat behavior must keep working.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the desktop loads THEN the system shows only the "Ask Clippy" button and no animated Clippy character is visible on screen

1.2 WHEN the user wants to open the Clippy chat THEN the system offers only the text button as the visible way to do so, because the character cannot be seen or clicked

1.3 WHEN the Clippy agent fails to load or cannot be displayed THEN the system gives no visible indication, and the plain button remains the only Clippy presence

### Expected Behavior (Correct)

2.1 WHEN the desktop loads THEN the system SHALL display the animated Clippy character, fully visible above the desktop, windows, and taskbar, in the bottom-right area of the screen

2.2 WHEN the user clicks the Clippy character without dragging it THEN the system SHALL toggle the Clippy chat panel open or closed

2.3 WHEN the Clippy character is visible THEN the system SHALL NOT show the plain "Ask Clippy" button as the primary representation of Clippy. If the agent cannot load, the system SHALL fall back to the button and log the error.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user sends a message in the Clippy chat THEN the system SHALL CONTINUE TO run the orchestrator, show tool steps and the report, and keep session history

3.2 WHEN the `clippy-chat` panel is used THEN the system SHALL CONTINUE TO expose the existing test ids (`clippy-chat`, `clippy-input`, `clippy-send`, `clippy-cancel`, `clippy-step`, `clippy-message`, `clippy-report`), and `clippy-toggle` SHALL remain available only as a fallback when the agent fails to load. Because the toggle button will only render as a fallback, the e2e spec `e2e/clippy-folder.spec.ts` MUST be updated to open the chat via the `clippy-agent` element so that it keeps passing

3.3 WHEN Clippy is thinking or speaking THEN the system SHALL CONTINUE TO play the "Thinking" and "Explain" animations and return to idle afterwards

3.4 WHEN the user interacts with the chat panel THEN the system SHALL CONTINUE TO leave the focused app window unchanged

3.5 WHEN the user drags the Clippy character THEN the system SHALL CONTINUE TO move it without toggling the chat

3.6 WHEN the app loads Clippy assets THEN the system SHALL CONTINUE TO serve them locally from `public/clippy` with no CDN and no text-to-speech
