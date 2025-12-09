# Finsliparn Roadmap

This document outlines the development phases for Finsliparn, from the initial Proof of Concept (PoC) to the full Multi-Expert MVP.

See [docs/spec-cc.md](docs/spec-cc.md) for detailed technical specifications.

---

## Milestone: Parallel Experts

**Goal**: Move from "Single Expert" to "Parallel Exploration".

### Design Decisions

- Single-expert mode keeps root `.finsliparn/directive.md` (backward compat)
- Parallel directive location: `.finsliparn/sessions/{id}/directives/expert-{N}.md`
- Worktree structure: nested `finsliparn/{sessionId}/expert-{E}/iteration-{N}`
- Expert ID auto-detected from worktree path
- Seed formula: `baseSeed + expertId * maxIterations` (per Poetiq)
- Race termination: all experts run to completion, vote at end

### Implementation

- [ ] **Type Updates** (`src/types/index.ts`)
  - [ ] Add `mode: "single" | "parallel"` to `RefinementSession`
  - [ ] Add `expertCount` and `experts` fields
  - [ ] Add `ExpertState` type
- [ ] **Session Manager** (`src/core/session-manager.ts`)
  - [ ] Add `initializeExperts(count, baseSeed)` method
  - [ ] Add `getExpert(expertId)` / `updateExpert(expertId, state)` methods
  - [ ] Seed formula: `baseSeed + expertId * maxIterations`
- [ ] **Worktree Manager** (`src/core/worktree-manager.ts`)
  - [ ] Add `createExpertWorktree(sessionId, expertId, iteration)`
  - [ ] Add `detectExpertFromPath(worktreePath)` → `{ expertId, iteration }`
  - [ ] Update `listSessionWorktreePaths()` for 4-level nesting
- [ ] **Directive Writer** (`src/core/directive-writer.ts`)
  - [ ] Add `writeForExpert(context, expertId)` method
  - [ ] Path logic: parallel → `sessions/{id}/directives/expert-{N}.md`
  - [ ] Add `writeRaceSummary(session)` for `race.md`
- [ ] **Tool Updates** (`src/mcp/tools.ts`)
  - [ ] `finslipa_start`: add `expertCount` parameter, create N worktrees/directives
  - [ ] `finslipa_check`: auto-detect expert ID from cwd, scope to expert
  - [ ] `finslipa_vote`: collect best from each expert, apply voting
- [x] **Voting System**
  - [x] Implement `finslipa_vote` logic
  - [x] Strategies: `highest_score`, `minimal_diff`, `balanced`
  - [ ] Consensus voting (group by identical outputs, count votes)
  - [ ] Diversity-first ordering
- [ ] **Dashboard**
  - [ ] Simple local web UI to visualize the race between experts

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
