---
description: Run tests and check refinement progress
argument-hint: [session-id]
---

# Finslipa check

Manually trigger a test run and scoring iteration for the current refinement session.

## Your task

1. If a session ID is provided ($1), use that ID
2. If no session ID provided, look for an active session in `.finsliparn/sessions/`
3. Call `finslipa_check` with the session ID
4. Report the results:
   - Tests passed/failed/total
   - Current score
   - Complexity assessment
   - Remaining iterations
5. Read the updated directive at `.finsliparn/directive.md` for next steps
