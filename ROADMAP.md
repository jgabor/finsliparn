# Finsliparn Roadmap

This document outlines the development phases for Finsliparn, from the initial Proof of Concept (PoC) to the full Multi-Expert MVP.

See [docs/spec-cc.md](docs/spec-cc.md) for detailed technical specifications.

---

## Milestone: Iteration Loop Fixes

**Goal**: Fix LLM halting behavior and prevent premature merge completion.

### Bug Fixes

- [x] **Fix 1: Imperative language in nextSteps and directive** (`src/mcp/tools.ts`, `src/core/directive-writer.ts`)
  - [x] Change passive "continue refining, then call finslipa_check" to imperative "REQUIRED: Make changes NOW, call finslipa_check immediately"
  - [x] Add auto-continue section to directive.md when not merge-eligible
- [x] **Fix 2: Base new iterations on previous iteration's branch** (`src/mcp/tools.ts`)
  - [x] Pass previous iteration's branch as baseBranch to createWorktree
  - [x] Ensures code changes carry forward between iterations
- [x] **Fix 3: Prevent counting iterations without actual changes** (`src/mcp/tools.ts`)
  - [x] Validate `diffAnalysis.filesChanged > 0` before counting iteration
  - [x] Return error if no changes detected since last iteration

---

## Milestone: Parallel Experts

**Goal**: Move from "Single Expert" to "Parallel Exploration".

### Design Decisions

- Single-expert mode keeps root `.finsliparn/directive.md` (backward compat)
- Parallel directive location: `.finsliparn/sessions/{id}/directives/expert-{N}.md`
- Worktree structure: nested `finsliparn/{sessionId}/expert-{E}/iteration-{N}`
- Expert ID auto-detected from worktree path
- Seed formula: `baseSeed + expertId * maxIterations`
- Race termination: all experts run to completion, vote at end
- Expert count fixed at session start (no hot-joining)
- MVP voting: `highest_score` only (cross-expert comparison)
- Orchestration: Claude Code Task tool spawns parallel agents (not in Finsliparn codebase)
- Iterations always increment regardless of code changes (preserves seed predictability)
- Default `maxIterations`: 10 (more exploration opportunities)
- Default `shuffleExamples`: true (increases diversity between experts)

### Implementation Order

1. Types → 2. Worktree Manager → 3. Session Manager → 4. Directive Writer → 5. Tools

### Implementation

- [x] **Phase 1: Type Updates** (`src/types/index.ts`)
  - [x] Add `mode: "single" | "parallel"` to `RefinementSession`
  - [x] Add `expertCount`, `experts`, `selectedExpertId`, `baseSeed` fields
  - [x] Add `ExpertState` type with `id`, `seed`, `currentIteration`, `iterations[]`, `bestIteration`, `bestScore`, `status`
  - [x] Add `expertId?: number` to `IterationResult`
- [x] **Phase 2: Worktree Manager** (`src/core/worktree-manager.ts`)
  - [x] Add `createExpertWorktree(sessionId, expertId, iteration, baseBranch)`
  - [x] Add `detectExpertFromPath(worktreePath)` → `{ expertId, iteration } | null`
  - [x] Update `listSessionWorktreePaths()` for 4-level nesting
- [x] **Phase 3: Session Manager** (`src/core/session-manager.ts`)
  - [x] Add `initializeExperts(sessionId, count, baseSeed)` method
  - [x] Add `getExpert(sessionId, expertId)` / `updateExpert(sessionId, expertId, state)` methods
  - [x] Add `addIterationToExpert(sessionId, expertId, iteration)` method
  - [x] Seed formula: `baseSeed + expertId * maxIterations`
  - [x] Lock scope: per-expert in parallel mode (`{sessionId}:expert-{E}`)
- [x] **Phase 4: Directive Writer** (`src/core/directive-writer.ts`)
  - [x] Add `writeForExpert(context, expertId)` method
  - [x] Path logic: parallel → `sessions/{id}/directives/expert-{N}.md`
  - [x] Add `writeRaceSummary(session)` for `race.md`
  - [x] Update `write()` to delegate based on `session.mode`
- [x] **Phase 5: Tool Updates** (`src/mcp/tools.ts`)
  - [x] `finslipa_start`: add `expertCount` parameter (default: 1), create N worktrees/directives, return array of working directories
  - [x] `finslipa_check`: auto-detect expert ID from cwd, scope to expert's iteration counter and state
  - [x] `finslipa_vote`: collect best from each expert, apply `highest_score` cross-expert, set `selectedExpertId`, generate `race.md`
  - [x] `finslipa_merge`: use `selectedExpertId` to find correct branch, cleanup all expert worktrees

### Voting System

- [x] Single-expert voting: `highest_score`, `minimal_diff`, `balanced`
- [x] Cross-expert voting: `highest_score` (MVP)

---

## Milestone: Dogfooding (Consensus Voting via Parallel Experts)

**Goal**: Validate parallel experts by using Finsliparn to implement consensus voting in itself.

### Why This Task

- Real feature from roadmap (not artificial test)
- Multiple valid algorithms (hash-based, deep equality, normalized comparison)
- Clear TDD criteria (4 failing tests → all pass)
- Isolated change (won't break running MCP server)

### Safety Analysis

When Finsliparn modifies its own code:

- MCP server continues with OLD code during session
- `bun test` spawns subprocess with MODIFIED code
- Tests validate new code independently
- After merge, server restarts with improvements

### Dogfooding Steps

- [x] **Phase 1: Write failing tests** (`src/mcp/tools.test.ts`)
  - [x] `groups identical outputs together`
  - [x] `counts votes per output group`
  - [x] `ranks groups by vote count descending`
  - [x] `uses score as tiebreaker within same vote count`
- [x] **Phase 2: Run parallel session**
  - [x] `finslipa_start` with expertCount: 3, maxIterations: 5
  - [x] Each expert implements `consensus` strategy differently
- [x] **Phase 3: Vote and merge**
  - [x] Manual selection (Task agents lack MCP access for `finslipa_check`)
  - [x] Expert 0's implementation integrated
- [x] **Phase 4: Validation**
  - [x] All 4 consensus tests pass
  - [x] All existing tests still pass (38 total)
  - [x] Feature works in production

### Results

- 3 experts spawned via Task tool, each working in isolated worktree
- Each expert had unique seed (90487, 90490, 90493)
- All 3 experts passed all 38 tests independently
- Expert 0's implementation selected and merged (`e2f3441`)
- `selectConsensusWinner` helper extracted for cognitive complexity

### Learnings

- Task agents cannot call MCP tools (finslipa_check) - need different orchestration
- Manual verification and merge still validates the parallel approach
- Seed diversity worked (unique seeds per expert confirmed in directives)

---

## Milestone: Parent Orchestration for Claude Code

**Goal**: Enable proper iteration tracking when using Claude Code's Task subagents for parallel experts.

### Problem

Task subagents lack MCP access - they cannot call `finslipa_check` to register iterations. This is Claude Code-specific; Copilot CLI agents have direct MCP access.

### Solution: Parent Orchestration

Parent session calls `finslipa_check` on behalf of each expert after they complete.

```
Parent:
  1. finslipa_start(expertCount: N) → worktree paths
  2. Spawn N Task agents (each implements + runs `bun test`)
  3. Wait for agents to complete
  4. For each expert:
       finslipa_check(sessionId, worktreePath: expert's path)
  5. finslipa_vote(sessionId)
  6. finslipa_merge(sessionId)
```

### Orchestration Implementation

- [x] **Phase 1: Add `worktreePath` parameter to `finslipa_check`**
  - [x] Accept optional `worktreePath` parameter (overrides cwd detection)
  - [x] Auto-detect expertId from provided path via `detectExpertFromPath()`
  - [x] Validated: parent orchestration flow works end-to-end
- [ ] **Phase 2: Completion detection**
  - [ ] Subagents write `.finsliparn-done` marker on completion
  - [ ] Parent polls for markers or uses Task completion status
- [ ] **Phase 3: Documentation**
  - [ ] Update parallel experts documentation with orchestration pattern
  - [ ] Add example prompts for spawning subagents

### Orchestration Design Decisions

- Parent orchestration is Claude Code-specific (Copilot uses direct MCP)
- `worktreePath` parameter enables external callers (parent, CI/CD)
- No HTTP endpoint needed (keeps architecture simple)
- Copilot support unaffected (agents call MCP directly)

---

## Milestone: Dogfooding Round 2 (Parent Orchestration)

**Goal**: Re-run consensus voting dogfooding with proper parent orchestration.

### Prerequisites

- [x] Phase 1 of Parent Orchestration (`worktreePath` parameter)

### Task Selection

Need a real feature to implement. Candidates:

- Diversity-first ordering in voting
- Soft score improvements
- Dashboard skeleton

### Round 2 Steps

- [ ] **Phase 1: Run parallel session with orchestration**
  - [ ] Select task and write failing tests
  - [ ] `finslipa_start` with expertCount: 3
  - [ ] Spawn 3 Task agents
  - [ ] Wait for all agents to complete
  - [ ] Parent calls `finslipa_check(sessionId, worktreePath)` for each expert
- [ ] **Phase 2: Vote and merge**
  - [ ] `finslipa_vote` selects winner (race.md generated)
  - [ ] `finslipa_merge` integrates winning implementation
- [ ] **Phase 3: Validation**
  - [ ] race.md contains all 3 experts with scores
  - [ ] Session state shows proper iteration counts per expert
  - [ ] All tests pass after merge

### Success Criteria

- race.md generated with scoreboard (not manual selection)
- Each expert has recorded iterations in session state
- Full automated flow from start to merge

---

### Future Enhancements

- [ ] Diversity-first ordering
- [ ] Dashboard: local web UI to visualize race between experts

## Milestone: Packaging & Distribution

- **NPM Package**
- **Claude Plugin**

## Future: Copilot CLI Support (v2.0.0)

**Goal**: Enable the same workflow for GitHub Copilot CLI users.

- [ ] **Agent Definition**
  - [ ] Create `.github/agents/finsliparn.agent.md`
  - [ ] Define the "Polling Loop" prompt instructions
- [ ] **Platform Adapter**
  - [ ] Ensure `finslipa_check` is idempotent (safe for both Hook and Agent usage)
  - [ ] Verify `directive.md` provides sufficient context for a "blind" agent
