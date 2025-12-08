---
description: Clean up completed or cancelled refinement sessions
argument-hint: [session-id|--completed|--cancelled]
---

# Finslipa clean

Delete session directories and associated git worktrees for completed, cancelled, or failed sessions.

## Your task

1. Parse the provided argument(s):
   - If a session ID is provided ($1), call `finslipa_clean` with `sessionId: $1`
   - If `--completed` flag is provided, call `finslipa_clean` with `status: "completed"`
   - If `--cancelled` flag is provided, call `finslipa_clean` with `status: "cancelled"`
   - If no arguments provided, call `finslipa_clean` with no parameters (cleans all finished sessions)

2. Report the cleanup results including:
   - Number of sessions cleaned
   - Number of worktrees deleted
   - Any errors encountered
