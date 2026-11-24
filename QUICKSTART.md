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

Without an API key the desktop works, but Clippy and other AI features reply "AI is not available".

The server uses OpenRouter by default and reads `OPENROUTER_API_KEY` from the environment. To use Gemini instead, set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`. `npm run server` and `npm start` load `.env` from the project root (Node 20.6 or later), so you can put the variables there. Variables set in the terminal also work and take precedence over `.env`.

PowerShell:

```
$env:OPENROUTER_API_KEY = "your-key"
npm run server
```

macOS / Linux:

```
OPENROUTER_API_KEY=your-key npm run server
```

To try the AI offline with scripted replies, set `MOCK_GEMINI=1` the same way.

## Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run e2e` | Browser tests (stop the running servers first so ports 5173 and 8787 are free) |
| `npm run build` | Type check and production build into `dist/` |
