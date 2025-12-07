import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  TestFailure,
  TestResults,
  TestRunner,
  TestRunOptions,
} from "../types";

const NOT_OK_PATTERN = /not ok \d+ - (.+)/;
const PASS_COUNT_PATTERN = /^\s*(\d+)\s+pass(?:ed)?(?:\s|$)/m;
const FAIL_COUNT_PATTERN = /^\s*(\d+)\s+fail(?:ed)?(?:\s|$)/m;
const DURATION_PATTERN = /Ran\s+\d+\s+tests?\s+.*?\[(\d+(?:\.\d+)?)\s*ms\]/;
const PASS_MARKER_PATTERN = /^\s*ok\s+\d+/;
const FAIL_MARKER_PATTERN = /^\s*not ok\s+\d+/;
const CHECK_MARK_PATTERN = /[✗✕]\s*(.+)/;
const STACK_TRACE_PATTERN = /at\s+.*?\s+\((.+):(\d+):\d+\)/;
const FILE_LINE_PATTERN = /^\s+(.+):(\d+):\d+$/;
const EXPECTED_PATTERN = /[Ee]xpected:\s*(.+)/;
const ACTUAL_PATTERN = /[Rr]eceived:\s*(.+)/;

export class BunTestRunner implements TestRunner {
  name = "bun";

  detect(cwd: string): Promise<boolean> {
    // Check if bun is available and there's a bun config or test files
    const bunLock = existsSync(join(cwd, "bun.lock"));
    const hasTestFiles =
      existsSync(join(cwd, "**/*.test.ts")) ||
      existsSync(join(cwd, "**/*.test.js"));
    return Promise.resolve(bunLock || hasTestFiles);
  }

  run(options: TestRunOptions): Promise<TestResults> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn("bun", ["test"], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        timeout: options.timeout,
      });

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", () => {
        const results = this.parseOutput(stdout, stderr);
        results.stdout = stdout;
        results.stderr = stderr;
        resolve(results);
      });

      proc.on("error", (error: Error) => {
        reject(error);
      });
    });
  }

  private saveCurrentFailure(
    currentFailure: TestFailure | null,
    errorBuffer: string[],
    failures: TestFailure[]
  ): void {
    if (currentFailure) {
      currentFailure.message =
        errorBuffer.join("\n").trim() || currentFailure.message;
      failures.push(currentFailure);
    }
  }

  private extractErrorDetails(line: string, failure: TestFailure): void {
    const fileMatch =
      line.match(STACK_TRACE_PATTERN) || line.match(FILE_LINE_PATTERN);
    if (fileMatch && !failure.file) {
      failure.file = fileMatch[1] ?? "";
      failure.line = Number.parseInt(fileMatch[2] ?? "0", 10);
    }

    const expectedMatch = line.match(EXPECTED_PATTERN);
    if (expectedMatch) {
      failure.expected = expectedMatch[1]?.trim();
    }

    const actualMatch = line.match(ACTUAL_PATTERN);
    if (actualMatch) {
      failure.actual = actualMatch[1]?.trim();
    }
  }

  private classifyLine(line: string): "pass" | "fail" | "other" {
    if (
      line.includes("✓") ||
      line.includes("(pass)") ||
      PASS_MARKER_PATTERN.test(line)
    ) {
      return "pass";
    }
    if (
      line.includes("✗") ||
      line.includes("(fail)") ||
      FAIL_MARKER_PATTERN.test(line)
    ) {
      return "fail";
    }
    return "other";
  }

  private parseSummary(
    combined: string,
    lineByLineCount: { passed: number; failed: number }
  ): {
    passed: number;
    failed: number;
    duration: number;
  } {
    let passed = 0;
    let failed = 0;

    const passMatch = combined.match(PASS_COUNT_PATTERN);
    const failMatch = combined.match(FAIL_COUNT_PATTERN);

    if (passMatch?.[1] !== undefined) {
      passed = Number.parseInt(passMatch[1], 10);
    }
    if (failMatch?.[1] !== undefined) {
      failed = Number.parseInt(failMatch[1], 10);
    }

    if (
      passed === 0 &&
      failed === 0 &&
      (lineByLineCount.passed > 0 || lineByLineCount.failed > 0)
    ) {
      passed = lineByLineCount.passed;
      failed = lineByLineCount.failed;
    }

    let duration = 0;
    const durationMatch = combined.match(DURATION_PATTERN);
    if (durationMatch?.[1] !== undefined) {
      duration = Number.parseFloat(durationMatch[1]);
    }

    return { passed, failed, duration };
  }

  private extractTestName(line: string): string {
    const tapMatch = line.match(NOT_OK_PATTERN);
    const checkMatch = line.match(CHECK_MARK_PATTERN);
    return tapMatch?.[1] || checkMatch?.[1]?.trim() || line.trim();
  }

  parseOutput(stdout: string, stderr: string): TestResults {
    // Parse Bun test output - combines stdout and stderr since Bun writes to both
    const combined = `${stdout}\n${stderr}`;
    const lines = combined.split("\n");

    let passed = 0;
    let failed = 0;
    const failures: TestFailure[] = [];
    let currentFailure: TestFailure | null = null;
    let errorBuffer: string[] = [];

    for (const line of lines) {
      const lineType = this.classifyLine(line);

      if (lineType === "pass") {
        this.saveCurrentFailure(currentFailure, errorBuffer, failures);
        currentFailure = null;
        errorBuffer = [];
        passed += 1;
        continue;
      }

      if (lineType === "fail") {
        this.saveCurrentFailure(currentFailure, errorBuffer, failures);
        failed += 1;
        errorBuffer = [];
        currentFailure = {
          name: this.extractTestName(line),
          file: "",
          message: line,
        };
        continue;
      }

      if (currentFailure) {
        this.extractErrorDetails(line, currentFailure);
        if (line.trim()) {
          errorBuffer.push(line);
        }
      }
    }

    // Don't forget the last failure
    this.saveCurrentFailure(currentFailure, errorBuffer, failures);

    const summary = this.parseSummary(combined, { passed, failed });

    return {
      framework: "bun",
      passed: summary.passed,
      failed: summary.failed,
      total: summary.passed + summary.failed,
      duration: summary.duration,
      failures,
    };
  }
}

export async function detectTestRunner(cwd: string): Promise<TestRunner> {
  const runners = [new BunTestRunner()];

  for (const runner of runners) {
    // eslint-disable-next-line no-await-in-loop
    if (await runner.detect(cwd)) {
      return runner;
    }
  }

  throw new Error("No supported test runner detected");
}
