# Finsliparn Roadmap

See [docs/spec-cc.md](docs/spec-cc.md) for detailed technical specifications.

---

## Milestone: Test Coverage for Distribution (P0)

**Goal**: Critical tests required before npm publish.

### MCP Tool Tests

- [ ] **finslipaStart** (`src/mcp/tools.test.ts`)
  - [ ] creates session with correct defaults
  - [ ] respects maxIterations parameter
  - [ ] respects mergeThreshold parameter
  - [ ] detects and offers resume for active session
  - [ ] forceNew creates new session despite active one
  - [ ] parallel mode creates N expert worktrees
  - [ ] returns correct working directories

- [ ] **finslipaCheck** (`src/mcp/tools.test.ts`)
  - [ ] runs tests and returns score
  - [ ] updates session with iteration result
  - [ ] creates next iteration worktree based on previous
  - [ ] worktreePath parameter overrides cwd detection
  - [ ] worktreePath detects expert ID correctly
  - [ ] handles test timeout gracefully
  - [ ] handles no test runner gracefully

- [ ] **finslipaMerge** (`src/mcp/tools.test.ts`)
  - [ ] merges winning iteration to main
  - [ ] respects mergeThreshold (blocks if below)
  - [ ] cleans up worktrees after merge
  - [ ] handles unstaged changes gracefully
  - [ ] parallel mode merges selected expert

---

## Milestone: Test Coverage (P1)

**Goal**: High-priority tests for robustness.

### Cleanup Tool Tests

- [ ] **finslipaCancel** (`src/mcp/tools.test.ts`)
  - [ ] cleans up session worktrees
  - [ ] sets session status to cancelled
  - [ ] handles already-cancelled session

- [ ] **finslipaClean** (`src/mcp/tools.test.ts`)
  - [ ] removes completed session directories
  - [ ] removes cancelled session directories
  - [ ] selective cleanup by status

### Core Component Tests

- [ ] **WorktreeManager** (`src/core/index.test.ts`)
  - [ ] creates worktree from branch
  - [ ] creates expert worktree with correct nesting
  - [ ] lists session worktrees
  - [ ] cleanup removes all session worktrees

### Error Handling

- [ ] SESSION_NOT_FOUND returns helpful error
- [ ] GIT_ERROR during merge returns conflict info
- [ ] TEST_TIMEOUT returns partial results

---

## Milestone: Test Coverage (P2)

**Goal**: Nice-to-have tests for edge cases.

### Integration Tests

- [ ] single expert: start → check → vote → merge
- [ ] parallel experts: start → spawn → check each → vote → merge

### Test Runner Detection

- [ ] detects bun test
- [ ] detects vitest
- [ ] detects jest
- [ ] falls back to configured command

### Edge Cases

- [ ] empty iteration (no code changes)
- [ ] all tests failing
- [ ] merge conflict resolution

---

## Milestone: Packaging & Distribution

**Goal**: Publish to npm and Claude Code plugin registry.

- [ ] **NPM Package**
  - [ ] Package.json configuration
  - [ ] CLI entry point (`bunx finsliparn-mcp`)
  - [ ] README with usage examples
- [ ] **Claude Plugin**
  - [ ] Plugin manifest
  - [ ] Slash commands
  - [ ] PostToolUse hook

---

## Milestone: Parent Orchestration Improvements

**Goal**: Polish parallel experts workflow for Claude Code.

- [ ] **Completion detection**
  - [ ] Subagents write `.finsliparn-done` marker on completion
  - [ ] Parent polls for markers or uses Task completion status
- [ ] **Documentation**
  - [ ] Update parallel experts documentation with orchestration pattern
  - [ ] Add example prompts for spawning subagents

---

## Future: Dashboard UI

- [ ] Local web UI to visualize race between experts
- [ ] Real-time score updates
- [ ] Diff viewer per iteration

---

## Future: Copilot CLI Support (v2.0.0)

**Goal**: Enable the same workflow for GitHub Copilot CLI users.

- [ ] **Agent Definition**
  - [ ] Create `.github/agents/finsliparn.agent.md`
  - [ ] Define the "Polling Loop" prompt instructions
- [ ] **Platform Adapter**
  - [ ] Ensure `finslipa_check` is idempotent (safe for both Hook and Agent usage)
  - [ ] Verify `directive.md` provides sufficient context for a "blind" agent

---

## Completed

- Fix 1: Imperative language in nextSteps and directive
- Fix 2: Base new iterations on previous iteration's branch
- Fix 3: Prevent counting iterations without actual changes

- Type updates (mode, expertCount, ExpertState)
- Worktree manager (createExpertWorktree, detectExpertFromPath)
- Session manager (initializeExperts, seed formula)
- Directive writer (expert-specific files, race.md)
- Tool updates (expertCount parameter, cross-expert voting)

- 3 experts implemented consensus voting
- Expert 0 selected and merged (`e2f3441`)
- `selectConsensusWinner` helper extracted

- `worktreePath` parameter added to `finslipa_check`
- Auto-detect expertId from provided path
- Validated end-to-end flow

- 3 experts with parent orchestration
- All achieved score 94 (100% tests, -6 complexity)
- Expert 0 selected (280 changes)
- `buildDiversityFirstRanking()` integrated (`f653cf6`)
