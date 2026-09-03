const COMPARISON_SCOPE_FIELDS = ['branch', 'environmentId', 'configurationId'];

function parsedTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function isRunCompleted(run) {
  if (run?.status) return ['completed', 'passed', 'success'].includes(run.status);
  return Array.isArray(run?.tests)
    && run.tests.length > 0
    && run.tests.every((test) => test.status === 'completed');
}

export function commitShaFor(run) {
  return run?.provenance?.rocjitsuCommitSha ?? '';
}

export function commitTimestampFor(run) {
  return run?.commitTimestamp ?? run?.timestamp;
}

export function sameComparisonScope(left, right) {
  return COMPARISON_SCOPE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

export function compareRunExecution(left, right) {
  return parsedTime(left?.timestamp) - parsedTime(right?.timestamp)
    || String(left?.runId ?? '').localeCompare(String(right?.runId ?? ''));
}

export function compareCommitPosition(left, right) {
  const leftSha = commitShaFor(left);
  const rightSha = commitShaFor(right);
  if (leftSha && leftSha === rightSha) return 0;

  const sameBranch = left?.branch != null && left.branch === right?.branch;
  if (sameBranch && Number.isFinite(left?.commitOrder) && Number.isFinite(right?.commitOrder)) {
    const orderDifference = left.commitOrder - right.commitOrder;
    if (orderDifference) return orderDifference;
  }

  const timeDifference = parsedTime(commitTimestampFor(left)) - parsedTime(commitTimestampFor(right));
  return timeDifference || leftSha.localeCompare(rightSha);
}

export function compareRunsByCommit(left, right) {
  return compareCommitPosition(left, right)
    || compareRunExecution(left, right);
}

export function sortRunsByCommit(runs) {
  return [...runs].sort(compareRunsByCommit);
}

export function isOlderCommit(run, latestCommitRun) {
  return Boolean(run && latestCommitRun && compareCommitPosition(run, latestCommitRun) < 0);
}

export function isBackfillRun(run, comparisonRuns) {
  const references = Array.isArray(comparisonRuns) ? comparisonRuns : [comparisonRuns];
  return references.some((reference) => (
    isOlderCommit(run, reference)
    && compareRunExecution(run, reference) > 0
  ));
}
