# Agent Context Monitor

PawPal uses the agent bubble's existing top-right status circle as a context ring.

## Implemented UI

- The top-right circle becomes a 24px ring with a center number, for example `48`.
- The number means percent of context used. The `%` sign is omitted to keep the ring legible.
- The ring is empty in the center: no pie fill.
- The bubble's native `box-shadow` color shows chat status.
- The ring color shows context state.

## Data Source

For Codex sessions, PawPal reads the latest `token_count` event from the local Codex session JSONL:

- `last_token_usage.input_tokens`
- `model_context_window`

Used percent is:

```text
last_token_usage.input_tokens / model_context_window
```

If token data is missing, PawPal falls back to the old status dot/check behavior.

For Claude Code sessions, PawPal reads the latest usage block from the local Claude session JSONL and estimates used context from input, cache-read, and cache-creation tokens. Claude logs do not persist the active context-window flag, so PawPal maps known model ids to their expected window and falls back conservatively when unknown.

## Context Colors

| State | Used context |
| --- | ---: |
| Green | `< 40%` |
| Yellow | `40-64%` |
| Orange | `65-79%` |
| Red | `>= 80%` |

Critical reserve also maps to red when remaining context is below `max(25k tokens, 8% of window)`.

## Status Shadow

Chat state stays separate from context:

- Working: blue native shadow
- Reviewing/thinking: purple native shadow
- Waiting: amber native shadow
- Error/blocked: red native shadow
- Ready/complete: neutral/default shadow

## Rationale

Context percent alone is incomplete because OpenAI context includes input, output, and hidden reasoning tokens. Reasoning/output need reserved space; OpenAI recommends starting with at least 25k tokens reserved for reasoning and outputs, then adjusting after observing usage. Yellow means prepare/checkpoint, orange means suggest compact, and red means compact or start a new chat soon.

Sources:

- OpenAI Conversation state: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI Reasoning models: https://developers.openai.com/api/docs/guides/reasoning
- OpenAI Compaction: https://developers.openai.com/api/docs/guides/compaction
