import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DirectiveContext } from "../types";
import { FeedbackGenerator } from "./feedback-generator";

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
    await writeFile(directivePath, directive, "utf-8");
  }

  private async buildDirective(context: DirectiveContext): Promise<string> {
    const { session, latestIteration } = context;

    let content = "# Finsliparn Directive\n\n";

    // Status
    content += `**Status**: ${session.status.toUpperCase()}\n`;
    content += `**Session ID**: ${session.id}\n`;
    content += `**Iteration**: ${latestIteration.iteration}/${session.maxIterations}\n\n`;

    // Score
    if (latestIteration.score !== undefined) {
      content += `**Score**: ${latestIteration.score}%\n\n`;
    }

    // Task description
    content += `## Task\n\n${session.taskDescription}\n\n`;

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
