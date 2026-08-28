# Boardspeak

**Play it by hand. Play it by voice.**

Boardspeak is an open-source web board game where White plays with a mouse and Black plays by talking to an AI agent. The page publishes the live board as WebMCP tools, so both players act on the same visible state and the legal tool surface changes with every turn.

> Demo video: coming with the playable release.

## Status

Boardspeak is under active construction for [The WebMCP Challenge](https://openai.com/webmcp-challenge/). The repository is being kept runnable and documented at every build stage.

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Play it with your agent

### ChatGPT desktop browser

1. Open the deployed Boardspeak URL inside ChatGPT's built-in browser.
2. Use the latest ChatGPT desktop app with GPT-5.6 Sol or Terra.
3. Enable **Site tools** from the browser address bar if prompted, then ask, “What’s on the board?”

### Chrome 149+

1. Open `chrome://flags/#enable-webmcp-testing`, enable WebMCP testing, and relaunch Chrome.
2. Install the Model Context Tool Inspector extension.
3. Open Boardspeak and inspect the tools registered by the page.

The full judge walkthrough and troubleshooting notes will be added as each integration is verified.

## How it works

An agent could play this game three ways. A remote MCP server gives the agent its own copy of the game and cuts the page out of the loop, so the two players stop looking at the same truth. A browser agent guesses legality from pixels. WebMCP puts the tools in the page itself: same tab, same session, same state the human is watching, and legality is not merely a check inside the tool. It is the shape of the tool, an enum regenerated every turn, so an illegal move is not a value the agent can send. Tools that do not apply do not exist. The specification lists improving accessibility through agents as intermediaries as an explicit goal; Boardspeak demonstrates that goal directly.

> Tool-rail transition GIF: coming with the WebMCP integration.

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

The WebMCP evaluation cases and measured results will land with the tool implementation.

```bash
npx webmcp-evals smoke -u http://localhost:3000 -e evals/cases.json
```

| Case | Expected tool | Result |
|---|---|---|
| Describe the board | `describe_board` | Pending |
| List options | `list_legal_moves` | Pending |
| Advance e7 | `play_move` | Pending |
| Take a piece | `play_capture` | Pending |
| Resign | `resign_game` | Pending |

## Accessibility

Boardspeak will use three audio layers: an always-available `aria-live` move log, the browser Web Speech API with no configuration, and optional OpenAI text-to-speech when a server-side key is present. The board will remain a semantic grid of labeled buttons, while the agent-facing description and legal-move tools let a blind player understand and play the same visual position by conversation.

## License

[MIT](LICENSE) © 2026 Robert Huynh.
