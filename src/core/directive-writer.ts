import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  DirectiveContext,
  IterationResult,
  RefinementSession,
  ScorePenalty,
} from "../types";
import { FeedbackGenerator } from "./feedback-generator";

function isMergeEligible(
  session: RefinementSession,
  latestIteration: IterationResult
): { canMerge: boolean; completedIterations: number } {
  const completedIterations = session.iterations.filter(
    (iter) => iter.status === "completed" && iter.score !== undefined
  ).length;

  const isPerfectScore =
    latestIteration.score === 100 &&
    latestIteration.testResults?.failed === 0 &&
    (latestIteration.testResults?.passed ?? 0) > 0;

  return {
    canMerge: completedIterations >= 2 || isPerfectScore,
    completedIterations,
  };
}

type PlateauInfo = {
  detected: boolean;
  count: number;
  primaryPenalty?: ScorePenalty;
};

function detectPlateau(session: RefinementSession): PlateauInfo {
  const completed = session.iterations.filter(
    (iter) => iter.status === "completed" && iter.score !== undefined
  );

  if (completed.length < 2) {
    return { detected: false, count: 0 };
  }

  const scores = completed.map((iter) => iter.score ?? 0);
  const latestScore = scores.at(-1) ?? 0;

  let stagnantCount = 1;
  for (let i = scores.length - 2; i >= 0; i -= 1) {
    if (scores[i] === latestScore) {
      stagnantCount += 1;
    } else {
      break;
    }
  }

  const latestIteration = completed.at(-1);
  const primaryPenalty = latestIteration?.scoreBreakdown?.penalties[0];

  return {
    detected: stagnantCount >= 2,
    count: stagnantCount,
    primaryPenalty,
  };
}

function buildPenaltyGuidance(penalty: ScorePenalty): string {
  if (penalty.reason.includes("complexity")) {
    return (
      `- **Primary issue**: ${penalty.reason} (-${penalty.deduction} pts)\n` +
      "- **Action**: Reduce code complexity - extract functions, remove duplication, simplify logic\n" +
      "- **Goal**: Smaller, more focused changes will reduce the complexity penalty\n"
    );
  }
  if (penalty.reason.includes("test")) {
    return (
      `- **Primary issue**: ${penalty.reason} (-${penalty.deduction} pts)\n` +
      "- **Action**: Fix the failing tests before continuing\n"
    );
  }
  return (
    `- **Primary issue**: ${penalty.reason} (-${penalty.deduction} pts)\n` +
    "- **Action**: Address this penalty to improve the score\n"
  );
}

function buildPlateauWarning(
  plateau: PlateauInfo,
  score: number | undefined
): string {
  let content = "## 🚨 Score Plateau Detected\n\n";
  content += `Score has been **${score}%** for **${plateau.count} consecutive iterations**.\n\n`;
  content += "**You MUST try a different approach:**\n\n";

  if (plateau.primaryPenalty) {
    content += buildPenaltyGuidance(plateau.primaryPenalty);
  }

  content +=
    "\n**Previous iterations have NOT improved the score. Repeating the same approach will NOT work.**\n\n";
  return content;
}

export class DirectiveWriter {
  private readonly finsliparnDir: string;
  private readonly feedbackGenerator: FeedbackGenerator;

  constructor(projectRoot: string = process.cwd()) {
    this.finsliparnDir = join(projectRoot, ".finsliparn");
    this.feedbackGenerator = new FeedbackGenerator();
  }

  async write(context: DirectiveContext, expertId?: number): Promise<void> {
    const directive = await this.buildDirective(context, expertId);

    if (context.session.mode === "parallel" && expertId !== undefined) {
      await this.writeForExpert(directive, context.session.id, expertId);
    } else {
      const directivePath = join(this.finsliparnDir, "directive.md");
      await mkdir(this.finsliparnDir, { recursive: true });
      await Bun.write(directivePath, directive);
    }
  }

  private async writeForExpert(
    directive: string,
    sessionId: string,
    expertId: number
  ): Promise<void> {
    const directivesDir = join(
      this.finsliparnDir,
      "sessions",
      sessionId,
      "directives"
    );
    await mkdir(directivesDir, { recursive: true });
    const directivePath = join(directivesDir, `expert-${expertId}.md`);
    await Bun.write(directivePath, directive);
  }

  private getExpertStatusIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      default:
        return "🔄";
    }
  }

  async writeRaceSummary(session: RefinementSession): Promise<void> {
    if (session.mode !== "parallel" || !session.experts) {
      return;
    }

    let content = "# Race Summary\n\n";
    content += `**Session**: ${session.id}\n`;
    content += `**Experts**: ${session.expertCount}\n`;
    content += `**Status**: ${session.status.toUpperCase()}\n\n`;

    content += "## Scoreboard\n\n";
    content += "| Expert | Best Score | Iterations | Status |\n";
    content += "|--------|------------|------------|--------|\n";

    for (const expert of session.experts) {
      const completedCount = expert.iterations.filter(
        (i) => i.status === "completed"
      ).length;
      const statusIcon = this.getExpertStatusIcon(expert.status);
      const bestScoreStr =
        expert.bestScore !== undefined ? `${expert.bestScore}%` : "-";
      content += `| ${expert.id} | ${bestScoreStr} | ${completedCount} | ${statusIcon} ${expert.status} |\n`;
    }

    if (session.selectedIteration !== undefined) {
      content += "\n## Winner Selection\n\n";
      const winnerExpert = session.experts.find(
        (e) => e.id === session.selectedExpertId
      );
      if (winnerExpert) {
        content += `**Selected**: Expert ${winnerExpert.id}\n`;
        content += `**Score**: ${winnerExpert.bestScore}%\n`;
        content += `**Iteration**: ${session.selectedIteration}\n`;
      }
    }

    const racePath = join(
      this.finsliparnDir,
      "sessions",
      session.id,
      "race.md"
    );
    await mkdir(join(this.finsliparnDir, "sessions", session.id), {
      recursive: true,
    });
    await Bun.write(racePath, content);
  }

  private buildHeader(context: DirectiveContext, expertId?: number): string {
    const { session, latestIteration } = context;
    let content = "# Finsliparn Directive\n\n";
    content += `**Status**: ${session.status.toUpperCase()}\n`;
    content += `**Session ID**: ${session.id}\n`;
    if (session.mode === "parallel" && expertId !== undefined) {
      const expert = session.experts?.find((e) => e.id === expertId);
      content += `**Expert**: ${expertId} (seed: ${expert?.seed ?? "unknown"})\n`;
    }
    content += `**Iteration**: ${latestIteration.iteration}/${session.maxIterations}\n`;
    if (context.workingDirectory) {
      content += `**Working Directory**: \`${context.workingDirectory}\`\n`;
    }
    content += "\n";
    if (latestIteration.score !== undefined) {
      content += `**Score**: ${latestIteration.score}%\n\n`;
    }
    return content;
  }

  private buildMergeWarning(context: DirectiveContext): string {
    const { session, latestIteration } = context;
    const eligibility = isMergeEligible(session, latestIteration);
    if (eligibility.canMerge) {
      return "";
    }

    let content = "";
    const allTestsPassing =
      latestIteration.testResults?.failed === 0 &&
      (latestIteration.testResults?.total ?? 0) > 0;

    if (allTestsPassing) {
      content += "## ⚠️ Important\n\n";
      content +=
        "- DO NOT call `finslipa_merge` until score reaches 100% OR 2+ iterations complete\n";
      content +=
        "- DO NOT manually merge with git - use `finslipa_merge` to ensure proper tracking\n";
      content += `- Current: Score ${latestIteration.score}% | Iterations ${eligibility.completedIterations}/2 minimum | Remaining ${session.maxIterations - latestIteration.iteration}\n\n`;
    }

    content += "## ⚠️ Auto-Continue Required\n\n";
    content += "You MUST:\n";
    content += "1. Make code improvements NOW\n";
    content += "2. Call `finslipa_check` immediately after\n\n";
    content +=
      "Do NOT report status and wait. Do NOT ask for confirmation.\n\n";
    return content;
  }

  private async buildDirective(
    context: DirectiveContext,
    expertId?: number
  ): Promise<string> {
    const { session, latestIteration } = context;
    let content = this.buildHeader(context, expertId);

    content += this.buildMergeWarning(context);

    const plateau = detectPlateau(session);
    if (plateau.detected) {
      content += buildPlateauWarning(plateau, latestIteration.score);
    }

    content += `## Task\n\n${session.taskDescription}\n\n`;

    if (context.specHints && context.specHints.length > 0) {
      content += "## Reference Documentation\n\n";
      content += "Review these files for requirements and specifications:\n\n";
      for (const specPath of context.specHints) {
        content += `- \`${specPath}\`\n`;
      }
      content += "\n";
    }

    content += await this.feedbackGenerator.generate(context);

    if (context.nextActions.length > 0) {
      content += "\n## Required Actions\n\n";
      context.nextActions.forEach((action, i) => {
        content += `${i + 1}. ${action}\n`;
      });
    }

    return content;
  }
}
