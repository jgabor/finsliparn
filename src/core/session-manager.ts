import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  IterationResult,
  RefinementSession,
  SessionConfig,
  SessionStatus,
} from "../types";
import { createLogger } from "./logger";

const log = createLogger("SessionManager");

const DEFAULT_CONFIG: SessionConfig = {
  maxIterations: 5,
  timeout: 300_000, // 5 min
  parallelExperts: false,
  maxSolutions: 5,
  improvingOrder: true,
  returnBestResult: true,
  selectionProbability: 1.0,
  shuffleExamples: false,
};

const LOCK_TIMEOUT = 30_000; // 30 seconds
const LOCK_STALE_THRESHOLD = 60_000; // 1 minute

export class SessionManager {
  private readonly finsliparnDir: string;
  private readonly sessionsDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.finsliparnDir = join(projectRoot, ".finsliparn");
    this.sessionsDir = join(this.finsliparnDir, "sessions");
  }

  private getLockPath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), ".lock");
  }

  private async acquireLock(sessionId: string): Promise<void> {
    const lockPath = this.getLockPath(sessionId);
    const lockData = { pid: process.pid, timestamp: Date.now() };

    // Check for existing lock
    try {
      const existingLock = await Bun.file(lockPath).text();
      const existing = JSON.parse(existingLock);
      const age = Date.now() - existing.timestamp;

      if (age < LOCK_STALE_THRESHOLD) {
        throw new Error(
          `Session ${sessionId} is locked by process ${existing.pid}`
        );
      }
      log.warn("Removing stale lock", {
        sessionId,
        age,
        stalePid: existing.pid,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("is locked by process")
      ) {
        throw error;
      }
      // Lock file doesn't exist or is invalid, continue
    }

    // Create lock file
    await mkdir(this.getSessionDir(sessionId), { recursive: true });
    await Bun.write(lockPath, JSON.stringify(lockData));
    log.debug("Lock acquired", { sessionId, pid: process.pid });
  }

  private async releaseLock(sessionId: string): Promise<void> {
    const lockPath = this.getLockPath(sessionId);
    try {
      await rm(lockPath);
      log.debug("Lock released", { sessionId });
    } catch {
      // Lock file already removed
    }
  }

  async withLock<T>(
    sessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    let acquired = false;

    while (Date.now() - startTime < LOCK_TIMEOUT) {
      try {
        await this.acquireLock(sessionId);
        acquired = true;
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("is locked by process")
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        throw error;
      }
    }

    if (!acquired) {
      throw new Error(`Timeout waiting for lock on session ${sessionId}`);
    }

    try {
      return await operation();
    } finally {
      await this.releaseLock(sessionId);
    }
  }

  async createSession(
    taskDescription: string,
    config: Partial<SessionConfig> = {}
  ): Promise<RefinementSession> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    const session: RefinementSession = {
      id: randomUUID(),
      taskDescription,
      status: "initializing",
      createdAt: new Date(),
      updatedAt: new Date(),
      maxIterations: finalConfig.maxIterations,
      currentIteration: 0,
      iterations: [],
      mergeThreshold: finalConfig.mergeThreshold,
    };

    await this.persistSession(session);
    log.info("Session created", { sessionId: session.id, taskDescription });
    return session;
  }

  async loadSession(sessionId: string): Promise<RefinementSession | null> {
    try {
      const statePath = this.getSessionStatePath(sessionId);
      const content = await Bun.file(statePath).text();
      const data = JSON.parse(content);
      // Convert date strings back to Date objects
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        iterations: data.iterations.map((it: IterationResult) => ({
          ...it,
          timestamp: new Date(it.timestamp),
        })),
      };
    } catch (error) {
      log.debug("Failed to load session", { sessionId, error: String(error) });
      return null;
    }
  }

  async persistSession(session: RefinementSession): Promise<void> {
    const dir = this.getSessionDir(session.id);
    await mkdir(dir, { recursive: true });

    const statePath = this.getSessionStatePath(session.id);
    await Bun.write(statePath, JSON.stringify(session, null, 2));
  }

  async updateSessionStatus(
    sessionId: string,
    status: SessionStatus
  ): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const previousStatus = session.status;
    session.status = status;
    session.updatedAt = new Date();
    await this.persistSession(session);
    log.info("Session status changed", {
      sessionId,
      from: previousStatus,
      to: status,
    });
  }

  async addIteration(
    sessionId: string,
    iteration: IterationResult
  ): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.iterations.push(iteration);
    session.currentIteration = iteration.iteration;
    session.updatedAt = new Date();

    // Also save iteration details separately
    const iterDir = join(this.getSessionDir(sessionId), "iterations");
    await mkdir(iterDir, { recursive: true });
    const iterPath = join(iterDir, `${iteration.iteration}.json`);
    await Bun.write(iterPath, JSON.stringify(iteration, null, 2));

    await this.persistSession(session);
    log.debug("Iteration added", {
      sessionId,
      iteration: iteration.iteration,
      score: iteration.score,
    });
  }

  async getLatestIteration(sessionId: string): Promise<IterationResult | null> {
    const session = await this.loadSession(sessionId);
    if (!session || session.iterations.length === 0) {
      return null;
    }
    const iter = session.iterations.at(-1);
    return iter ?? null;
  }

  async updateBestResult(
    sessionId: string,
    iteration: number,
    score: number
  ): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.bestScore === undefined || score > session.bestScore) {
      const previousBest = session.bestScore;
      session.bestIteration = iteration;
      session.bestScore = score;
      session.updatedAt = new Date();
      await this.persistSession(session);
      log.info("New best result", {
        sessionId,
        iteration,
        score,
        previousBest,
      });
    }
  }

  async getActiveSession(): Promise<RefinementSession | null> {
    try {
      const sessionIds = await readdir(this.sessionsDir);
      for (const sessionId of sessionIds) {
        const session = await this.loadSession(sessionId);
        if (session && ["initializing", "iterating"].includes(session.status)) {
          return session;
        }
      }
    } catch {
      // Sessions directory doesn't exist yet
    }
    return null;
  }

  async listSessions(): Promise<string[]> {
    try {
      return await readdir(this.sessionsDir);
    } catch {
      // Sessions directory doesn't exist yet
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(sessionId);
    await rm(sessionDir, { recursive: true, force: true });
    log.info("Session deleted", { sessionId });
  }

  private getSessionDir(sessionId: string): string {
    return join(this.sessionsDir, sessionId);
  }

  private getSessionStatePath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), "state.json");
  }
}
