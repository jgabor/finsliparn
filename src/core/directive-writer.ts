import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  DirectiveContext,
  IterationResult,
  RefinementSession,
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
