import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { createLogger } from "./logger";

const log = createLogger("WorktreeManager");

export class WorktreeManager {
  private readonly projectRoot: string;
  private readonly worktreesDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.worktreesDir = join(projectRoot, ".finsliparn", "worktrees");
  }

  async createWorktree(
    branchName: string,
    baseBranch = "main"
  ): Promise<string> {
    const git = simpleGit(this.projectRoot);

    // Create worktrees directory
    await mkdir(this.worktreesDir, { recursive: true });

    const worktreePath = join(this.worktreesDir, branchName);

    try {
      // Create worktree from base branch
      await git.raw(["worktree", "add", worktreePath, baseBranch]);
      log.info("Worktree created", { branchName, worktreePath, baseBranch });
      return worktreePath;
    } catch (error) {
      log.error("Worktree creation failed", {
        branchName,
        worktreePath,
        error: String(error),
      });
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  async deleteWorktree(branchName: string): Promise<void> {
    const git = simpleGit(this.projectRoot);
    const worktreePath = join(this.worktreesDir, branchName);

    try {
      // Remove worktree
      await git.raw(["worktree", "remove", worktreePath]);
      log.info("Worktree deleted", { branchName, worktreePath });
    } catch (gitError) {
      log.warn("Git worktree remove failed, trying filesystem removal", {
        branchName,
        error: String(gitError),
      });
      // If worktree removal fails, try to force delete the directory
      try {
        await rm(worktreePath, { recursive: true, force: true });
        log.info("Worktree deleted via filesystem", {
          branchName,
          worktreePath,
        });
      } catch (fsError) {
        log.error("Worktree deletion failed completely", {
          branchName,
          gitError: String(gitError),
          fsError: String(fsError),
        });
        throw new Error(
          `Failed to delete worktree: git error: ${gitError}, fs error: ${fsError}`
        );
      }
    }
  }

  async listWorktrees(): Promise<string[]> {
    try {
      await mkdir(this.worktreesDir, { recursive: true });
      return await readdir(this.worktreesDir);
    } catch {
      return [];
    }
  }

  async cleanupWorktrees(): Promise<void> {
    const worktrees = await this.listWorktrees();
    const git = simpleGit(this.projectRoot);

    for (const worktree of worktrees) {
      try {
        const worktreePath = join(this.worktreesDir, worktree);
        // Try using prune first
        await git.raw(["worktree", "prune"]);
        // Then try to remove
        await git.raw(["worktree", "remove", worktreePath]);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  getWorktreePath(branchName: string): string {
    return join(this.worktreesDir, branchName);
  }
}
