# Boardspeak

**Play it by hand. Play it by voice.**

[Play Boardspeak](https://boardspeak.vercel.app)

## What it is

Boardspeak is an open-source web board game where White plays with a mouse and Black plays by talking to an AI agent. The page publishes the live board as WebMCP tools, so both players act on the same visible state and the legal tool surface changes with every turn.

> Demo video: final three-minute walkthrough coming before submission.

![Boardspeak at the opening position, with the board and live WebMCP tool rail visible together](./public/readme/boardspeak-desktop.webp)

[View the complete 360px layout capture](./public/readme/boardspeak-mobile.webp).

## Status

Boardspeak is live at [boardspeak.vercel.app](https://boardspeak.vercel.app). The production release includes the complete Breakthrough engine, mouse game, nine-tool WebMCP surface, solo practice mode, layered narration, and an inspectable call trace for [The WebMCP Challenge](https://openai.com/webmcp-challenge/).

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Add `?demo=1` in a plain browser. After White moves, **Demo: agent turn** invokes one legal Black move through the same traced execution path an agent uses.

Turn on **Play the board** to let the built-in White bot answer after 300ms. Black remains controlled by the agent or by mouse, so one person can demonstrate the complete game loop.

Narration is on by default and needs no configuration. Without `OPENAI_API_KEY`, moves use the browser Web Speech API; with the key set only on the server, `/api/narrate` returns short AI-generated speech and silently falls back to Web Speech on any error.

## Play it with your agent

### ChatGPT desktop browser

1. Open [boardspeak.vercel.app](https://boardspeak.vercel.app) inside ChatGPT's built-in browser.
2. Use the latest ChatGPT desktop app with GPT-5.6 Sol or Terra.
3. Enable **Site tools** from the browser address bar if prompted, then ask, “What’s on the board?”

### Chrome 149+

1. Open `chrome://flags/#enable-webmcp-testing`, enable WebMCP testing, and relaunch Chrome.
2. Install the Model Context Tool Inspector extension.
3. Open Boardspeak and inspect the tools registered by the page.

Without native WebMCP, Boardspeak shows a dismissible setup banner and loads the GoogleChromeLabs compatibility layer so the Inspector can still discover the page tools.

## How it works

An agent could play this game three ways. A remote MCP server gives the agent its own copy of the game and cuts the page out of the loop, so the two players stop looking at the same truth. A browser agent guesses legality from pixels. WebMCP puts the tools in the page itself: same tab, same session, same state the human is watching, and legality is not merely a check inside the tool. It is the shape of the tool, an enum regenerated every turn, so an illegal move is not a value the agent can send. Tools that do not apply do not exist. The specification lists improving accessibility through agents as intermediaries as an explicit goal; Boardspeak demonstrates that goal directly.

Each tool uses the imperative `document.modelContext.registerTool` path through `use-webmcp-tool`. When a turn changes the move enum, the previous registration is aborted and the same tool name is registered with the new schema. Every mutation resolves only after React has committed the matching board and rail state, and every call is visible in the on-page trace.

![The WebMCP tool rail changing from White's suggestion surface to Black's exact move enum and back after the agent acts](./public/readme/tool-rail-turn.gif)

## Tool surface

| Tool | When it exists | Mode | Returns |
|---|---|---:|---|
| `describe_board` | Always | READ | Text and JSON board snapshot |
| `get_rules` | Always | READ | Rules and notation |
| `list_legal_moves` | Always | READ | Tagged Black moves |
| `play_move` | Black to move | ACT | Move result and updated board |
| `play_capture` | Black can capture | ACT | Capture result and updated board |
| `list_threats` | A pawn is one step from winning | READ | Threatening pieces by side |
| `suggest_move` | White to move | ACT | A visible, non-binding move suggestion |
| `resign_game` | A game is live | ACT | Confirmed resignation or cancellation |
| `start_new_game` | Always | ACT | Reset result or cancellation |

## Evaluation

Start the deterministic fixture with `pnpm dev:eval`, then run:

```bash
npx webmcp-evals smoke -u http://localhost:3000 -e evals/cases.json
```

| Case | Expected tool | Smoke result |
|---|---|---|
| Describe the board | `describe_board` | PASS |
| List options | `list_legal_moves` | PASS |
| Advance e7 | `play_move` with `e7-e6` | PASS |
| Take a piece | `play_capture` with `e7xd6` | PASS |
| Resign | `resign_game` | PASS |

**Result: 5/5 steps passed across 5 cases.** Each case opens a fresh page. The eval-only fixture starts on Black's turn with both the required advance and capture legal, and auto-confirms only the smoke-only resignation flow.

The current npm release, `webmcp-evals@0.0.3`, does not yet expose the `smoke` command documented on GoogleChromeLabs `main`. The result above was produced with the current upstream `main` smoke runner using Chrome stable; the exact published-package command is retained for reruns after that release catches up.

### Product verification

Run the full local gate:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

| Check | Result |
|---|---:|
| Unit, reducer, component, narration, and WebMCP contract tests | 50/50 PASS |
| Chrome-compatible Playwright flows at desktop and 360px | 4/4 PASS |
| Twenty plies plus tool-driven New Game against a duplicate-name-throwing registry | 0 `InvalidStateError` |
| Browser console and uncaught page errors across the four end-to-end flows | 0 |
| Lighthouse accessibility on the production build | 100 |
| Next.js production build | PASS |

## Accessibility

The board is a semantic grid of 64 native buttons with exact square and occupancy labels, visible keyboard focus, and a polite live move/win log. Three audio layers work in order: that always-available live region, the browser Web Speech API with no configuration, and optional OpenAI text-to-speech when a server-side key is present. Enhanced narration is disclosed in the interface as AI-generated. The agent-facing description and legal-move tools let a blind player understand and play the same visual position by conversation.

## License

[MIT](LICENSE) © 2026 Robert Huynh.
