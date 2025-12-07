import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IterationResult, TestResults } from "../types";
import { FeedbackGenerator } from "./feedback-generator";
import { SessionManager } from "./session-manager";
import { BunTestRunner } from "./test-runner";

describe("SessionManager", () => {
  test("should create a new session", async () => {
    const tempDir = join(tmpdir(), `finsliparn-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const manager = new SessionManager(tempDir);
    const session = await manager.createSession("Test task");

    expect(session).toBeDefined();
    expect(session.taskDescription).toBe("Test task");
    expect(session.status).toBe("initializing");
    expect(session.maxIterations).toBe(5);
  });

  test("should persist and load a session", async () => {
    const tempDir = join(tmpdir(), `finsliparn-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const manager = new SessionManager(tempDir);
    const created = await manager.createSession("Test task");
    const loaded = await manager.loadSession(created.id);

    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.taskDescription).toBe("Test task");
  });

  test("should update session status", async () => {
    const tempDir = join(tmpdir(), `finsliparn-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const manager = new SessionManager(tempDir);
    const session = await manager.createSession("Test task");
    await manager.updateSessionStatus(session.id, "iterating");

    const loaded = await manager.loadSession(session.id);
    expect(loaded?.status).toBe("iterating");
  });

  test("should add iterations to a session", async () => {
    const tempDir = join(tmpdir(), `finsliparn-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const manager = new SessionManager(tempDir);
    const session = await manager.createSession("Test task");

    const iteration: IterationResult = {
      iteration: 1,
      status: "completed",
      timestamp: new Date(),
      score: 50,
    };

    await manager.addIteration(session.id, iteration);
    const loaded = await manager.loadSession(session.id);

    expect(loaded?.iterations).toHaveLength(1);
    expect(loaded?.iterations.at(0)?.iteration).toBe(1);
  });
});

describe("BunTestRunner", () => {
  test("should parse test output", () => {
    const runner = new BunTestRunner();
    const stdout = `ok 1 - test one
ok 2 - test two
not ok 3 - test three
1 passed, 1 failed`;

    const results = runner.parseOutput(stdout, "");

    expect(results.framework).toBe("bun");
    expect(results.total).toBeGreaterThan(0);
    expect(results.failures.length).toBeGreaterThan(0);
  });
});

describe("FeedbackGenerator", () => {
  test("should generate feedback", async () => {
    const testResults: TestResults = {
      framework: "bun",
      passed: 2,
      failed: 1,
      total: 3,
      duration: 100,
      failures: [
        {
          name: "test that fails",
          file: "test.ts",
          line: 10,
          message: "Expected true but got false",
        },
      ],
    };

    const generator = new FeedbackGenerator();
    const context = {
      session: {
        id: "test-id",
        taskDescription: "Test task",
        status: "iterating" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        maxIterations: 5,
        currentIteration: 1,
        iterations: [],
      },
      latestIteration: {
        iteration: 1,
        status: "completed" as const,
        timestamp: new Date(),
        testResults,
        score: 66,
      },
      nextActions: ["Fix the failing test"],
    };

    const feedback = await generator.generate(context);

    expect(feedback).toContain("Iteration 1 Feedback");
    expect(feedback).toContain("66%");
    expect(feedback).toContain("test that fails");
  });
});
