---
description: Show current refinement session status
argument-hint: [session-id]
---

# Finslipa status

Check the current state of a refinement session.

## Your task

1. If a session ID is provided ($1), call `finslipa_status` with that ID
2. If no session ID provided, look for an active session in `.finsliparn/sessions/`
3. Report the session status including:
   - Current iteration number
   - Test results (passed/failed/total)
   - Current score
   - Next recommended actions from the directive
