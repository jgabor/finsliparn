import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DiffAnalyzer } from "../core/diff-analyzer";
import { DirectiveWriter } from "../core/directive-writer";
import { QualityAnalyzer } from "../core/quality-analyzer";
import { ScoringEngine } from "../core/scoring-engine";
import { SessionManager } from "../core/session-manager";
import { detectTestRunner } from "../core/test-runner";
import type {
  DiffAnalysis,
  IterationSummary,
  QualityAnalysis,
  TestResults,
  ToolResponse,
} from "../types";

const SPEC_FILENAMES = [
  "spec",
  "roadmap",
  "architecture",
  "design",
  "specification",
];
const SPEC_DIRECTORIES = [".", "docs"];

function buildNextActions(
  testResults: TestResults,
  diffAnalysis: DiffAnalysis,
  remainingIterations: number
): string[] {
  const hasActualTests = testResults.total > 0;
  const allPassing = hasActualTests && testResults.failed === 0;

  if (!hasActualTests) {
    return [
      "No tests detected - ensure tests exist and run correctly",
      "Call finslipa_check again after adding tests",
    ];
  }
  if (allPassing) {
    return [
      "All tests passing!",
      `Complexity: ${diffAnalysis.complexity}`,
      "Review the diff for quality improvements, then call finslipa_merge to complete",
    ];
  }
  return [
    `${testResults.failed} test(s) failing`,
    "Fix the failing tests and call finslipa_check again",
    `${remainingIterations} iteration(s) remaining`,
  ];
}

function buildNextSteps(testResults: TestResults): string[] {
  const hasActualTests = testResults.total > 0;
  const allPassing = hasActualTests && testResults.failed === 0;

  if (!hasActualTests) {
    return ["No tests detected - add tests and run finslipa_check again"];
  }
  if (allPassing) {
    return ["All tests passing! Call finslipa_merge to complete"];
  }
  return ["Fix failing tests and run finslipa_check again"];
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

    // Detect spec files for context
    const specHints = detectSpecFiles();

    // Initialize directive
    const directiveWriter = new DirectiveWriter();
    await directiveWriter.write({
      session,
      latestIteration: {
        iteration: 0,
        status: "pending",
        timestamp: new Date(),
        score: 0,
      },
      nextActions: [
        `Implement the task: ${args.taskDescription}`,
        "Then call finslipa_check to validate with tests",
      ],
      specHints: specHints.length > 0 ? specHints : undefined,
    });

    return {
      success: true,
      message: `Session ${session.id} created`,
      data: {
        sessionId: session.id,
        taskDescription: session.taskDescription,
      },
      nextSteps: [
        `Make your code changes for: ${args.taskDescription}`,
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Full iteration workflow with test running, analysis, and directive updates
export async function finslipaCheck(args: {
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

    // Safety check: prevent infinite loops
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

    // Update status to iterating
    await sessionManager.updateSessionStatus(args.sessionId, "iterating");

    // Detect and run tests
    try {
      const testRunner = await detectTestRunner(process.cwd());
      const testResults = await testRunner.run({
        timeout: 30_000,
        cwd: process.cwd(),
      });

      // Analyze diff for complexity scoring
      const diffAnalyzer = new DiffAnalyzer();
      const diffAnalysis = await diffAnalyzer.analyze(process.cwd());

      // Analyze code quality when tests pass
      let qualityAnalysis: QualityAnalysis | undefined;
      if (testResults.failed === 0 && testResults.total > 0) {
        const rawDiff = await diffAnalyzer.getRawDiff(process.cwd());
        if (rawDiff) {
          const qualityAnalyzer = new QualityAnalyzer();
          qualityAnalysis = qualityAnalyzer.analyze(rawDiff);
        }
      }

      // Calculate score using ScoringEngine with diff analysis
      const scoringEngine = new ScoringEngine();
      const scoreResult = scoringEngine.calculateScore(
        testResults,
        diffAnalysis
      );

      // Create iteration result
      const iteration = session.currentIteration + 1;
      await sessionManager.addIteration(args.sessionId, {
        iteration,
        status: "completed",
        timestamp: new Date(),
        testResults,
        score: scoreResult.score,
        diff: diffAnalysis,
      });

      // Transition to completed if all tests pass
      const allTestsPassing = testResults.failed === 0 && testResults.total > 0;
      if (allTestsPassing) {
        await sessionManager.updateSessionStatus(args.sessionId, "completed");
      }

      // Update directive with feedback - reload session to get updated status
      const directiveWriter = new DirectiveWriter();
      const updatedSession = await sessionManager.loadSession(args.sessionId);
      const latestIteration = await sessionManager.getLatestIteration(
        args.sessionId
      );

      if (latestIteration && updatedSession) {
        // Build history from previous iterations using UPDATED session to prevent repeating mistakes
        const history: IterationSummary[] = updatedSession.iterations
          .filter((iter) => iter.testResults && iter.score !== undefined)
          .map((iter) => ({
            iteration: iter.iteration,
            score: iter.score ?? 0,
            summary: iter.testResults
              ? `${iter.testResults.passed}/${iter.testResults.total} tests passing`
              : "No test results",
          }));
        const remainingIterations = updatedSession.maxIterations - iteration;
        const nextActions = buildNextActions(
          testResults,
          diffAnalysis,
          remainingIterations
        );
        const specHints = detectSpecFiles();

        await directiveWriter.write({
          session: updatedSession,
          latestIteration,
          nextActions,
          history: history.length > 0 ? history : undefined,
          specHints: specHints.length > 0 ? specHints : undefined,
          qualityAnalysis,
        });
      }

      return {
        success: true,
        message: `Iteration ${iteration} completed`,
        data: {
          passed: testResults.passed,
          failed: testResults.failed,
          total: testResults.total,
          score: scoreResult.score,
          complexity: diffAnalysis.complexity,
          remainingIterations: session.maxIterations - iteration,
        },
        nextSteps: buildNextSteps(testResults),
      };
    } catch {
      return {
        success: false,
        message: "No test runner detected or tests failed to run",
        error: {
          code: "TEST_RUN_FAILED",
          details: "Could not detect or execute tests",
        },
      };
    }
  } catch (error) {
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

    const winner = completedIterations.reduce((best, current) =>
      (current.score ?? 0) > (best.score ?? 0) ? current : best
    );

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

export async function finslipaMerge(args: {
  sessionId: string;
  iterationNumber?: number;
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

    await sessionManager.updateSessionStatus(args.sessionId, "completed");

    return {
      success: true,
      message: `Session ${args.sessionId} completed successfully`,
      data: {
        sessionId: args.sessionId,
        mergedIteration: targetIteration,
        finalScore: iteration.score,
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
