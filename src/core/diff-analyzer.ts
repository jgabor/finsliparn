import type { DiffAnalysis } from "../types";

type DiffHunk = {
  file: string;
  insertions: number;
  deletions: number;
};

export const IGNORED_FILE_PATTERNS = [
  /^bun\.lock(b)?$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^\.env/,
  /^\.finsliparn\//,
];

export class DiffAnalyzer {
  private readonly thresholds = {
    lowComplexity: 50,
    mediumComplexity: 150,
  };

  private shouldIgnoreFile(file: string): boolean {
    return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(file));
  }

  async analyze(cwd: string, base?: string): Promise<DiffAnalysis> {
    const hunks = await this.getGitDiffWithFallback(cwd, base);

    const filesChanged = hunks.map((h) => h.file);
    const insertions = hunks.reduce((sum, h) => sum + h.insertions, 0);
    const deletions = hunks.reduce((sum, h) => sum + h.deletions, 0);

    const totalChanges = insertions + deletions;
    const complexity = this.calculateComplexity(
      totalChanges,
      filesChanged.length
    );
    const complexityScore = this.calculateComplexityScore(
      totalChanges,
      filesChanged.length
    );

    return {
      filesChanged,
      insertions,
      deletions,
      complexity,
      complexityScore,
    };
  }

  async getRawDiff(cwd: string, base?: string): Promise<string> {
    const strategies = base ? [base] : ["HEAD~1", "HEAD", "--staged", ""];

    for (const strategy of strategies) {
      const proc = Bun.spawn(["git", "diff", strategy], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode === 0 && stdout.trim()) {
        return stdout;
      }
    }

    return "";
  }

  private async getGitDiffWithFallback(
    cwd: string,
    base?: string
  ): Promise<DiffHunk[]> {
    const strategies = base ? [base] : ["HEAD~1", "HEAD", "--staged", ""];

    for (const strategy of strategies) {
      const hunks = await this.getGitDiff(cwd, strategy);
      if (hunks.length > 0) {
        return hunks;
      }
    }

    return [];
  }

  private async getGitDiff(cwd: string, base: string): Promise<DiffHunk[]> {
    const proc = Bun.spawn(["git", "diff", "--numstat", base], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return [];
    }

    return this.parseNumstat(stdout);
  }

  private parseNumstat(output: string): DiffHunk[] {
    const lines = output.trim().split("\n").filter(Boolean);
    return lines
      .map((line) => {
        const parts = line.split("\t");
        const file = parts[2] ?? "";
        return {
          file,
          insertions:
            parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10),
          deletions:
            parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10),
        };
      })
      .filter((hunk) => !this.shouldIgnoreFile(hunk.file));
  }

  private calculateComplexity(
    totalChanges: number,
    fileCount: number
  ): "low" | "medium" | "high" {
    const changeScore = totalChanges;
    const spreadPenalty = fileCount > 5 ? (fileCount - 5) * 10 : 0;
    const score = changeScore + spreadPenalty;

    if (score <= this.thresholds.lowComplexity) {
      return "low";
    }
    if (score <= this.thresholds.mediumComplexity) {
      return "medium";
    }
    return "high";
  }

  private calculateComplexityScore(
    totalChanges: number,
    fileCount: number
  ): number {
    const changeScore = Math.min(totalChanges, 500);
    const spreadPenalty = Math.min(fileCount * 5, 50);
    return Math.round(changeScore * 0.15 + spreadPenalty);
  }
}
