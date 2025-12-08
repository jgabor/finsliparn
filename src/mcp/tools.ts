import { readdirSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { DiffAnalyzer } from "../core/diff-analyzer";
import { DirectiveWriter } from "../core/directive-writer";
import { createLogger } from "../core/logger";
import { QualityAnalyzer } from "../core/quality-analyzer";
import { ScoringEngine } from "../core/scoring-engine";
import { SessionManager } from "../core/session-manager";
import { SoftScorer } from "../core/soft-scorer";
import { detectTestRunner } from "../core/test-runner";
import { WorktreeManager } from "../core/worktree-manager";
import type {
  DiffAnalysis,
  IterationResult,
  IterationSummary,
  QualityAnalysis,
  SolutionMemory,
  TestResults,
  ToolResponse,
} from "../types";

const log = createLogger("MCP");

const SPEC_FILENAMES = [
  "spec",
  "roadmap",
  "architecture",
  "design",
  "specification",
];
const SPEC_DIRECTORIES = [".", "docs"];

type NextStepsContext = {
  testResults: TestResults;
  diffAnalysis?: DiffAnalysis;
  remainingIterations?: number;
  verbose: boolean;
};

function buildNextSteps(context: NextStepsContext): string[] {
  const { testResults, diffAnalysis, remainingIterations, verbose } = context;
  const hasActualTests = testResults.total > 0;
  const allPassing = hasActualTests && testResults.failed === 0;

  if (!hasActualTests) {
    return verbose
      ? [
          "No tests detected - ensure tests exist and run correctly",
          "Call finslipa_check again after adding tests",
        ]
      : ["No tests detected - add tests and run finslipa_check again"];
  }

  if (allPassing) {
    return verbose && diffAnalysis
      ? [
          "All tests passing!",
          `Complexity: ${diffAnalysis.complexity}`,
          "Review the diff for quality improvements, then call finslipa_merge to complete",
        ]
      : ["All tests passing! Call finslipa_merge to complete"];
  }

  return verbose && remainingIterations !== undefined
    ? [
        `${testResults.failed} test(s) failing`,
        "Fix the failing tests and call finslipa_check again",
        `${remainingIterations} iteration(s) remaining`,
      ]
    : ["Fix failing tests and run finslipa_check again"];
}

type CheckContext = {
  sessionId: string;
  iteration: number;
  workingDirectory: string;
  worktreePath?: string;
};

type TestPhaseResult = {
  testResults: TestResults;
  diffAnalysis: DiffAnalysis;
  rawDiff: string | null;
};

type AnalysisPhaseResult = {
  qualityAnalysis?: QualityAnalysis;
  scoreResult: { score: number };
  solution: SolutionMemory;
};

async function setupWorktree(
  worktreeManager: WorktreeManager,
  sessionId: string,
  iteration: number
): Promise<{ workingDirectory: string; worktreePath?: string } | ToolResponse> {
  const branchName = `finsliparn/${sessionId}/iteration-${iteration}`;
  const expectedPath = worktreeManager.getWorktreePath(branchName);

  // Check if worktree already exists (created in finslipaStart for iteration 1)
  try {
    const stat = await Bun.file(join(expectedPath, ".git")).exists();
    if (stat) {
      log.info("Reusing existing worktree for iteration", {
        sessionId,
        iteration,
        worktreePath: expectedPath,
      });
      return { workingDirectory: expectedPath, worktreePath: expectedPath };
    }
  } catch {
    // Worktree doesn't exist, will create below
  }

  try {
    const worktreePath = await worktreeManager.createWorktree(branchName);
    log.info("Worktree created for iteration", {
      sessionId,
      iteration,
      worktreePath,
    });
    return { workingDirectory: worktreePath, worktreePath };
  } catch (error) {
    log.error("Worktree creation failed", {
      sessionId,
      iteration,
      branchName,
      error: String(error),
    });
    return {
      success: false,
      message: `Failed to create worktree: ${error}`,
      error: {
        code: "WORKTREE_CREATION_FAILED",
        details: `Cannot create isolated worktree for iteration. Ensure git working directory is clean. Error: ${error}`,
      },
    };
  }
}

async function runTestPhase(
  context: CheckContext
): Promise<TestPhaseResult | ToolResponse> {
  const testRunner = await detectTestRunner(context.workingDirectory);
  const testResults = await testRunner.run({
    timeout: 30_000,
    cwd: context.workingDirectory,
  });

  const softScorer = new SoftScorer();
  testResults.softScore = softScorer.calculateTestResultsSoftScore(testResults);

  const diffAnalyzer = new DiffAnalyzer();
  const diffAnalysis = await diffAnalyzer.analyze(context.workingDirectory);

  if (testResults.total === 0) {
    log.warn("No tests detected", {
      sessionId: context.sessionId,
      iteration: context.iteration,
    });
    return {
      success: false,
      message: "No tests detected",
      error: {
        code: "NO_TESTS_DETECTED",
        details:
          "Test runner completed but found 0 tests. Ensure test files exist and follow naming conventions (*.test.ts, *.spec.ts).",
      },
    };
  }

  const rawDiff = await diffAnalyzer.getRawDiff(context.workingDirectory);
  return { testResults, diffAnalysis, rawDiff };
}

function runAnalysisPhase(testPhase: TestPhaseResult): AnalysisPhaseResult {
  const { testResults, diffAnalysis, rawDiff } = testPhase;

  let qualityAnalysis: QualityAnalysis | undefined;
  if (testResults.failed === 0 && testResults.total > 0 && rawDiff) {
    const qualityAnalyzer = new QualityAnalyzer();
    qualityAnalysis = qualityAnalyzer.analyze(rawDiff);
  }

  const scoringEngine = new ScoringEngine();
  const scoreResult = scoringEngine.calculateScore(testResults, diffAnalysis);

  const softScoreInfo =
    testResults.softScore !== undefined
      ? ` (soft score: ${(testResults.softScore * 100).toFixed(1)}%)`
      : "";
  const solutionFeedback =
    testResults.failed > 0
      ? `${testResults.failed}/${testResults.total} tests failing${softScoreInfo}`
      : `All ${testResults.total} tests passing`;

  const solution: SolutionMemory = {
    code: rawDiff || "(no changes)",
    feedback: solutionFeedback,
    score: scoreResult.score,
  };

  return { qualityAnalysis, scoreResult, solution };
}

async function persistIterationPhase(
  sessionManager: SessionManager,
  context: CheckContext,
  testPhase: TestPhaseResult,
  analysisPhase: AnalysisPhaseResult
): Promise<void> {
  const { testResults, diffAnalysis } = testPhase;
  const { scoreResult, solution } = analysisPhase;

  await sessionManager.addIteration(context.sessionId, {
    iteration: context.iteration,
    status: "completed",
    timestamp: new Date(),
    testResults,
    score: scoreResult.score,
    diff: diffAnalysis,
    worktreePath: context.worktreePath,
    solution,
  });

  await sessionManager.updateBestResult(
    context.sessionId,
    context.iteration,
    scoreResult.score
  );

  const allTestsPassing = testResults.failed === 0 && testResults.total > 0;
  if (allTestsPassing) {
    await sessionManager.updateSessionStatus(context.sessionId, "completed");
  }
}

async function updateDirectivePhase(
  sessionManager: SessionManager,
  context: CheckContext,
  testPhase: TestPhaseResult,
  analysisPhase: AnalysisPhaseResult
): Promise<void> {
  const { testResults, diffAnalysis } = testPhase;
  const { qualityAnalysis } = analysisPhase;

  const directiveWriter = new DirectiveWriter();
  const updatedSession = await sessionManager.loadSession(context.sessionId);
  const latestIteration = await sessionManager.getLatestIteration(
    context.sessionId
  );

  if (!(latestIteration && updatedSession)) {
    return;
  }

  const history: IterationSummary[] = updatedSession.iterations
    .filter((iter) => iter.testResults && iter.score !== undefined)
    .map((iter) => ({
      iteration: iter.iteration,
      score: iter.score ?? 0,
      summary: iter.testResults
        ? `${iter.testResults.passed}/${iter.testResults.total} tests passing`
        : "No test results",
    }));

  const priorSolutions: SolutionMemory[] = updatedSession.iterations
    .filter((iter) => iter.solution !== undefined)
    .map((iter) => iter.solution as SolutionMemory);

  const remainingIterations = updatedSession.maxIterations - context.iteration;
  const nextActions = buildNextSteps({
    testResults,
    diffAnalysis,
    remainingIterations,
    verbose: true,
  });
  const specHints = detectSpecFiles();

  await directiveWriter.write({
    session: updatedSession,
    latestIteration,
    nextActions,
    history: history.length > 0 ? history : undefined,
    specHints: specHints.length > 0 ? specHints : undefined,
    qualityAnalysis,
    priorSolutions: priorSolutions.length > 0 ? priorSolutions : undefined,
  });
}

function selectMinimalDiffWinner(
  completedIterations: IterationResult[],
  passingIterations: IterationResult[]
): IterationResult {
  const candidates =
    passingIterations.length > 0 ? passingIterations : completedIterations;
  return candidates.reduce((best, current) => {
    const bestDiffSize =
      (best.diff?.insertions ?? 0) + (best.diff?.deletions ?? 0);
    const currentDiffSize =
      (current.diff?.insertions ?? 0) + (current.diff?.deletions ?? 0);
    return currentDiffSize < bestDiffSize ? current : best;
  });
}

function selectBalancedWinner(
  completedIterations: IterationResult[]
): IterationResult {
  const getDiffPenalty = (iter: IterationResult) => {
    const diffSize = (iter.diff?.insertions ?? 0) + (iter.diff?.deletions ?? 0);
    return Math.min(diffSize / 500, 1) * 30;
  };
  return completedIterations.reduce((best, current) => {
    const bestBalanced = (best.score ?? 0) * 0.7 - getDiffPenalty(best);
    const currentBalanced =
      (current.score ?? 0) * 0.7 - getDiffPenalty(current);
    return currentBalanced > bestBalanced ? current : best;
  });
}

function isSpecFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".md")) {
    return false;
  }
  const baseName = lower.slice(0, -3);
  return SPEC_FILENAMES.some(
    (spec) => baseName === spec || baseName.startsWith(`${spec}-`)
  );
}

function detectSpecFiles(cwd: string = process.cwd()): string[] {
  const found: string[] = [];

  for (const dir of SPEC_DIRECTORIES) {
    try {
      const dirPath = dir === "." ? cwd : join(cwd, dir);
      const files = readdirSync(dirPath).filter(isSpecFile);

      for (const file of files) {
        found.push(dir === "." ? file : `${dir}/${file}`);
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return found;
}

export async function finslipaStart(args: {
  taskDescription: string;
  maxIterations?: number;
  forceNew?: boolean;
  mergeThreshold?: number; // Score threshold for merge (undefined = no protection)
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();

  try {
    // Check for existing active session unless forceNew is set
    if (!args.forceNew) {
      const activeSession = await sessionManager.getActiveSession();
      if (activeSession) {
        return {
          success: true,
          message: `Found active session: ${activeSession.id}`,
          data: {
            sessionId: activeSession.id,
            taskDescription: activeSession.taskDescription,
            currentIteration: activeSession.currentIteration,
            maxIterations: activeSession.maxIterations,
            status: activeSession.status,
          },
          nextSteps: [
            `Active session found for: "${activeSession.taskDescription}"`,
            `Current progress: iteration ${activeSession.currentIteration}/${activeSession.maxIterations}`,
            "To resume this session, call finslipa_check with the sessionId above",
            "To start a fresh session instead, call finslipa_start with forceNew: true",
          ],
        };
      }
    }

    const session = await sessionManager.createSession(args.taskDescription, {
      maxIterations: args.maxIterations || 5,
      mergeThreshold: args.mergeThreshold,
    });

    // Create worktree for iteration 1 upfront so LLM works in isolated environment
    const worktreeManager = new WorktreeManager();
    const branchName = `finsliparn/${session.id}/iteration-1`;
    let worktreePath: string;
    try {
      worktreePath = await worktreeManager.createWorktree(branchName);
      log.info("Worktree created for new session", {
        sessionId: session.id,
        worktreePath,
      });
    } catch (error) {
      log.error("Failed to create initial worktree", {
        sessionId: session.id,
        error: String(error),
      });
      return {
        success: false,
        message: `Failed to create worktree: ${error}`,
        error: {
          code: "WORKTREE_CREATION_FAILED",
          details: String(error),
        },
      };
    }

    // Detect spec files for context
    const specHints = detectSpecFiles();

    // Initialize directive with working directory
    const directiveWriter = new DirectiveWriter();
    await directiveWriter.write({
      session,
      latestIteration: {
        iteration: 1,
        status: "pending",
        timestamp: new Date(),
        score: 0,
        worktreePath,
      },
      nextActions: [
        `Implement the task: ${args.taskDescription}`,
        "Then call finslipa_check to validate with tests",
      ],
      specHints: specHints.length > 0 ? specHints : undefined,
      workingDirectory: worktreePath,
    });

    return {
      success: true,
      message: `Session ${session.id} created`,
      data: {
        sessionId: session.id,
        taskDescription: session.taskDescription,
        workingDirectory: worktreePath,
      },
      nextSteps: [
        `Make your code changes in: ${worktreePath}`,
        "Call finslipa_check to run tests and get feedback",
      ],
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to start session: ${error}`,
      error: {
        code: "SESSION_START_FAILED",
        details: String(error),
      },
    };
  }
}

function isToolResponse(value: unknown): value is ToolResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as ToolResponse).success === "boolean"
  );
}

export async function finslipaCheck(args: {
  sessionId: string;
  useWorktree?: boolean;
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();
  const worktreeManager = new WorktreeManager();

  try {
    return await sessionManager.withLock(args.sessionId, async () => {
      const session = await sessionManager.loadSession(args.sessionId);
      if (!session) {
        return {
          success: false,
          message: `Session ${args.sessionId} not found`,
          error: {
            code: "SESSION_NOT_FOUND",
            details: `No session with ID ${args.sessionId}`,
          },
        };
      }

      log.debug("Starting check", {
        sessionId: args.sessionId,
        currentIteration: session.currentIteration,
        maxIterations: session.maxIterations,
      });

      if (session.currentIteration >= session.maxIterations) {
        await sessionManager.updateSessionStatus(args.sessionId, "failed");
        return {
          success: false,
          message: `Max iterations (${session.maxIterations}) reached`,
          error: {
            code: "MAX_ITERATIONS_REACHED",
            details: `Session has reached the maximum of ${session.maxIterations} iterations. Consider starting a new session or increasing maxIterations.`,
          },
        };
      }

      await sessionManager.updateSessionStatus(args.sessionId, "iterating");

      const iteration = session.currentIteration + 1;
      let workingDirectory = process.cwd();
      let worktreePath: string | undefined;

      if (args.useWorktree ?? true) {
        const worktreeResult = await setupWorktree(
          worktreeManager,
          session.id,
          iteration
        );
        if (isToolResponse(worktreeResult)) {
          return worktreeResult;
        }
        workingDirectory = worktreeResult.workingDirectory;
        worktreePath = worktreeResult.worktreePath;
      }

      const context: CheckContext = {
        sessionId: args.sessionId,
        iteration,
        workingDirectory,
        worktreePath,
      };

      try {
        const testPhaseResult = await runTestPhase(context);
        if (isToolResponse(testPhaseResult)) {
          return testPhaseResult;
        }

        const analysisResult = runAnalysisPhase(testPhaseResult);

        await persistIterationPhase(
          sessionManager,
          context,
          testPhaseResult,
          analysisResult
        );

        await updateDirectivePhase(
          sessionManager,
          context,
          testPhaseResult,
          analysisResult
        );

        return {
          success: true,
          message: `Iteration ${iteration} completed`,
          data: {
            passed: testPhaseResult.testResults.passed,
            failed: testPhaseResult.testResults.failed,
            total: testPhaseResult.testResults.total,
            score: analysisResult.scoreResult.score,
            complexity: testPhaseResult.diffAnalysis.complexity,
            remainingIterations: session.maxIterations - iteration,
          },
          nextSteps: buildNextSteps({
            testResults: testPhaseResult.testResults,
            verbose: false,
          }),
        };
      } catch (testError) {
        log.error("Test run failed", {
          sessionId: args.sessionId,
          error: String(testError),
        });
        return {
          success: false,
          message: "No test runner detected or tests failed to run",
          error: {
            code: "TEST_RUN_FAILED",
            details: `Could not detect or execute tests: ${testError}`,
          },
        };
      }
    });
  } catch (error) {
    log.error("Check failed", {
      sessionId: args.sessionId,
      error: String(error),
    });
    return {
      success: false,
      message: `Failed to check session: ${error}`,
      error: {
        code: "CHECK_FAILED",
        details: String(error),
      },
    };
  }
}

export async function finslipaStatus(args: {
  sessionId: string;
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();

  try {
    const session = await sessionManager.loadSession(args.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${args.sessionId} not found`,
        error: {
          code: "SESSION_NOT_FOUND",
          details: `No session with ID ${args.sessionId}`,
        },
      };
    }

    return {
      success: true,
      message: `Session ${args.sessionId} status`,
      data: {
        sessionId: session.id,
        status: session.status,
        currentIteration: session.currentIteration,
        maxIterations: session.maxIterations,
        taskDescription: session.taskDescription,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get status: ${error}`,
      error: {
        code: "STATUS_FAILED",
        details: String(error),
      },
    };
  }
}

export async function finslipaVote(args: {
  sessionId: string;
  strategy?: "highest_score" | "minimal_diff" | "balanced";
  returnBest?: boolean; // Return tracked best result instead of voting
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();
  const strategy = args.strategy ?? "highest_score";

  try {
    const session = await sessionManager.loadSession(args.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${args.sessionId} not found`,
        error: {
          code: "SESSION_NOT_FOUND",
          details: `No session with ID ${args.sessionId}`,
        },
      };
    }

    if (session.iterations.length === 0) {
      return {
        success: false,
        message: "No iterations to vote on",
        error: {
          code: "NO_ITERATIONS",
          details: "Run finslipa_check first to create iterations",
        },
      };
    }

    // Return tracked best if requested and available
    if (args.returnBest && session.bestIteration !== undefined) {
      await sessionManager.updateSessionStatus(args.sessionId, "evaluating");
      return {
        success: true,
        message: `Returning best tracked iteration ${session.bestIteration} with score ${session.bestScore}`,
        data: {
          selectedIteration: session.bestIteration,
          score: session.bestScore,
          strategy: "best_tracked",
          totalIterations: session.iterations.length,
        },
        nextSteps: [
          `Call finslipa_merge to merge iteration ${session.bestIteration}`,
        ],
      };
    }

    const completedIterations = session.iterations.filter(
      (iteration) =>
        iteration.status === "completed" && iteration.score !== undefined
    );

    if (completedIterations.length === 0) {
      return {
        success: false,
        message: "No completed iterations with scores",
        error: {
          code: "NO_SCORED_ITERATIONS",
          details: "All iterations must complete before voting",
        },
      };
    }

    // Select winner based on strategy
    const passingIterations = completedIterations.filter(
      (iter) => iter.score === 100
    );

    let winner: IterationResult;
    if (strategy === "highest_score") {
      winner = completedIterations.reduce((best, current) =>
        (current.score ?? 0) > (best.score ?? 0) ? current : best
      );
    } else if (strategy === "minimal_diff") {
      winner = selectMinimalDiffWinner(completedIterations, passingIterations);
      if (passingIterations.length === 0) {
        log.warn(
          "minimal_diff: No passing iterations, falling back to smallest diff among all",
          {
            totalIterations: completedIterations.length,
          }
        );
      }
    } else {
      winner = selectBalancedWinner(completedIterations);
    }

    await sessionManager.updateSessionStatus(args.sessionId, "evaluating");

    return {
      success: true,
      message: `Selected iteration ${winner.iteration} with score ${winner.score}`,
      data: {
        selectedIteration: winner.iteration,
        score: winner.score,
        strategy,
        totalIterations: completedIterations.length,
      },
      nextSteps: [`Call finslipa_merge to merge iteration ${winner.iteration}`],
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to vote: ${error}`,
      error: {
        code: "VOTE_FAILED",
        details: String(error),
      },
    };
  }
}

export async function finslipaCancel(args: {
  sessionId: string;
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();
  const worktreeManager = new WorktreeManager();

  try {
    const session = await sessionManager.loadSession(args.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${args.sessionId} not found`,
        error: {
          code: "SESSION_NOT_FOUND",
          details: `No session with ID ${args.sessionId}`,
        },
      };
    }

    if (session.status === "completed" || session.status === "cancelled") {
      return {
        success: false,
        message: `Session ${args.sessionId} is already ${session.status}`,
        error: {
          code: "SESSION_ALREADY_FINISHED",
          details: `Cannot cancel a session that is already ${session.status}`,
        },
      };
    }

    log.info("Cancelling session", {
      sessionId: args.sessionId,
      currentStatus: session.status,
      iterations: session.iterations.length,
    });

    // Clean up worktrees for all iterations that have them
    for (const iteration of session.iterations) {
      if (iteration.worktreePath) {
        const branchName = `finsliparn/${session.id}/iteration-${iteration.iteration}`;
        try {
          await worktreeManager.deleteWorktree(branchName);
          log.debug("Worktree cleaned up", {
            sessionId: args.sessionId,
            iteration: iteration.iteration,
          });
        } catch (error) {
          log.warn("Failed to clean up worktree", {
            sessionId: args.sessionId,
            iteration: iteration.iteration,
            error: String(error),
          });
        }
      }
    }

    await sessionManager.updateSessionStatus(args.sessionId, "cancelled");

    // Clear directive file
    const directiveWriter = new DirectiveWriter();
    await directiveWriter.write({
      session: { ...session, status: "cancelled" },
      latestIteration: {
        iteration: session.currentIteration,
        status: "failed",
        timestamp: new Date(),
        score: 0,
      },
      nextActions: [
        "Session cancelled. Start a new session with finslipa_start.",
      ],
    });

    return {
      success: true,
      message: `Session ${args.sessionId} cancelled`,
      data: {
        sessionId: args.sessionId,
        iterationsCancelled: session.iterations.length,
        worktreesCleaned: session.iterations.filter((i) => i.worktreePath)
          .length,
      },
      nextSteps: ["Start a new session with finslipa_start when ready"],
    };
  } catch (error) {
    log.error("Cancel failed", {
      sessionId: args.sessionId,
      error: String(error),
    });
    return {
      success: false,
      message: `Failed to cancel session: ${error}`,
      error: {
        code: "CANCEL_FAILED",
        details: String(error),
      },
    };
  }
}

async function commitWorktreeChanges(
  worktreePath: string,
  sessionId: string,
  iteration: number,
  score: number | undefined
): Promise<boolean> {
  const worktreeGit = simpleGit(worktreePath);
  const status = await worktreeGit.status();

  if (status.modified.length === 0 && status.created.length === 0) {
    return false;
  }

  await worktreeGit.add(".");
  await worktreeGit.commit(
    `finsliparn: iteration ${iteration} (score: ${score})`
  );
  log.info("Committed worktree changes", {
    sessionId,
    iteration,
    modified: status.modified.length,
    created: status.created.length,
  });
  return true;
}

export async function finslipaMerge(args: {
  sessionId: string;
  iterationNumber?: number;
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();
  const worktreeManager = new WorktreeManager();

  try {
    const session = await sessionManager.loadSession(args.sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${args.sessionId} not found`,
        error: {
          code: "SESSION_NOT_FOUND",
          details: `No session with ID ${args.sessionId}`,
        },
      };
    }

    const targetIteration =
      args.iterationNumber ??
      session.selectedIteration ??
      session.currentIteration;

    const iteration = session.iterations.find(
      (i) => i.iteration === targetIteration
    );

    if (!iteration) {
      return {
        success: false,
        message: `Iteration ${targetIteration} not found`,
        error: {
          code: "ITERATION_NOT_FOUND",
          details: `No iteration ${targetIteration} in session`,
        },
      };
    }

    const completedIterations = session.iterations.filter(
      (iter) => iter.status === "completed" && iter.score !== undefined
    );

    // Allow early exit on perfect score (100% score, all tests pass, at least one test ran)
    const isPerfectScore =
      iteration.score === 100 &&
      iteration.testResults?.failed === 0 &&
      (iteration.testResults?.passed ?? 0) > 0;

    if (completedIterations.length < 2 && !isPerfectScore) {
      return {
        success: false,
        message: `Cannot merge with only ${completedIterations.length} completed iteration(s). At least 2 are required for comparison (unless perfect score).`,
        error: {
          code: "INSUFFICIENT_ITERATIONS",
          details:
            "Complete at least 2 iterations before merging to ensure meaningful comparison, or achieve a perfect score (100%, all tests pass)",
        },
      };
    }

    // Check merge threshold if configured (undefined means disabled)
    const threshold = session.mergeThreshold;
    if (threshold !== undefined && (iteration.score ?? 0) < threshold) {
      return {
        success: false,
        message: `Cannot merge iteration with score ${iteration.score}. Minimum required: ${threshold}%.`,
        error: {
          code: "SCORE_BELOW_THRESHOLD",
          details: `Score ${iteration.score}% is below the merge threshold of ${threshold}%`,
        },
      };
    }

    // Perform git merge if worktree was used
    let mergeResult: string | undefined;
    if (iteration.worktreePath) {
      const git = simpleGit(process.cwd());
      const branchName = `finsliparn/${session.id}/iteration-${targetIteration}`;

      try {
        // Commit any uncommitted changes in the worktree first
        await commitWorktreeChanges(
          iteration.worktreePath,
          session.id,
          targetIteration,
          iteration.score
        );

        // Merge the iteration branch into current branch
        await git.merge([
          branchName,
          "--no-ff",
          "-m",
          `Merge finsliparn iteration ${targetIteration} (score: ${iteration.score})`,
        ]);
        mergeResult = `Merged branch ${branchName}`;

        // Clean up the worktree
        await worktreeManager.deleteWorktree(branchName);
      } catch (error) {
        return {
          success: false,
          message: `Git merge failed: ${error}`,
          error: {
            code: "GIT_MERGE_FAILED",
            details: String(error),
          },
        };
      }
    }

    await sessionManager.updateSessionStatus(args.sessionId, "completed");

    return {
      success: true,
      message: `Session ${args.sessionId} completed successfully`,
      data: {
        sessionId: args.sessionId,
        mergedIteration: targetIteration,
        finalScore: iteration.score,
        mergeResult,
      },
      nextSteps: ["Refinement session complete. Changes are ready."],
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to merge: ${error}`,
      error: {
        code: "MERGE_FAILED",
        details: String(error),
      },
    };
  }
}

async function cleanWorktreesForSession(
  worktreeManager: WorktreeManager,
  session: { id: string; iterations: IterationResult[] }
): Promise<number> {
  let cleanedCount = 0;
  for (const iteration of session.iterations) {
    if (iteration.worktreePath) {
      const branchName = `finsliparn/${session.id}/iteration-${iteration.iteration}`;
      try {
        await worktreeManager.deleteWorktree(branchName);
        cleanedCount += 1;
        log.debug("Worktree cleaned", {
          sessionId: session.id,
          iteration: iteration.iteration,
        });
      } catch (error) {
        log.warn("Failed to clean worktree", {
          sessionId: session.id,
          iteration: iteration.iteration,
          error: String(error),
        });
      }
    }
  }
  return cleanedCount;
}

async function cleanSpecificSession(
  sessionManager: SessionManager,
  worktreeManager: WorktreeManager,
  sessionId: string
): Promise<ToolResponse> {
  const session = await sessionManager.loadSession(sessionId);
  if (!session) {
    return {
      success: false,
      message: `Session ${sessionId} not found`,
      error: {
        code: "SESSION_NOT_FOUND",
        details: `No session with ID ${sessionId}`,
      },
    };
  }

  const cleanableStatuses = ["completed", "cancelled", "failed"];
  if (!cleanableStatuses.includes(session.status)) {
    return {
      success: false,
      message: `Cannot clean session ${sessionId} with status "${session.status}"`,
      error: {
        code: "SESSION_IN_PROGRESS",
        details: "Only completed, cancelled, or failed sessions can be cleaned",
      },
    };
  }

  const worktreesCleaned = await cleanWorktreesForSession(
    worktreeManager,
    session
  );
  await sessionManager.deleteSession(sessionId);
  log.info("Session cleaned", {
    sessionId,
    status: session.status,
    worktreesCleaned,
  });

  return {
    success: true,
    message: `Session ${sessionId} cleaned successfully`,
    data: {
      sessionId,
      cleanedStatus: session.status,
      worktreesCleaned,
    },
    nextSteps: ["Session directory and worktrees deleted"],
  };
}

async function cleanSessionsByStatus(
  sessionManager: SessionManager,
  worktreeManager: WorktreeManager,
  targetStatus: string
): Promise<ToolResponse> {
  const sessionDirs = await sessionManager.listSessions();
  let cleanedCount = 0;
  let worktreesCleaned = 0;
  const errors: string[] = [];

  for (const sessionDir of sessionDirs) {
    try {
      const session = await sessionManager.loadSession(sessionDir);
      if (session && session.status === targetStatus) {
        worktreesCleaned += await cleanWorktreesForSession(
          worktreeManager,
          session
        );
        await sessionManager.deleteSession(sessionDir);
        cleanedCount += 1;
        log.info("Session cleaned by status filter", {
          sessionId: sessionDir,
          status: targetStatus,
        });
      }
    } catch (error) {
      errors.push(`Failed to clean session ${sessionDir}: ${error}`);
    }
  }

  return {
    success: true,
    message: `Cleaned ${cleanedCount} session(s) with status "${targetStatus}"`,
    data: {
      cleanedCount,
      status: targetStatus,
      worktreesCleaned,
      errors: errors.length > 0 ? errors : undefined,
    },
    nextSteps: [
      `${cleanedCount} session directory/directories and ${worktreesCleaned} worktree(s) deleted`,
      ...(errors.length > 0
        ? [`${errors.length} error(s) during cleanup`]
        : []),
    ],
  };
}

async function cleanOrphanedWorktrees(
  sessionManager: SessionManager,
  worktreeManager: WorktreeManager
): Promise<{ cleanedCount: number; errors: string[] }> {
  const allWorktreePaths = await worktreeManager.listSessionWorktreePaths();
  const sessionIds = new Set(await sessionManager.listSessions());
  let cleanedCount = 0;
  const errors: string[] = [];

  for (const worktreePath of allWorktreePaths) {
    const parts = worktreePath.split("/");
    if (parts.length >= 2) {
      const sessionId = parts[1];
      if (!sessionIds.has(sessionId)) {
        try {
          await worktreeManager.deleteWorktreeByPath(worktreePath);
          cleanedCount += 1;
          log.info("Orphaned worktree cleaned", { worktreePath, sessionId });
        } catch (error) {
          errors.push(
            `Failed to clean orphaned worktree ${worktreePath}: ${error}`
          );
        }
      }
    }
  }

  await worktreeManager.cleanEmptyDirectories();
  return { cleanedCount, errors };
}

async function cleanAllFinishedSessions(
  sessionManager: SessionManager,
  worktreeManager: WorktreeManager
): Promise<ToolResponse> {
  const sessionDirs = await sessionManager.listSessions();
  let cleanedCount = 0;
  let worktreesCleaned = 0;
  const errors: string[] = [];
  const cleanableStatuses = ["completed", "cancelled", "failed"];

  for (const sessionDir of sessionDirs) {
    try {
      const session = await sessionManager.loadSession(sessionDir);
      if (session && cleanableStatuses.includes(session.status)) {
        worktreesCleaned += await cleanWorktreesForSession(
          worktreeManager,
          session
        );
        await sessionManager.deleteSession(sessionDir);
        cleanedCount += 1;
        log.info("Session cleaned by default filter", {
          sessionId: sessionDir,
          status: session.status,
        });
      }
    } catch (error) {
      errors.push(`Failed to clean session ${sessionDir}: ${error}`);
    }
  }

  const orphanedResult = await cleanOrphanedWorktrees(
    sessionManager,
    worktreeManager
  );
  worktreesCleaned += orphanedResult.cleanedCount;
  errors.push(...orphanedResult.errors);

  return {
    success: true,
    message: `Cleaned ${cleanedCount} completed/cancelled session(s)`,
    data: {
      cleanedCount,
      statuses: cleanableStatuses,
      worktreesCleaned,
      orphanedWorktreesCleaned: orphanedResult.cleanedCount,
      errors: errors.length > 0 ? errors : undefined,
    },
    nextSteps: [
      `${cleanedCount} session directory/directories and ${worktreesCleaned} worktree(s) deleted`,
      ...(errors.length > 0
        ? [`${errors.length} error(s) during cleanup`]
        : []),
    ],
  };
}

export async function finslipaClean(args: {
  sessionId?: string;
  status?: "completed" | "cancelled";
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();
  const worktreeManager = new WorktreeManager();

  try {
    if (args.sessionId) {
      return await cleanSpecificSession(
        sessionManager,
        worktreeManager,
        args.sessionId
      );
    }

    if (args.status) {
      return await cleanSessionsByStatus(
        sessionManager,
        worktreeManager,
        args.status
      );
    }

    return await cleanAllFinishedSessions(sessionManager, worktreeManager);
  } catch (error) {
    log.error("Clean failed", {
      sessionId: args.sessionId,
      error: String(error),
    });
    return {
      success: false,
      message: `Failed to clean sessions: ${error}`,
      error: {
        code: "CLEAN_FAILED",
        details: String(error),
      },
    };
  }
}
