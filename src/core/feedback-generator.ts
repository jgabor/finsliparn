import type {
  DirectiveContext,
  IterationSummary,
  QualityAnalysis,
  SolutionMemory,
  TestResults,
} from "../types";

export type FeedbackOptions = {
  improvingOrder: boolean; // Show worst→best (default: true)
  maxSolutions: number; // Max prior solutions to include (default: 5)
  useXmlFormat: boolean; // Use XML tags for structure (default: true)
  useInlineDiff: boolean; // Show visual inline diff for expected/actual (default: true)
  selectionProbability: number; // Probability of including each prior solution (default: 1.0)
  shuffleExamples: boolean; // Randomize feedback order (default: false)
  seed?: number; // Seed for deterministic randomness
};

const DEFAULT_OPTIONS: FeedbackOptions = {
  improvingOrder: true,
  maxSolutions: 5,
  useXmlFormat: true,
  useInlineDiff: true,
  selectionProbability: 1.0,
  shuffleExamples: false,
};

/**
 * Simple seeded PRNG (linear congruential generator) for deterministic randomness.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed % 2_147_483_647;
  if (state <= 0) {
    state += 2_147_483_646;
  }

  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
}

/**
 * Fisher-Yates shuffle with optional seeded randomness.
 */
function shuffleArray<T>(array: T[], random: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate visual inline diff showing expected/actual side by side.
 * Format: `expected_char/actual_char` for mismatches.
 */
function generateInlineDiff(expected: string, actual: string): string {
  if (expected === actual) {
    return expected;
  }

  // Try to parse as JSON for structured diff
  try {
    const expectedObj = JSON.parse(expected);
    const actualObj = JSON.parse(actual);
    return generateStructuredDiff(expectedObj, actualObj);
  } catch {
    // Fall back to character-level diff
  }

  return generateCharacterDiff(expected, actual);
}

function generateCharacterDiff(expected: string, actual: string): string {
  const maxLen = Math.max(expected.length, actual.length);
  const result: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const expectedChar = expected[i] ?? "∅";
    const actualChar = actual[i] ?? "∅";

    if (expectedChar === actualChar) {
      result.push(expectedChar);
    } else {
      result.push(`[${actualChar}/${expectedChar}]`);
    }
  }

  return result.join("");
}

function generateStructuredDiff(expected: unknown, actual: unknown): string {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return generateArrayDiff(expected, actual);
  }

  if (
    typeof expected === "object" &&
    expected !== null &&
    typeof actual === "object" &&
    actual !== null
  ) {
    return generateObjectDiff(
      expected as Record<string, unknown>,
      actual as Record<string, unknown>
    );
  }

  if (expected === actual) {
    return String(expected);
  }

  return `${JSON.stringify(actual)}/${JSON.stringify(expected)}`;
}

function generateArrayDiff(expected: unknown[], actual: unknown[]): string {
  const maxLen = Math.max(expected.length, actual.length);
  const parts: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    if (i >= expected.length) {
      parts.push(`+${JSON.stringify(actual[i])}`);
    } else if (i >= actual.length) {
      parts.push(`-${JSON.stringify(expected[i])}`);
    } else if (JSON.stringify(expected[i]) === JSON.stringify(actual[i])) {
      parts.push(JSON.stringify(expected[i]));
    } else {
      parts.push(`${JSON.stringify(actual[i])}/${JSON.stringify(expected[i])}`);
    }
  }

  return `[${parts.join(", ")}]`;
}

function generateObjectDiff(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): string {
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const parts: string[] = [];

  for (const key of allKeys) {
    if (!(key in expected)) {
      parts.push(`+${key}: ${JSON.stringify(actual[key])}`);
    } else if (!(key in actual)) {
      parts.push(`-${key}: ${JSON.stringify(expected[key])}`);
    } else if (JSON.stringify(expected[key]) === JSON.stringify(actual[key])) {
      parts.push(`${key}: ${JSON.stringify(expected[key])}`);
    } else {
      parts.push(
        `${key}: ${JSON.stringify(actual[key])}/${JSON.stringify(expected[key])}`
      );
    }
  }

  return `{${parts.join(", ")}}`;
}

export class FeedbackGenerator {
  private readonly options: FeedbackOptions;
  private readonly random: () => number;

  constructor(options: Partial<FeedbackOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.random =
      this.options.seed !== undefined
        ? createSeededRandom(this.options.seed)
        : Math.random;
  }

  generate(context: DirectiveContext): Promise<string> {
    const {
      latestIteration,
      nextActions,
      constraints,
      history,
      qualityAnalysis,
      priorSolutions,
    } = context;

    let feedback = `# Iteration ${latestIteration.iteration} Feedback\n\n`;

    // Score section
    if (latestIteration.score !== undefined) {
      feedback += `**Score**: ${latestIteration.score}%\n\n`;
    }

    // Test results section
    if (latestIteration.testResults) {
      feedback += this.generateTestResultsSection(latestIteration.testResults);
    }

    // Quality analysis section (only when tests pass)
    if (qualityAnalysis && latestIteration.testResults?.failed === 0) {
      feedback += this.generateQualitySection(qualityAnalysis);
    }

    // Prior solutions section (Poetiq-style)
    if (priorSolutions && priorSolutions.length > 0) {
      feedback += this.generateSolutionsSection(priorSolutions);
    } else if (history && history.length > 0) {
      // Fallback to basic history if no solutions
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
    section += `**Duration**: ${testResults.duration}ms\n`;

    if (testResults.softScore !== undefined) {
      section += `**Soft Score**: ${(testResults.softScore * 100).toFixed(1)}%\n`;
    }

    section += "\n";

    if (testResults.failures.length === 0) {
      return section;
    }

    section += "### Failed Tests\n\n";
    for (const failure of testResults.failures) {
      section += this.formatFailure(failure);
    }

    return section;
  }

  private formatFailure(failure: TestResults["failures"][0]): string {
    let section = `#### ${failure.name}\n`;

    if (failure.file) {
      const location = failure.line
        ? `${failure.file}:${failure.line}`
        : failure.file;
      section += `- **File**: ${location}\n`;
    }

    section += `- **Message**: ${failure.message}\n`;
    section += this.formatExpectedActual(failure);

    if (failure.softScore !== undefined) {
      section += `- **Partial Credit**: ${(failure.softScore * 100).toFixed(1)}%\n`;
    }

    section += "\n";
    return section;
  }

  private formatExpectedActual(failure: TestResults["failures"][0]): string {
    if (failure.expected && failure.actual && this.options.useInlineDiff) {
      const inlineDiff = generateInlineDiff(failure.expected, failure.actual);
      return `- **Diff** (actual/expected): \`${inlineDiff}\`\n`;
    }

    let section = "";
    if (failure.expected) {
      section += `- **Expected**: ${failure.expected}\n`;
    }
    if (failure.actual) {
      section += `- **Actual**: ${failure.actual}\n`;
    }
    return section;
  }

  private generateHistorySection(history: IterationSummary[]): string {
    let sorted = [...history];
    if (this.options.improvingOrder) {
      sorted = sorted.sort((a, b) => a.score - b.score);
    }

    let section = "## Iteration History\n\n";
    for (const item of sorted) {
      section += `**Iteration ${item.iteration}** (Score: ${item.score}%)\n`;
      section += `${item.summary}\n\n`;
    }
    return section;
  }

  private generateSolutionsSection(solutions: SolutionMemory[]): string {
    let selected = this.selectSolutions(solutions);

    if (this.options.improvingOrder) {
      selected = selected.sort((a, b) => a.score - b.score);
    }

    if (this.options.shuffleExamples) {
      selected = shuffleArray(selected, this.random);
    }

    let section = "## Prior Solutions\n\n";

    if (this.options.useXmlFormat) {
      for (let i = 0; i < selected.length; i++) {
        const solution = selected[i];
        section += `<solution_${i + 1}>\n`;
        section += `<solution_code>\n\`\`\`\n${solution.code}\n\`\`\`\n</solution_code>\n`;
        section += `<solution_evaluation>${solution.feedback}</solution_evaluation>\n`;
        section += `<solution_score>${solution.score}</solution_score>\n`;
        section += `</solution_${i + 1}>\n\n`;
      }
    } else {
      for (let i = 0; i < selected.length; i++) {
        const solution = selected[i];
        section += `### Solution ${i + 1} (Score: ${solution.score}%)\n\n`;
        section += `**Code:**\n\`\`\`\n${solution.code}\n\`\`\`\n\n`;
        section += `**Evaluation:** ${solution.feedback}\n\n`;
      }
    }

    return section;
  }

  private selectSolutions(solutions: SolutionMemory[]): SolutionMemory[] {
    const limited = solutions.slice(0, this.options.maxSolutions);

    if (this.options.selectionProbability >= 1.0) {
      return limited;
    }

    return limited.filter(
      () => this.random() < this.options.selectionProbability
    );
  }

  private generateQualitySection(analysis: QualityAnalysis): string {
    let section = "## Code Quality Analysis\n\n";
    section += `**Quality Score**: ${analysis.score}/100\n\n`;

    if (analysis.signals.length === 0) {
      section += "No quality issues detected. Great work!\n\n";
      return section;
    }

    const errors = analysis.signals.filter((s) => s.severity === "error");
    const warnings = analysis.signals.filter((s) => s.severity === "warning");
    const info = analysis.signals.filter((s) => s.severity === "info");

    if (errors.length > 0) {
      section += "### Errors\n\n";
      for (const signal of errors) {
        section += `- **${signal.file}**: ${signal.message}\n`;
        section += `  - ${signal.suggestion}\n\n`;
      }
    }

    if (warnings.length > 0) {
      section += "### Warnings\n\n";
      for (const signal of warnings) {
        section += `- **${signal.file}**: ${signal.message}\n`;
        section += `  - ${signal.suggestion}\n\n`;
      }
    }

    if (info.length > 0) {
      section += "### Suggestions\n\n";
      for (const signal of info) {
        section += `- **${signal.file}**: ${signal.message}\n`;
        section += `  - ${signal.suggestion}\n\n`;
      }
    }

    return section;
  }
}
