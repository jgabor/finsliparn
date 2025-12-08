/**
 * Finsliparn Type Definitions
 * Core types used throughout the system
 */

// Session Management Types
export type RefinementSession = {
  id: string; // UUID v4
  taskDescription: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  maxIterations: number;
  currentIteration: number;
  iterations: IterationResult[];
  selectedIteration?: number; // Winner (after voting)
  mergeThreshold?: number; // Score threshold for merge (undefined = disabled)
  bestIteration?: number; // Tracks best score seen across all iterations
  bestScore?: number; // Best score value
};

export type SessionStatus =
  | "initializing"
  | "iterating"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

export type SessionConfig = {
  maxIterations: number; // Default: 5
  timeout: number; // Default: 300000 (5 min)
  parallelExperts: boolean; // Default: false (PoC)
  mergeThreshold?: number; // Score threshold for merge (0-100, null/undefined = disabled)
  maxSolutions: number; // Max prior solutions to include in feedback (Default: 5)
  improvingOrder: boolean; // Show solutions worst→best (Default: true)
  returnBestResult: boolean; // Track and return best iteration (Default: true)
  selectionProbability: number; // Probability of including each prior solution (Default: 1.0)
  shuffleExamples: boolean; // Randomize feedback order per iteration (Default: false)
  seed?: number; // Seed for deterministic randomness (Default: undefined = random)
};

// Solution Memory
export type SolutionMemory = {
  code: string; // Snapshot of changed code
  feedback: string; // Generated feedback
  score: number; // Score at time of snapshot
};

// Iteration Results
export type IterationResult = {
  iteration: number;
  status: "pending" | "running" | "completed" | "failed";
  timestamp: Date;
  testResults?: TestResults;
  score?: number; // 0-100
  diff?: DiffAnalysis;
  commitSha?: string;
  worktreePath?: string;
  feedback?: string; // Markdown feedback
  solution?: SolutionMemory; // Stored solution for context
};

// Test Execution Types
export type TestResults = {
  framework: string; // 'bun', 'vitest', 'jest', 'pytest', etc.
  passed: number;
  failed: number;
  total: number;
  duration: number; // ms
  failures: TestFailure[];
  stdout?: string;
  stderr?: string;
  softScore?: number; // 0.0-1.0 partial credit based on assertion proximity
};

export type TestFailure = {
  name: string;
  file: string;
  line?: number;
  expected?: string;
  actual?: string;
  message: string;
  stack?: string;
  softScore?: number; // 0.0-1.0 partial credit for this specific failure
};

export type TestRunOptions = {
  timeout: number;
  cwd: string;
  env?: Record<string, string>;
  testFiles?: string[];
};

// Diff Analysis Types
export type DiffAnalysis = {
  filesChanged: string[];
  insertions: number;
  deletions: number;
  complexity: "low" | "medium" | "high";
  complexityScore: number; // Heuristic for risk
};

// Quality Analysis Types
export type QualityAnalysis = {
  signals: QualitySignal[];
  score: number; // 0-100, higher is better
};

export type QualitySignal = {
  type:
    | "large_function"
    | "deep_nesting"
    | "long_line"
    | "console_log"
    | "todo_comment"
    | "any_type"
    | "magic_number";
  severity: "error" | "warning" | "info";
  message: string;
  file: string;
  line?: number;
  suggestion: string;
};

// Scoring Types
export type ScoreWeights = {
  testPass: number; // Weight for passing tests
  complexityPenalty: number; // Penalty for excessive changes
};

// Directive Types
export type DirectiveContext = {
  session: RefinementSession;
  latestIteration: IterationResult;
  nextActions: string[];
  constraints?: string;
  history?: IterationSummary[];
  specHints?: string[]; // Paths to spec/reference files for context
  qualityAnalysis?: QualityAnalysis; // Code quality signals and suggestions
  priorSolutions?: SolutionMemory[]; // Prior solutions for context
};

export type IterationSummary = {
  iteration: number;
  score: number;
  summary: string;
};

// Test Runner
export type TestRunner = {
  name: string;
  detect(cwd: string): Promise<boolean>;
  run(options: TestRunOptions): Promise<TestResults>;
  parseOutput(stdout: string, stderr: string): TestResults;
};

// MCP Tool Response
export type ToolResponse = {
  success: boolean;
  message: string;
  data?: unknown;
  nextSteps?: string[];
  error?: {
    code: string;
    details: string;
  };
};
