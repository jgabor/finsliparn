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
