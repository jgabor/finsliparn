// Finsliparn Tool Handlers
// MCP Server integration will follow in Phase 2
// These handlers are exported for use by MCP clients

import { DirectiveWriter } from "../core/directive-writer";
import { SessionManager } from "../core/session-manager";
import { detectTestRunner } from "../core/test-runner";
import type { ToolResponse } from "../types";

export async function finslipaStart(args: {
  taskDescription: string;
  maxIterations?: number;
}): Promise<ToolResponse> {
  const sessionManager = new SessionManager();

  try {
    const session = await sessionManager.createSession(args.taskDescription, {
      maxIterations: args.maxIterations || 5,
    });

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

    // Update status to iterating
    await sessionManager.updateSessionStatus(args.sessionId, "iterating");

    // Detect and run tests
    try {
      const testRunner = await detectTestRunner(process.cwd());
      const testResults = await testRunner.run({
        timeout: 30_000,
        cwd: process.cwd(),
      });

      // Calculate score
      const score =
        testResults.total > 0
          ? Math.round((testResults.passed / testResults.total) * 100)
          : 0;

      // Create iteration result
      const iteration = session.currentIteration + 1;
      await sessionManager.addIteration(args.sessionId, {
        iteration,
        status: "completed",
        timestamp: new Date(),
        testResults,
        score,
      });

      // Update directive with feedback
      const directiveWriter = new DirectiveWriter();
      const latestIteration = await sessionManager.getLatestIteration(
        args.sessionId
      );

      if (latestIteration) {
        const nextActions =
          testResults.failed === 0
            ? ["All tests passing! Session complete."]
            : [
                `${testResults.failed} test(s) failing`,
                "Fix the failing tests and call finslipa_check again",
              ];

        await directiveWriter.write({
          session,
          latestIteration,
          nextActions,
        });
      }

      return {
        success: true,
        message: `Iteration ${iteration} completed`,
        data: {
          passed: testResults.passed,
          failed: testResults.failed,
          total: testResults.total,
          score,
        },
        nextSteps:
          testResults.failed === 0
            ? ["All tests passing! Refinement complete."]
            : ["Fix failing tests and run finslipa_check again"],
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

    if (iteration.score !== 100) {
      return {
        success: false,
        message: `Cannot merge iteration with score ${iteration.score}. All tests must pass.`,
        error: {
          code: "TESTS_NOT_PASSING",
          details: "Only iterations with 100% test pass rate can be merged",
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
