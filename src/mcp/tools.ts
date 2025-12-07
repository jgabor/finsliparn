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
