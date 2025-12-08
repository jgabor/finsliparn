---
description: Complete a refinement session and merge changes
argument-hint: [session-id]
---

# Finslipa complete

Complete the current refinement session and finalize changes.

## Your task

1. If a session ID is provided ($1), use that ID
2. If no session ID provided, look for an active session in `.finsliparn/sessions/`
3. Call `finslipa_vote` with the session ID to select the best iteration
4. Call `finslipa_merge` with the session ID to complete the session
5. Report the final results:
   - Selected iteration
   - Final score
   - Session completion status
