import type { QualityAnalysis, QualitySignal } from "../types";

const DIFF_FILE_PATTERN = /b\/(.+)$/;
const FUNCTION_PATTERN = /^\s*\w+\s*\(.*\)\s*{/;
const FUNCTION_NAME_PATTERN = /function\s+(\w+)/;
const CONST_FUNCTION_PATTERN = /const\s+(\w+)\s*=/;
const BARE_FUNCTION_PATTERN = /(\w+)\s*\(/;
const MAGIC_NUMBER_PATTERN = /[^\w](\d{2,})[^\w]/;

export class QualityAnalyzer {
  private readonly LARGE_FUNCTION_THRESHOLD = 50;
  private readonly LONG_LINE_THRESHOLD = 120;
  private readonly NESTED_DEPTH_THRESHOLD = 4;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Line-by-line diff analysis requires sequential checks
  analyze(diff: string): QualityAnalysis {
    const signals: QualitySignal[] = [];
    const lines = diff.split("\n");

    let currentFile = "";
    let addedLines: string[] = [];
    let currentFunction = "";
    let functionLineCount = 0;
    let maxNesting = 0;
    let currentNesting = 0;

    for (const line of lines) {
      // Track current file
      if (line.startsWith("diff --git")) {
        if (addedLines.length > 0) {
          this.analyzeFunctionSize(
            currentFile,
            currentFunction,
            functionLineCount,
            signals
          );
        }
        const match = line.match(DIFF_FILE_PATTERN);
        currentFile = match?.[1] ?? "";
        addedLines = [];
        currentFunction = "";
        functionLineCount = 0;
        maxNesting = 0;
        currentNesting = 0;
        continue;
      }

      // Only analyze added lines
      if (!line.startsWith("+") || line.startsWith("+++")) {
        continue;
      }

      const content = line.slice(1);
      addedLines.push(content);

      // Track function definitions
      if (this.isFunctionDefinition(content)) {
        if (functionLineCount > 0) {
          this.analyzeFunctionSize(
            currentFile,
            currentFunction,
            functionLineCount,
            signals
          );
        }
        currentFunction = this.extractFunctionName(content);
        functionLineCount = 0;
        maxNesting = 0;
        currentNesting = 0;
      }

      if (currentFunction) {
        functionLineCount += 1;
      }

      // Check line length
      if (content.length > this.LONG_LINE_THRESHOLD) {
        signals.push({
          type: "long_line",
          severity: "warning",
          message: `Line exceeds ${this.LONG_LINE_THRESHOLD} characters (${content.length})`,
          file: currentFile,
          suggestion:
            "Consider breaking this line into multiple lines for better readability",
        });
      }

      // Track nesting depth
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      currentNesting += openBraces - closeBraces;
      maxNesting = Math.max(maxNesting, currentNesting);

      if (currentNesting > this.NESTED_DEPTH_THRESHOLD) {
        signals.push({
          type: "deep_nesting",
          severity: "warning",
          message: `Nesting depth of ${currentNesting} exceeds threshold`,
          file: currentFile,
          suggestion:
            "Consider extracting nested logic into separate functions",
        });
      }

      // Detect code smells
      this.detectCodeSmells(content, currentFile, signals);
    }

    // Check last function
    if (functionLineCount > 0) {
      this.analyzeFunctionSize(
        currentFile,
        currentFunction,
        functionLineCount,
        signals
      );
    }

    return {
      signals,
      score: this.calculateQualityScore(signals),
    };
  }

  private isFunctionDefinition(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("function ") ||
      (trimmed.startsWith("const ") && trimmed.includes("=>")) ||
      trimmed.startsWith("async ") ||
      FUNCTION_PATTERN.test(trimmed)
    );
  }

  private extractFunctionName(line: string): string {
    const match =
      line.match(FUNCTION_NAME_PATTERN) ||
      line.match(CONST_FUNCTION_PATTERN) ||
      line.match(BARE_FUNCTION_PATTERN);
    return match?.[1] ?? "anonymous";
  }

  private analyzeFunctionSize(
    file: string,
    functionName: string,
    lineCount: number,
    signals: QualitySignal[]
  ): void {
    if (lineCount > this.LARGE_FUNCTION_THRESHOLD) {
      signals.push({
        type: "large_function",
        severity: "warning",
        message: `Function '${functionName}' has ${lineCount} lines`,
        file,
        suggestion:
          "Consider breaking this function into smaller, focused functions",
      });
    }
  }

  private detectCodeSmells(
    line: string,
    file: string,
    signals: QualitySignal[]
  ): void {
    // Detect console.log (should use proper logging)
    if (line.includes("console.log") || line.includes("console.error")) {
      signals.push({
        type: "console_log",
        severity: "info",
        message: "Console statement detected",
        file,
        suggestion:
          "Consider using a proper logging framework or removing debug statements",
      });
    }

    // Detect TODO comments
    if (line.includes("TODO") || line.includes("FIXME")) {
      signals.push({
        type: "todo_comment",
        severity: "info",
        message: "TODO/FIXME comment found",
        file,
        suggestion: "Address or track this TODO in an issue tracker",
      });
    }

    // Detect any type usage in TypeScript
    if (line.includes(": any") || line.includes("<any>")) {
      signals.push({
        type: "any_type",
        severity: "warning",
        message: "Use of 'any' type detected",
        file,
        suggestion: "Replace 'any' with a specific type for better type safety",
      });
    }

    // Detect magic numbers (excluding 0, 1, and numbers in test files)
    if (!(file.includes("test.ts") || file.includes("spec.ts"))) {
      const magicNumberMatch = line.match(MAGIC_NUMBER_PATTERN);
      if (magicNumberMatch && magicNumberMatch[1] !== "100") {
        signals.push({
          type: "magic_number",
          severity: "info",
          message: `Magic number '${magicNumberMatch[1]}' detected`,
          file,
          suggestion: "Consider extracting this number into a named constant",
        });
      }
    }
  }

  private calculateQualityScore(signals: QualitySignal[]): number {
    const weights = {
      large_function: -10,
      deep_nesting: -8,
      any_type: -5,
      long_line: -3,
      console_log: -2,
      magic_number: -2,
      todo_comment: -1,
    };

    const penalty = signals.reduce(
      (total, signal) => total + (weights[signal.type] ?? 0),
      0
    );

    // Base score is 100, subtract penalties, minimum 0
    return Math.max(0, 100 + penalty);
  }
}
