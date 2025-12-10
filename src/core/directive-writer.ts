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

  async write(context: DirectiveContext): Promise<void> {
    const directive = await this.buildDirective(context);
    const directivePath = join(this.finsliparnDir, "directive.md");

    await mkdir(this.finsliparnDir, { recursive: true });
    await Bun.write(directivePath, directive);
  }

  private async buildDirective(context: DirectiveContext): Promise<string> {
    const { session, latestIteration } = context;

    let content = "# Finsliparn Directive\n\n";

    // Status
    content += `**Status**: ${session.status.toUpperCase()}\n`;
    content += `**Session ID**: ${session.id}\n`;
    content += `**Iteration**: ${latestIteration.iteration}/${session.maxIterations}\n`;

    // Working directory (where to make changes)
    if (context.workingDirectory) {
      content += `**Working Directory**: \`${context.workingDirectory}\`\n`;
    }
    content += "\n";

    // Score
    if (latestIteration.score !== undefined) {
      content += `**Score**: ${latestIteration.score}%\n\n`;
    }

    // Merge eligibility warning
    const eligibility = isMergeEligible(session, latestIteration);
    if (!eligibility.canMerge) {
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

      // Auto-continue instruction
      content += "## ⚠️ Auto-Continue Required\n\n";
      content += "You MUST:\n";
      content += "1. Make code improvements NOW\n";
      content += "2. Call `finslipa_check` immediately after\n\n";
      content +=
        "Do NOT report status and wait. Do NOT ask for confirmation.\n\n";
    }

    // Plateau warning
    const plateau = detectPlateau(session);
    if (plateau.detected) {
      content += buildPlateauWarning(plateau, latestIteration.score);
    }

    // Task description
    content += `## Task\n\n${session.taskDescription}\n\n`;

    // Spec hints (if any)
    if (context.specHints && context.specHints.length > 0) {
      content += "## Reference Documentation\n\n";
      content += "Review these files for requirements and specifications:\n\n";
      for (const specPath of context.specHints) {
        content += `- \`${specPath}\`\n`;
      }
      content += "\n";
    }

    // Latest feedback
    const feedback = await this.feedbackGenerator.generate(context);
    content += feedback;

    // Required actions
    if (context.nextActions.length > 0) {
      content += "\n## Required Actions\n\n";
      for (let i = 0; i < context.nextActions.length; i++) {
        content += `${i + 1}. ${context.nextActions[i]}\n`;
      }
    }

    return content;
  }
}
