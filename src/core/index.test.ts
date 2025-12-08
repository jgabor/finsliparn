import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffAnalysis, IterationResult, TestResults } from "../types";
import { DiffAnalyzer } from "./diff-analyzer";
import { FeedbackGenerator } from "./feedback-generator";
import { ScoringEngine } from "./scoring-engine";
import { SessionManager } from "./session-manager";
import { SoftScorer } from "./soft-scorer";
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

describe("ScoringEngine", () => {
  test("should calculate pass rate for all passing tests", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 10,
      failed: 0,
      total: 10,
      duration: 100,
      failures: [],
    };

    const passRate = engine.calculatePassRate(testResults);
    expect(passRate).toBe(100);
  });

  test("should calculate pass rate for mixed results", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 7,
      failed: 3,
      total: 10,
      duration: 100,
      failures: [],
    };

    const passRate = engine.calculatePassRate(testResults);
    expect(passRate).toBe(70);
  });

  test("should return 0 pass rate for no tests", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 0,
      failed: 0,
      total: 0,
      duration: 0,
      failures: [],
    };

    const passRate = engine.calculatePassRate(testResults);
    expect(passRate).toBe(0);
  });

  test("should calculate score without diff analysis", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 8,
      failed: 2,
      total: 10,
      duration: 100,
      failures: [],
    };

    const result = engine.calculateScore(testResults);
    expect(result.score).toBe(80);
    expect(result.passRate).toBe(80);
    expect(result.breakdown.testPassRate).toBe(80);
    expect(
      result.breakdown.penalties.filter((p) => p.reason.includes("complexity"))
    ).toHaveLength(0);
  });

  test("should apply complexity penalty from diff analysis", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 10,
      failed: 0,
      total: 10,
      duration: 100,
      failures: [],
    };
    const diffAnalysis: DiffAnalysis = {
      filesChanged: ["file1.ts", "file2.ts"],
      insertions: 100,
      deletions: 50,
      complexity: "high",
      complexityScore: 50,
    };

    const result = engine.calculateScore(testResults, diffAnalysis);
    expect(result.score).toBe(95);
    const complexityPenalty = result.breakdown.penalties.find((p) =>
      p.reason.includes("complexity")
    );
    expect(complexityPenalty?.deduction).toBe(5);
  });

  test("should use getScore helper method", () => {
    const engine = new ScoringEngine();
    const testResults: TestResults = {
      framework: "bun",
      passed: 5,
      failed: 5,
      total: 10,
      duration: 100,
      failures: [],
    };

    const score = engine.getScore(testResults);
    expect(score).toBe(50);
  });

  test("should respect custom weights", () => {
    const engine = new ScoringEngine({ complexityPenalty: 0.5 });
    const testResults: TestResults = {
      framework: "bun",
      passed: 10,
      failed: 0,
      total: 10,
      duration: 100,
      failures: [],
    };
    const diffAnalysis: DiffAnalysis = {
      filesChanged: ["file1.ts"],
      insertions: 50,
      deletions: 10,
      complexity: "medium",
      complexityScore: 20,
    };

    const result = engine.calculateScore(testResults, diffAnalysis);
    expect(result.score).toBe(90);
    const complexityPenalty = result.breakdown.penalties.find((p) =>
      p.reason.includes("complexity")
    );
    expect(complexityPenalty?.deduction).toBe(10);
  });
});

describe("DiffAnalyzer", () => {
  test("should analyze git diff in current directory", async () => {
    const analyzer = new DiffAnalyzer();
    const result = await analyzer.analyze(process.cwd());

    expect(result).toHaveProperty("filesChanged");
    expect(result).toHaveProperty("insertions");
    expect(result).toHaveProperty("deletions");
    expect(result).toHaveProperty("complexity");
    expect(result).toHaveProperty("complexityScore");
    expect(Array.isArray(result.filesChanged)).toBe(true);
    expect(typeof result.insertions).toBe("number");
    expect(typeof result.deletions).toBe("number");
    expect(["low", "medium", "high"]).toContain(result.complexity);
  });

  test("should return empty analysis for non-git directory", async () => {
    const analyzer = new DiffAnalyzer();
    const result = await analyzer.analyze("/tmp");

    expect(result.filesChanged).toEqual([]);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });
});

describe("SoftScorer", () => {
  test("should return 1.0 for exact match", () => {
    const scorer = new SoftScorer();
    const failure = {
      name: "test",
      file: "test.ts",
      message: "Failed",
      expected: "hello",
      actual: "hello",
    };

    const score = scorer.calculateFailureSoftScore(failure);
    expect(score).toBe(1.0);
  });

  test("should return 0 when expected or actual is missing", () => {
    const scorer = new SoftScorer();
    const failure = {
      name: "test",
      file: "test.ts",
      message: "Failed",
    };

    const score = scorer.calculateFailureSoftScore(failure);
    expect(score).toBe(0);
  });

  test("should give partial credit for similar strings", () => {
    const scorer = new SoftScorer();
    const failure = {
      name: "test",
      file: "test.ts",
      message: "Failed",
      expected: "hello world",
      actual: "hello world!",
    };

    const score = scorer.calculateFailureSoftScore(failure);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1.0);
  });

  test("should give partial credit for close numeric values", () => {
    const scorer = new SoftScorer();
    const failure = {
      name: "test",
      file: "test.ts",
      message: "Failed",
      expected: "100",
      actual: "95",
    };

    const score = scorer.calculateFailureSoftScore(failure);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1.0);
  });

  test("should compare JSON arrays with partial credit", () => {
    const scorer = new SoftScorer();
    const failure = {
      name: "test",
      file: "test.ts",
      message: "Failed",
      expected: "[1, 2, 3]",
      actual: "[1, 2, 4]",
    };

    const score = scorer.calculateFailureSoftScore(failure);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1.0);
  });

  test("should calculate aggregate soft score for test results", () => {
    const scorer = new SoftScorer();
    const results: TestResults = {
      framework: "bun",
      passed: 2,
      failed: 1,
      total: 3,
      duration: 100,
      failures: [
        {
          name: "failing test",
          file: "test.ts",
          message: "Failed",
          expected: "hello",
          actual: "hallo",
        },
      ],
    };

    const softScore = scorer.calculateTestResultsSoftScore(results);
    expect(softScore).toBeGreaterThan(0.6);
    expect(softScore).toBeLessThan(1.0);
    expect(results.failures[0]).toBeDefined();
    if (results.failures[0]) {
      expect(results.failures[0].softScore).toBeDefined();
    }
  });
});
