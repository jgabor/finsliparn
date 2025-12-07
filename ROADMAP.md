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
  - [x] `finslipa_vote`: Select best iteration (Stub for Phase 1)
  - [x] `finslipa_merge`: Merge winning worktree to main
  - [x] `finslipa_status`: Read current state
- [x] **Response Formatting**
  - [x] Standardize `ToolResponse` with `nextSteps` guidance

## Phase 3: Claude Code Integration (v1.0.0)

**Goal**: A seamless "zero-friction" experience for Claude Code users.

- [x] **Plugin Manifest**
  - [x] Define `plugin.json` with commands and hooks
- [x] **Command Handlers**
  - [x] `/finslipa`: Interactive session starter
  - [x] `/finslipa:status`: Quick status check
- [x] **Hooks**
  - [x] `PostToolUse`: The "Magic" trigger. Detects edits and injects feedback with session context.

## Phase 4: Intelligence & Scoring

**Goal**: Make the feedback loop smarter and safer.

- [ ] **Scoring Engine**
  - [ ] Calculate pass rate %
  - [ ] Implement `DiffAnalyzer` to detect complexity spikes
- [ ] **Feedback Templates**
  - [ ] "Failing Tests" section with specific error messages
  - [ ] "History" section to prevent repeating mistakes
- [ ] **Safety Checks**
  - [ ] Prevent infinite loops (max iterations)
  - [ ] Prevent destructive merges

## Phase 5: Copilot CLI Support (v2.0.0)

**Goal**: Enable the same workflow for GitHub Copilot CLI users.

- [ ] **Agent Definition**
  - [ ] Create `.github/agents/finsliparn.agent.md`
  - [ ] Define the "Polling Loop" prompt instructions
- [ ] **Platform Adapter**
  - [ ] Ensure `finslipa_check` is idempotent (safe for both Hook and Agent usage)
  - [ ] Verify `directive.md` provides sufficient context for a "blind" agent

## Phase 6: Advanced Features (MVP)

**Goal**: Move from "Single Expert" to "Parallel Exploration".

- [ ] **Parallel Execution**
  - [ ] Manage multiple worktrees simultaneously
- [ ] **Voting System**
  - [ ] Implement `finslipa_vote` logic
  - [ ] Strategies: `highest_score`, `minimal_diff`, `balanced`
- [ ] **Dashboard**
  - [ ] Simple local web UI to visualize the race between experts
