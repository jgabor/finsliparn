import type { DirectiveContext, IterationSummary, TestResults } from "../types";

export class FeedbackGenerator {
  generate(context: DirectiveContext): Promise<string> {
    const { latestIteration, nextActions, constraints, history } = context;

    let feedback = `# Iteration ${latestIteration.iteration} Feedback\n\n`;

    // Score section
    if (latestIteration.score !== undefined) {
      feedback += `**Score**: ${latestIteration.score}%\n\n`;
    }

    // Test results section
    if (latestIteration.testResults) {
      feedback += this.generateTestResultsSection(latestIteration.testResults);
    }

    // History section
    if (history && history.length > 0) {
      feedback += this.generateHistorySection(history);
    }

    // Constraints reminder
    if (constraints) {
      feedback += `## Constraints\n\n${constraints}\n\n`;
    }

    // Next steps
    if (nextActions.length > 0) {
      feedback += "## Next Steps\n\n";
      for (let i = 0; i < nextActions.length; i++) {
        feedback += `${i + 1}. ${nextActions[i]}\n`;
      }
    }

    return Promise.resolve(feedback);
  }

  private generateTestResultsSection(testResults: TestResults): string {
    let section = "## Test Results\n\n";
    section += `**Framework**: ${testResults.framework}\n`;
    section += `**Status**: ${testResults.passed}/${testResults.total} tests passing\n`;
    section += `**Duration**: ${testResults.duration}ms\n\n`;

    if (testResults.failures.length === 0) {
      return section;
    }

    section += "### Failed Tests\n\n";
    for (const failure of testResults.failures) {
      section += `#### ${failure.name}\n`;
      if (failure.file) {
        section += `- **File**: ${failure.file}`;
        if (failure.line) {
          section += `:${failure.line}`;
        }
        section += "\n";
      }
      section += `- **Message**: ${failure.message}\n`;
      if (failure.expected) {
        section += `- **Expected**: ${failure.expected}\n`;
      }
      if (failure.actual) {
        section += `- **Actual**: ${failure.actual}\n`;
      }
      section += "\n";
    }

    return section;
  }

  private generateHistorySection(history: IterationSummary[]): string {
    let section = "## Iteration History\n\n";
    for (const item of history) {
      section += `**Iteration ${item.iteration}** (Score: ${item.score}%)\n`;
      section += `${item.summary}\n\n`;
    }
    return section;
  }
}
