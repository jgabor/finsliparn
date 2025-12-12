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

### Future Enhancements

- [ ] Consensus voting (group by identical outputs, count votes)
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
