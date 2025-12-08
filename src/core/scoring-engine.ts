import type {
  DiffAnalysis,
  ScoreBreakdown,
  ScorePenalty,
  ScoreWeights,
  TestResults,
} from "../types";

const DEFAULT_WEIGHTS: ScoreWeights = {
  testPass: 1.0,
  complexityPenalty: 0.1,
};

export type ScoreResult = {
  score: number;
  passRate: number;
  breakdown: ScoreBreakdown;
};

export class ScoringEngine {
  private readonly weights: ScoreWeights;

  constructor(weights?: Partial<ScoreWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  calculatePassRate(testResults: TestResults): number {
    if (testResults.total === 0) {
      return 0;
    }
    return (testResults.passed / testResults.total) * 100;
  }

  calculateScore(
    testResults: TestResults,
    diffAnalysis?: DiffAnalysis
  ): ScoreResult {
    const testPassRate = this.calculatePassRate(testResults);
    const testPassScore = testPassRate * this.weights.testPass;
    const penalties: ScorePenalty[] = [];

    let totalPenalty = 0;

    if (diffAnalysis) {
      const complexityDeduction = Math.round(
        diffAnalysis.complexityScore * this.weights.complexityPenalty
      );
      if (complexityDeduction > 0) {
        penalties.push({
          reason: `High complexity (${diffAnalysis.complexity})`,
          deduction: complexityDeduction,
          details: `${diffAnalysis.insertions + diffAnalysis.deletions} changes across ${diffAnalysis.filesChanged.length} files`,
        });
        totalPenalty += complexityDeduction;
      }
    }

    if (testPassRate < 100) {
      const failedTests = testResults.total - testResults.passed;
      const testPenalty = Math.round(100 - testPassRate);
      penalties.push({
        reason: "Failing tests",
        deduction: testPenalty,
        details: `${failedTests} of ${testResults.total} tests failing`,
      });
    }

    const rawScore = testPassScore - totalPenalty;
    const final = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      score: final,
      passRate: Math.round(testPassRate * 100) / 100,
      breakdown: {
        base: 100,
        testPassRate: Math.round(testPassRate * 100) / 100,
        penalties,
        final,
      },
    };
  }

  getScore(testResults: TestResults, diffAnalysis?: DiffAnalysis): number {
    return this.calculateScore(testResults, diffAnalysis).score;
  }

  getBreakdown(
    testResults: TestResults,
    diffAnalysis?: DiffAnalysis
  ): ScoreBreakdown {
    return this.calculateScore(testResults, diffAnalysis).breakdown;
  }
}
