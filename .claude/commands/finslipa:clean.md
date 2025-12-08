---
description: Clean up completed or cancelled refinement sessions
argument-hint: [session-id|--completed|--cancelled]
---

# Finslipa clean

Delete session directories that have been completed, cancelled, or failed.

## Your task

1. Parse the provided argument(s):
   - If a session ID is provided ($1), call `finslipa_clean` with `sessionId: $1`
   - If `--completed` flag is provided, call `finslipa_clean` with `status: "completed"`
   - If `--cancelled` flag is provided, call `finslipa_clean` with `status: "cancelled"`
   - If no arguments provided, call `finslipa_clean` with no parameters (cleans all finished sessions)

2. Report the cleanup results including:
   - Number of sessions cleaned
   - Any errors encountered
   - Confirmation of directories deleted
