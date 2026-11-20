# Quick Start

## Requirements

- Node.js 20 or newer
- npm

## Run the app

Open two terminals in the project folder.

```
npm install
```

Terminal 1, the AI proxy server (port 8787):

```
npm run server
```

Terminal 2, the desktop (port 5173):

```
npm run dev
```

Open http://localhost:5173.

## Enable the AI (optional)

Without a Gemini API key the desktop works, but Clippy and other AI features reply "AI is not available".

The server reads `GEMINI_API_KEY` from the environment. It does not load `.env` by itself, so set the variable in the terminal before starting the server.

PowerShell:

```
$env:GEMINI_API_KEY = "your-key"
npm run server
```

macOS / Linux:

```
GEMINI_API_KEY=your-key npm run server
```

To try the AI offline with scripted replies, set `MOCK_GEMINI=1` the same way.

## Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run e2e` | Browser tests (stop the running servers first so ports 5173 and 8787 are free) |
| `npm run build` | Type check and production build into `dist/` |
