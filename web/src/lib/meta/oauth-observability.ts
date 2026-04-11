import { createHash } from "crypto";

export type ExactValueComparison = {
  exact: boolean;
  expectedLength: number;
  actualLength: number;
  firstDiffIndex: number;
  expectedSnippet: string | null;
  actualSnippet: string | null;
};

const DIFF_SNIPPET_RADIUS = 20;

function getDiffSnippet(value: string, index: number) {
  if (index < 0) {
    return null;
  }

  const start = Math.max(0, index - DIFF_SNIPPET_RADIUS);
  const end = Math.min(value.length, index + DIFF_SNIPPET_RADIUS);
  return value.slice(start, end);
}

export function compareExactValues(expected: string, actual: string): ExactValueComparison {
  const sharedLength = Math.min(expected.length, actual.length);
  let firstDiffIndex = -1;

  for (let index = 0; index < sharedLength; index += 1) {
    if (expected[index] !== actual[index]) {
      firstDiffIndex = index;
      break;
    }
  }

  if (firstDiffIndex === -1 && expected.length !== actual.length) {
    firstDiffIndex = sharedLength;
  }

  return {
    exact: firstDiffIndex === -1,
    expectedLength: expected.length,
    actualLength: actual.length,
    firstDiffIndex,
    expectedSnippet: getDiffSnippet(expected, firstDiffIndex),
    actualSnippet: getDiffSnippet(actual, firstDiffIndex),
  };
}

export function createOpaqueFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
