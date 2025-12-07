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
};

export type TestFailure = {
  name: string;
  file: string;
  line?: number;
  expected?: string;
  actual?: string;
  message: string;
  stack?: string;
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
