import type { DiffAnalysis, ScoreWeights, TestResults } from "../types";

const DEFAULT_WEIGHTS: ScoreWeights = {
  testPass: 1.0,
  complexityPenalty: 0.1,
};

export type ScoreResult = {
  score: number;
  passRate: number;
  breakdown: {
    testPassScore: number;
    complexityPenalty: number;
  };
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
    const passRate = this.calculatePassRate(testResults);
    const testPassScore = passRate * this.weights.testPass;

    let complexityPenalty = 0;
    if (diffAnalysis) {
      complexityPenalty =
        diffAnalysis.complexityScore * this.weights.complexityPenalty;
    }

    const rawScore = testPassScore - complexityPenalty;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      score,
      passRate: Math.round(passRate * 100) / 100,
      breakdown: {
        testPassScore: Math.round(testPassScore * 100) / 100,
        complexityPenalty: Math.round(complexityPenalty * 100) / 100,
      },
    };
  }

  getScore(testResults: TestResults, diffAnalysis?: DiffAnalysis): number {
    return this.calculateScore(testResults, diffAnalysis).score;
  }
}
