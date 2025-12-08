import type { TestFailure, TestResults } from "../types";

/**
 * Calculates soft scores (0.0-1.0) for test failures based on
 * how close the actual value is to the expected value.
 *
 * Inspired by Poetiq's ARC-AGI solver which gives partial credit
 * for "almost correct" solutions.
 */
export class SoftScorer {
  /**
   * Calculate soft score for a single test failure.
   * Returns 0.0-1.0 based on similarity between expected and actual.
   */
  calculateFailureSoftScore(failure: TestFailure): number {
    if (!(failure.expected && failure.actual)) {
      return 0;
    }

    const expected = failure.expected.trim();
    const actual = failure.actual.trim();

    if (expected === actual) {
      return 1.0;
    }

    // Try numeric comparison first
    const numericScore = this.compareNumeric(expected, actual);
    if (numericScore !== null) {
      return numericScore;
    }

    // Try JSON/object comparison
    const jsonScore = this.compareJson(expected, actual);
    if (jsonScore !== null) {
      return jsonScore;
    }

    // Fall back to string similarity
    return this.compareStrings(expected, actual);
  }

  /**
   * Calculate aggregate soft score for all test results.
   * Combines passing tests (1.0 each) with partial credit for failures.
   */
  calculateTestResultsSoftScore(results: TestResults): number {
    if (results.total === 0) {
      return 0;
    }

    let totalScore = results.passed; // Each pass is worth 1.0

    for (const failure of results.failures) {
      const softScore = this.calculateFailureSoftScore(failure);
      failure.softScore = softScore;
      totalScore += softScore;
    }

    return totalScore / results.total;
  }

  /**
   * Compare numeric values, giving partial credit based on proximity.
   * Returns null if values aren't numeric.
   */
  private compareNumeric(expected: string, actual: string): number | null {
    const expectedNum = this.parseNumber(expected);
    const actualNum = this.parseNumber(actual);

    if (expectedNum === null || actualNum === null) {
      return null;
    }

    if (expectedNum === actualNum) {
      return 1.0;
    }

    // Calculate relative error
    const maxVal = Math.max(Math.abs(expectedNum), Math.abs(actualNum), 1);
    const relativeError = Math.abs(expectedNum - actualNum) / maxVal;

    // Convert to score: 0% error = 1.0, 100%+ error = 0.0
    return Math.max(0, 1 - relativeError);
  }

  /**
   * Compare JSON objects/arrays, giving partial credit for matching fields.
   * Returns null if values aren't valid JSON.
   */
  private compareJson(expected: string, actual: string): number | null {
    let expectedObj: unknown;
    let actualObj: unknown;

    try {
      expectedObj = JSON.parse(expected);
      actualObj = JSON.parse(actual);
    } catch {
      return null;
    }

    return this.compareObjects(expectedObj, actualObj);
  }

  /**
   * Recursively compare objects/arrays and calculate similarity score.
   */
  private compareObjects(expected: unknown, actual: unknown): number {
    if (expected === actual) {
      return 1.0;
    }

    if (typeof expected !== typeof actual) {
      return 0;
    }

    if (Array.isArray(expected) && Array.isArray(actual)) {
      return this.compareArrays(expected, actual);
    }

    if (typeof expected === "object" && expected !== null && actual !== null) {
      return this.compareObjectFields(
        expected as Record<string, unknown>,
        actual as Record<string, unknown>
      );
    }

    if (typeof expected === "number" && typeof actual === "number") {
      const maxVal = Math.max(Math.abs(expected), Math.abs(actual), 1);
      return Math.max(0, 1 - Math.abs(expected - actual) / maxVal);
    }

    if (typeof expected === "string" && typeof actual === "string") {
      return this.compareStrings(expected, actual);
    }

    return expected === actual ? 1.0 : 0;
  }

  /**
   * Compare arrays element by element.
   */
  private compareArrays(expected: unknown[], actual: unknown[]): number {
    if (expected.length === 0 && actual.length === 0) {
      return 1.0;
    }

    const maxLength = Math.max(expected.length, actual.length);
    let totalScore = 0;

    for (let i = 0; i < maxLength; i++) {
      if (i >= expected.length || i >= actual.length) {
        // Missing element = 0 score for that position
        continue;
      }
      totalScore += this.compareObjects(expected[i], actual[i]);
    }

    return totalScore / maxLength;
  }

  /**
   * Compare object fields.
   */
  private compareObjectFields(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>
  ): number {
    const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

    if (allKeys.size === 0) {
      return 1.0;
    }

    let totalScore = 0;

    for (const key of allKeys) {
      if (!(key in expected && key in actual)) {
        // Missing key = 0 score for that field
        continue;
      }
      totalScore += this.compareObjects(expected[key], actual[key]);
    }

    return totalScore / allKeys.size;
  }

  /**
   * Compare strings using Levenshtein distance normalized by length.
   */
  private compareStrings(expected: string, actual: string): number {
    if (expected === actual) {
      return 1.0;
    }

    if (expected.length === 0 || actual.length === 0) {
      return 0;
    }

    const distance = this.levenshteinDistance(expected, actual);
    const maxLength = Math.max(expected.length, actual.length);

    return Math.max(0, 1 - distance / maxLength);
  }

  /**
   * Calculate Levenshtein edit distance between two strings.
   */
  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = [];

    for (let i = 0; i <= m; i++) {
      dp[i] = [i];
    }
    for (let j = 0; j <= n; j++) {
      dp[0] = dp[0] ?? [];
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      const row = dp[i];
      if (!row) {
        break;
      }
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(
          (row[j - 1] ?? 0) + 1,
          (dp[i - 1]?.[j] ?? 0) + 1,
          (dp[i - 1]?.[j - 1] ?? 0) + cost
        );
      }
    }

    return dp[m]?.[n] ?? 0;
  }

  /**
   * Parse a string as a number, handling various formats.
   */
  private parseNumber(value: string): number | null {
    // Remove quotes if present
    const cleaned = value.replace(/^["']|["']$/g, "").trim();

    // Handle booleans
    if (cleaned === "true") {
      return 1;
    }
    if (cleaned === "false") {
      return 0;
    }

    const num = Number(cleaned);
    return Number.isNaN(num) ? null : num;
  }
}
