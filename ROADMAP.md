# Finsliparn Roadmap

This document outlines the development phases for Finsliparn, from the initial Proof of Concept (PoC) to the full Multi-Expert MVP.

See [docs/spec-cc.md](docs/spec-cc.md) for detailed technical specifications.

---

## Phase 1: Foundation (Core Engine)

**Goal**: Establish the core logic that powers the refinement loop, independent of any specific LLM platform.

- [x] **Project Setup**
  - [x] Initialize Bun project with TypeScript
  - [x] Configure linting (biome/ultracite)
  - [x] Configure testing (Bun Test)
- [x] **Session Management**
  - [x] `SessionManager`: Create, load, and persist session state (`state.json`)
  - [x] `WorktreeManager`: Create and manage isolated git worktrees
- [x] **The Control Plane**
  - [x] `DirectiveWriter`: Generate the `directive.md` file (the "brain" of the operation)
  - [x] `FeedbackGenerator`: Transform raw test results into actionable markdown
- [x] **Test Runner Abstraction**
  - [x] Implement `BunTestRunner` (v1 priority)
  - [x] Define interface for future runners (Vitest, Jest)

## Phase 2: The MCP Server (API Layer)

**Goal**: Expose the core engine via the Model Context Protocol (MCP).

- [x] **MCP Server Implementation**
  - [x] Setup `@modelcontextprotocol/sdk`
- [x] **Tool Implementation**
  - [x] `finslipa_start`: Initialize session & directive
  - [x] `finslipa_check`: Run tests, score result, update directive (The "Heartbeat")
  - [x] `finslipa_vote`: Select best iteration with strategies (`highest_score`, `minimal_diff`, `balanced`)
  - [x] `finslipa_merge`: Merge winning worktree to main (with git merge support)
  - [x] `finslipa_status`: Read current state
  - [x] Wire up `WorktreeManager` in `finslipa_check` (optional via `useWorktree` flag)
- [x] **Response Formatting**
  - [x] Standardize `ToolResponse` with `nextSteps` guidance

## Phase 3: Claude Code Integration (v1.0.0)

**Goal**: A seamless "zero-friction" experience for Claude Code users.

- [x] **Plugin Manifest**
  - [x] Define `plugin.json` with commands and hooks
- [x] **Command Handlers**
  - [x] `/finslipa`: Interactive session starter
  - [x] `/finslipa:status`: Quick status check
  - [x] `/finslipa:check`: Manual iteration trigger
  - [x] `/finslipa:complete`: Session completion (vote + merge)
- [x] **Hooks**
  - [x] `PostToolUse`: The "Magic" trigger. Detects edits and injects feedback with session context.

## Phase 4: Intelligence & Scoring

**Goal**: Make the feedback loop smarter and safer.

- [x] **Scoring Engine**
  - [x] Calculate pass rate %
  - [x] Implement `DiffAnalyzer` to detect complexity spikes
  - [ ] Soft scoring (partial credit for almost-correct tests) → moved to Phase 5.5
- [x] **Feedback Templates**
  - [x] "Failing Tests" section with specific error messages
  - [x] "History" section to prevent repeating mistakes
- [x] **Safety Checks**
  - [x] Prevent infinite loops (max iterations)
  - [x] Prevent destructive merges

## Phase 5: Robustness & Quality Feedback

**Goal**: Make the refinement loop robust and provide quality feedback even when tests pass.

- [x] **Test Parser Fixes**
  - [x] Fix SUMMARY_PATTERN regex to handle Bun's output format
  - [x] Add fallback parsing when summary regex fails
  - [x] Parse test duration from output
- [x] **Session State Fixes**
  - [x] Fix stale session passed to DirectiveWriter
  - [x] Fix premature completion when total=0
- [x] **Quality Analyzer**
  - [x] Analyze diff for code quality signals
  - [x] Generate actionable suggestions when tests pass
  - [x] Track large functions, review hotspots, code smells
- [x] **DiffAnalyzer Resilience**
  - [x] Handle git diff failures gracefully
  - [x] Try alternative strategies (staged, working directory)
- [x] **Enhanced Directive Format**
  - [x] Include diff summary in feedback
  - [x] Add quality signals section
  - [x] Show iteration comparison

## Phase 5.5: Poetiq Parity & Quality Improvements

**Goal**: Implement proven patterns from Poetiq's ARC-AGI solver to improve LLM refinement quality.

- [x] **Solution Memory**
  - [x] Store code+feedback+score for each iteration
  - [x] Include prior solutions in feedback context
  - [x] Configurable `max_solutions` limit
- [x] **Soft Scoring**
  - [x] Partial credit (0.0-1.0) for test assertions
  - [x] Use soft scores for ranking failed solutions
- [x] **Best Result Tracking**
  - [x] Track best iteration across session
  - [x] `return_best_result` config option
- [x] **Feedback Improvements**
  - [x] Improving order (worst→best) in history
  - [x] Structured XML feedback format
  - [x] Visual inline diff (expected/actual)
- [x] **Configuration**
  - [x] `selection_probability` for prior solution sampling
  - [x] `shuffle_examples` for feedback randomization
  - [x] `seed` for deterministic randomness
- [x] **Structured Debug Logging**
  - [x] Create `Logger` utility with levels (DEBUG, INFO, WARN, ERROR)
  - [x] Add log points: session transitions, test runs, git operations
  - [x] `FINSLIPARN_DEBUG=1` environment variable to enable
- [x] **Error Handling Hardening**
  - [x] Fix silent worktree fallback (throw instead of warn)
  - [x] Add session file locking to prevent race conditions
  - [x] Preserve error context in catch blocks
  - [x] Validate `testResults.total > 0` before scoring
- [x] **Voting Strategy Fix**
  - [x] Filter to passing iterations before `minimal_diff` selection
  - [x] Add test coverage for edge case
- [x] **DiffAnalyzer File Filtering**
  - [x] Add `shouldIgnoreFile()` with static ignore patterns (lock files, `.finsliparn/`)
  - [x] Filter in `parseNumstat()` before metrics calculation
- [x] **Solution Memory Integration**
  - [x] Accumulate `SolutionMemory[]` during iteration loop
  - [x] Pass to FeedbackGenerator as `priorSolutions`
- [x] **Code Quality**
  - [x] Decompose `finslipaCheck()` into phases
  - [x] Remove `buildNextActions`/`buildNextSteps` duplication
- [ ] **Missing Tools**
  - [ ] Implement `finslipa_cancel` tool

## Phase 6: Advanced Features (MVP)

**Goal**: Move from "Single Expert" to "Parallel Exploration".

- [ ] **Parallel Execution**
  - [ ] Manage multiple worktrees simultaneously
  - [ ] Seed diversity per expert (`seed += it * max_iterations`)
- [x] **Voting System**
  - [x] Implement `finslipa_vote` logic
  - [x] Strategies: `highest_score`, `minimal_diff`, `balanced`
  - [ ] Consensus voting (group by identical outputs, count votes)
  - [ ] Diversity-first ordering
- [ ] **Dashboard**
  - [ ] Simple local web UI to visualize the race between experts

## Phase 7: Packaging & Distribution

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
