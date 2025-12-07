import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  IterationResult,
  RefinementSession,
  SessionConfig,
  SessionStatus,
} from "../types";

const DEFAULT_CONFIG: SessionConfig = {
  maxIterations: 5,
  timeout: 300_000, // 5 min
  parallelExperts: false,
};

export class SessionManager {
  private readonly finsliparnDir: string;
  private readonly sessionsDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.finsliparnDir = join(projectRoot, ".finsliparn");
    this.sessionsDir = join(this.finsliparnDir, "sessions");
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
    };

    await this.persistSession(session);
    return session;
  }

  async loadSession(sessionId: string): Promise<RefinementSession | null> {
    try {
      const statePath = this.getSessionStatePath(sessionId);
      const content = await readFile(statePath, "utf-8");
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
    } catch {
      return null;
    }
  }

  async persistSession(session: RefinementSession): Promise<void> {
    const dir = this.getSessionDir(session.id);
    await mkdir(dir, { recursive: true });

    const statePath = this.getSessionStatePath(session.id);
    await writeFile(statePath, JSON.stringify(session, null, 2));
  }

  async updateSessionStatus(
    sessionId: string,
    status: SessionStatus
  ): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = status;
    session.updatedAt = new Date();
    await this.persistSession(session);
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
    await writeFile(iterPath, JSON.stringify(iteration, null, 2));

    await this.persistSession(session);
  }

  async getLatestIteration(sessionId: string): Promise<IterationResult | null> {
    const session = await this.loadSession(sessionId);
    if (!session || session.iterations.length === 0) {
      return null;
    }
    const iter = session.iterations.at(-1);
    return iter ?? null;
  }

  private getSessionDir(sessionId: string): string {
    return join(this.sessionsDir, sessionId);
  }

  private getSessionStatePath(sessionId: string): string {
    return join(this.getSessionDir(sessionId), "state.json");
  }
}
