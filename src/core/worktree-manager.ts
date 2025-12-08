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
      // Create worktree with a new branch to avoid checkout conflicts
      // Git doesn't allow the same branch to be checked out in multiple worktrees
      await git.raw([
        "worktree",
        "add",
        "-B",
        branchName,
        worktreePath,
        baseBranch,
      ]);
      log.info("Worktree created with new branch", {
        branchName,
        worktreePath,
        baseBranch,
      });
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

  async listSessionWorktreePaths(): Promise<string[]> {
    const worktreePaths: string[] = [];
    const topLevelDirs = await this.listWorktrees();

    for (const topDir of topLevelDirs) {
      const topPath = join(this.worktreesDir, topDir);
      try {
        const sessionDirs = await readdir(topPath);
        for (const sessionDir of sessionDirs) {
          const sessionPath = join(topPath, sessionDir);
          try {
            const iterationDirs = await readdir(sessionPath);
            for (const iterDir of iterationDirs) {
              worktreePaths.push(join(topDir, sessionDir, iterDir));
            }
          } catch {
            worktreePaths.push(join(topDir, sessionDir));
          }
        }
      } catch {
        worktreePaths.push(topDir);
      }
    }

    return worktreePaths;
  }

  async deleteWorktreeByPath(relativePath: string): Promise<void> {
    const git = simpleGit(this.projectRoot);
    const worktreePath = join(this.worktreesDir, relativePath);

    try {
      await git.raw(["worktree", "remove", "--force", worktreePath]);
      log.info("Worktree deleted by path", { worktreePath });
    } catch (gitError) {
      log.warn("Git worktree remove failed, trying filesystem removal", {
        relativePath,
        error: String(gitError),
      });
      try {
        await rm(worktreePath, { recursive: true, force: true });
        await git.raw(["worktree", "prune"]);
        log.info("Worktree deleted via filesystem", { worktreePath });
      } catch (fsError) {
        log.error("Worktree deletion failed completely", {
          relativePath,
          gitError: String(gitError),
          fsError: String(fsError),
        });
        throw new Error(
          `Failed to delete worktree: git error: ${gitError}, fs error: ${fsError}`
        );
      }
    }
  }

  async cleanEmptyDirectories(): Promise<void> {
    const topLevelDirs = await this.listWorktrees();

    for (const topDir of topLevelDirs) {
      const topPath = join(this.worktreesDir, topDir);
      try {
        const sessionDirs = await readdir(topPath);
        for (const sessionDir of sessionDirs) {
          const sessionPath = join(topPath, sessionDir);
          try {
            const contents = await readdir(sessionPath);
            if (contents.length === 0) {
              await rm(sessionPath, { recursive: true });
              log.debug("Removed empty session directory", { sessionPath });
            }
          } catch {
            // Not a directory or doesn't exist
          }
        }
        const remainingDirs = await readdir(topPath);
        if (remainingDirs.length === 0) {
          await rm(topPath, { recursive: true });
          log.debug("Removed empty top-level directory", { topPath });
        }
      } catch {
        // Not a directory or doesn't exist
      }
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
