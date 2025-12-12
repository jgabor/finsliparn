import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../core/session-manager";
import type { IterationResult } from "../types";
import { finslipaVote } from "./tools";

describe("finslipaVote", () => {
  let tempDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `finsliparn-vote-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    process.chdir(tempDir);
    sessionManager = new SessionManager(tempDir);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("minimal_diff selects passing iteration over smaller failing iteration", async () => {
    const session = await sessionManager.createSession("Test voting");

    // Iteration 1: Failing (score 50) but small diff
    const failingIteration: IterationResult = {
      iteration: 1,
      status: "completed",
      timestamp: new Date(),
      score: 50,
      diff: {
        filesChanged: ["a.ts"],
        insertions: 5,
        deletions: 2,
        complexity: "low",
        complexityScore: 10,
      },
    };

    // Iteration 2: Passing (score 100) but larger diff
    const passingIteration: IterationResult = {
      iteration: 2,
      status: "completed",
      timestamp: new Date(),
      score: 100,
      diff: {
        filesChanged: ["a.ts", "b.ts"],
        insertions: 50,
        deletions: 20,
        complexity: "medium",
        complexityScore: 40,
      },
    };

    await sessionManager.addIteration(session.id, failingIteration);
    await sessionManager.addIteration(session.id, passingIteration);

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "minimal_diff",
    });

    expect(result.success).toBe(true);
    // Should select iteration 2 (passing) even though iteration 1 has smaller diff
    expect(result.data).toBeDefined();
    const data = result.data as { selectedIteration: number; score: number };
    expect(data.selectedIteration).toBe(2);
    expect(data.score).toBe(100);
  });

  test("minimal_diff falls back to smallest diff when no passing iterations", async () => {
    const session = await sessionManager.createSession("Test voting fallback");

    // Both iterations failing, different scores and diff sizes
    const iter1: IterationResult = {
      iteration: 1,
      status: "completed",
      timestamp: new Date(),
      score: 30,
      diff: {
        filesChanged: ["a.ts"],
        insertions: 100,
        deletions: 50,
        complexity: "high",
        complexityScore: 60,
      },
    };

    const iter2: IterationResult = {
      iteration: 2,
      status: "completed",
      timestamp: new Date(),
      score: 50,
      diff: {
        filesChanged: ["a.ts"],
        insertions: 10,
        deletions: 5,
        complexity: "low",
        complexityScore: 15,
      },
    };

    await sessionManager.addIteration(session.id, iter1);
    await sessionManager.addIteration(session.id, iter2);

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "minimal_diff",
    });

    expect(result.success).toBe(true);
    // Falls back to smallest diff (iteration 2) since no passing iterations
    const data = result.data as { selectedIteration: number; score: number };
    expect(data.selectedIteration).toBe(2);
    expect(data.score).toBe(50);
  });

  test("highest_score selects best score regardless of diff size", async () => {
    const session = await sessionManager.createSession("Test highest score");

    const lowScoreLowDiff: IterationResult = {
      iteration: 1,
      status: "completed",
      timestamp: new Date(),
      score: 60,
      diff: {
        filesChanged: ["a.ts"],
        insertions: 5,
        deletions: 2,
        complexity: "low",
        complexityScore: 10,
      },
    };

    const highScoreHighDiff: IterationResult = {
      iteration: 2,
      status: "completed",
      timestamp: new Date(),
      score: 90,
      diff: {
        filesChanged: ["a.ts", "b.ts", "c.ts"],
        insertions: 200,
        deletions: 100,
        complexity: "high",
        complexityScore: 80,
      },
    };

    await sessionManager.addIteration(session.id, lowScoreLowDiff);
    await sessionManager.addIteration(session.id, highScoreHighDiff);

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "highest_score",
    });

    expect(result.success).toBe(true);
    const data = result.data as { selectedIteration: number; score: number };
    expect(data.selectedIteration).toBe(2);
    expect(data.score).toBe(90);
  });
});

describe("finslipaVote consensus strategy", () => {
  let tempDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `finsliparn-consensus-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    process.chdir(tempDir);
    sessionManager = new SessionManager(tempDir);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("groups identical outputs together", async () => {
    const session = await sessionManager.createSession(
      "Test consensus grouping"
    );

    // 3 iterations: 2 with identical output "A", 1 with different output "B"
    const iterA1: IterationResult = {
      iteration: 1,
      status: "completed",
      timestamp: new Date(),
      score: 80,
      solution: {
        code: "function solve() { return 'A'; }",
        feedback: "",
        score: 80,
      },
    };

    const iterA2: IterationResult = {
      iteration: 2,
      status: "completed",
      timestamp: new Date(),
      score: 85,
      solution: {
        code: "function solve() { return 'A'; }",
        feedback: "",
        score: 85,
      },
    };

    const iterB: IterationResult = {
      iteration: 3,
      status: "completed",
      timestamp: new Date(),
      score: 90,
      solution: {
        code: "function solve() { return 'B'; }",
        feedback: "",
        score: 90,
      },
    };

    await sessionManager.addIteration(session.id, iterA1);
    await sessionManager.addIteration(session.id, iterA2);
    await sessionManager.addIteration(session.id, iterB);

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "consensus",
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      selectedIteration: number;
      voteCount: number;
    };
    // Group A has 2 votes, Group B has 1 vote
    // Winner should be from Group A (iterations 1 or 2)
    expect([1, 2]).toContain(data.selectedIteration);
    expect(data.voteCount).toBe(2);
  });

  test("counts votes per output group", async () => {
    const session = await sessionManager.createSession(
      "Test consensus counting"
    );

    // 4 iterations: 2 with output A, 1 with output B, 1 with output C
    const iterations: IterationResult[] = [
      {
        iteration: 1,
        status: "completed",
        timestamp: new Date(),
        score: 70,
        solution: { code: "A", feedback: "", score: 70 },
      },
      {
        iteration: 2,
        status: "completed",
        timestamp: new Date(),
        score: 75,
        solution: { code: "A", feedback: "", score: 75 },
      },
      {
        iteration: 3,
        status: "completed",
        timestamp: new Date(),
        score: 80,
        solution: { code: "B", feedback: "", score: 80 },
      },
      {
        iteration: 4,
        status: "completed",
        timestamp: new Date(),
        score: 85,
        solution: { code: "C", feedback: "", score: 85 },
      },
    ];

    for (const iter of iterations) {
      await sessionManager.addIteration(session.id, iter);
    }

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "consensus",
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      selectedIteration: number;
      voteCount: number;
      groupCount: number;
    };
    // Output A should win with 2 votes
    expect(data.voteCount).toBe(2);
    expect(data.groupCount).toBe(3); // 3 distinct outputs
  });

  test("ranks groups by vote count descending", async () => {
    const session = await sessionManager.createSession(
      "Test consensus ranking"
    );

    // 5 iterations: 3 with output X (winner), 2 with output Y
    const iterations: IterationResult[] = [
      {
        iteration: 1,
        status: "completed",
        timestamp: new Date(),
        score: 60,
        solution: { code: "X", feedback: "", score: 60 },
      },
      {
        iteration: 2,
        status: "completed",
        timestamp: new Date(),
        score: 95,
        solution: { code: "Y", feedback: "", score: 95 },
      },
      {
        iteration: 3,
        status: "completed",
        timestamp: new Date(),
        score: 70,
        solution: { code: "X", feedback: "", score: 70 },
      },
      {
        iteration: 4,
        status: "completed",
        timestamp: new Date(),
        score: 90,
        solution: { code: "Y", feedback: "", score: 90 },
      },
      {
        iteration: 5,
        status: "completed",
        timestamp: new Date(),
        score: 65,
        solution: { code: "X", feedback: "", score: 65 },
      },
    ];

    for (const iter of iterations) {
      await sessionManager.addIteration(session.id, iter);
    }

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "consensus",
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      selectedIteration: number;
      voteCount: number;
    };
    // Group X has 3 votes, Group Y has 2 votes
    // Winner should be from Group X (iterations 1, 3, or 5) despite lower scores
    expect([1, 3, 5]).toContain(data.selectedIteration);
    expect(data.voteCount).toBe(3);
  });

  test("uses score as tiebreaker within same vote count", async () => {
    const session = await sessionManager.createSession(
      "Test consensus tiebreaker"
    );

    // 4 iterations: 2 with output A (scores 70, 80), 2 with output B (scores 85, 90)
    const iterations: IterationResult[] = [
      {
        iteration: 1,
        status: "completed",
        timestamp: new Date(),
        score: 70,
        solution: { code: "A", feedback: "", score: 70 },
      },
      {
        iteration: 2,
        status: "completed",
        timestamp: new Date(),
        score: 80,
        solution: { code: "A", feedback: "", score: 80 },
      },
      {
        iteration: 3,
        status: "completed",
        timestamp: new Date(),
        score: 85,
        solution: { code: "B", feedback: "", score: 85 },
      },
      {
        iteration: 4,
        status: "completed",
        timestamp: new Date(),
        score: 90,
        solution: { code: "B", feedback: "", score: 90 },
      },
    ];

    for (const iter of iterations) {
      await sessionManager.addIteration(session.id, iter);
    }

    const result = await finslipaVote({
      sessionId: session.id,
      strategy: "consensus",
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      selectedIteration: number;
      voteCount: number;
      score: number;
    };
    // Both groups have 2 votes, but Group B has higher best score (90 vs 80)
    // Winner should be iteration 4 (best score in winning group)
    expect(data.selectedIteration).toBe(4);
    expect(data.voteCount).toBe(2);
    expect(data.score).toBe(90);
  });
});
