# Finsliparn Roadmap

This document outlines the development phases for Finsliparn, from the initial Proof of Concept (PoC) to the full Multi-Expert MVP.

---

## Phase 1: Foundation (Core Engine)

**Goal**: Establish the core logic that powers the refinement loop, independent of any specific LLM platform.

- [x] **Project Setup**
  - [x] Initialize Bun project with TypeScript
  - [x] Configure linting (biome/ultracite)
  - [ ] Configure testing (Bun Test)
- [ ] **Session Management**
  - [ ] `SessionManager`: Create, load, and persist session state (`state.json`)
  - [ ] `WorktreeManager`: Create and manage isolated git worktrees
- [ ] **The Control Plane**
  - [ ] `DirectiveWriter`: Generate the `directive.md` file (the "brain" of the operation)
  - [ ] `FeedbackGenerator`: Transform raw test results into actionable markdown
- [ ] **Test Runner Abstraction**
  - [ ] Implement `BunTestRunner` (v1 priority)
  - [ ] Define interface for future runners (Vitest, Jest)

## Phase 2: The MCP Server (API Layer)

**Goal**: Expose the core engine via the Model Context Protocol (MCP).

- [ ] **MCP Server Implementation**
  - [ ] Setup `@modelcontextprotocol/sdk`
- [ ] **Tool Implementation**
  - [ ] `finslipa_start`: Initialize session & directive
  - [ ] `finslipa_check`: Run tests, score result, update directive (The "Heartbeat")
  - [ ] `finslipa_vote`: Select best iteration (Stub for Phase 1)
  - [ ] `finslipa_merge`: Merge winning worktree to main
  - [ ] `finslipa_status`: Read current state
- [ ] **Response Formatting**
  - [ ] Standardize `ToolResponse` with `nextSteps` guidance

## Phase 3: Claude Code Integration (v1.0.0)

**Goal**: A seamless "zero-friction" experience for Claude Code users.

- [ ] **Plugin Manifest**
  - [ ] Define `manifest.json` with commands and hooks
- [ ] **Command Handlers**
  - [ ] `/finslipa`: Interactive session starter
  - [ ] `/finslipa:status`: Quick status check
- [ ] **Hooks**
  - [ ] `PostToolUse`: The "Magic" trigger. Detects edits, runs `finslipa_check` automatically, and injects feedback.

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
