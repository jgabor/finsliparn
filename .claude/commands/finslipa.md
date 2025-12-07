---
description: Start or manage a refinement session
argument-hint: <task description>
---

# Finslipa - iterative refinement session

Start a new refinement session for the given task. This creates an isolated worktree and sets up the directive system that guides iterative improvement.

## Your task

1. Call the `finslipa_start` MCP tool with the task description: $ARGUMENTS
2. Read the generated directive file at `.finsliparn/directive.md`
3. Begin implementing the solution based on the directive
4. After each significant change, the PostToolUse hook will automatically run tests and update feedback
5. Continue refining until all tests pass or max iterations reached
