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
const SUMMARY_PATTERN = /(\d+) passed[,\s]+(\d+) failed/;

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

  parseOutput(stdout: string, _stderr: string): TestResults {
    // Parse Bun test output
    // Bun outputs TAP (Test Anything Protocol) format by default
    const lines = stdout.split("\n");

    let passed = 0;
    let failed = 0;
    const failures: TestFailure[] = [];

    for (const line of lines) {
      if (line.startsWith("ok ")) {
        passed += 1;
      } else if (line.startsWith("not ok ")) {
        failed += 1;
        // Extract test name from "not ok N - test name"
        const match = line.match(NOT_OK_PATTERN);
        const testName = match?.[1] || line;

        failures.push({
          name: testName,
          file: "",
          message: line,
        });
      }
    }

    // Look for summary line: "X passed, Y failed"
    const summaryMatch = stdout.match(SUMMARY_PATTERN);
    if (summaryMatch) {
      const passedStr = summaryMatch[1];
      const failedStr = summaryMatch[2];
      if (passedStr !== undefined && failedStr !== undefined) {
        passed = Number.parseInt(passedStr, 10);
        failed = Number.parseInt(failedStr, 10);
      }
    }

    const total = passed + failed;

    return {
      framework: "bun",
      passed,
      failed,
      total,
      duration: 0,
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
