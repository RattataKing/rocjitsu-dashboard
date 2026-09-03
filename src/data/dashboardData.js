import { compareRunExecution, isRunCompleted, sortRunsByCommit } from './runOrdering';

export function loadDashboardData() {
  const raw = window.ROCJITSU_BENCHMARK_DATA;

  if (!raw || !Array.isArray(raw.runs) || !Array.isArray(raw.testCatalog)) {
    throw new Error('Expected window.ROCJITSU_BENCHMARK_DATA from data.js');
  }

  const invalidRun = raw.runs.find((run) => (
    !run.runId
    || !Number.isFinite(Date.parse(run.timestamp))
    || !Number.isFinite(Date.parse(run.commitTimestamp))
    || run.branch !== 'develop'
    || !['auto', 'manual'].includes(run.trigger)
    || !run.environmentId
    || !run.configurationId
  ));
  if (invalidRun) {
    throw new Error(`Run ${invalidRun.runId ?? '(unknown)'} is not a valid official develop run`);
  }

  const runs = [...raw.runs].sort(compareRunExecution);
  const latestCommitRun = sortRunsByCommit(runs).at(-1) ?? null;
  const latestCompletedRun = sortRunsByCommit(runs.filter(isRunCompleted)).at(-1) ?? null;

  return {
    ...raw,
    runs,
    latestRun: runs.at(-1) ?? null,
    latestCommitRun,
    latestCompletedRun,
    targets: Array.isArray(raw.targets) ? raw.targets : [],
    suites: [...new Set(raw.testCatalog.map((test) => test.suite))].sort(),
  };
}
