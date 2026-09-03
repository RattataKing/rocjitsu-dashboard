# RocJitsu Dashboard Data Requirements

> [!IMPORTANT]
> **Action required for the data producer (schema version 3):** publish only official `develop`-branch runs with `trigger: 'auto'` or `trigger: 'manual'`. Experimental data must be rejected upstream. The former `canonical` field has been removed. For extensible metadata, new producers should use ordered `{ key, value }` benchmark configuration items and optional ordered `provenance.details` items.

## Changes from the previous contract

This is the migration checklist from the previous/legacy producer format to the format currently consumed by the dashboard. Items marked **REQUIRED** can prevent the whole dashboard from loading or can produce incorrect ordering and comparisons. Items marked **RECOMMENDED** improve accuracy or make future data extensible without a UI rebuild.

| Area | Previous/legacy format | Current schema version 3 | Producer action |
| --- | --- | --- | --- |
| Published run scope | `canonical` distinguished official and experimental runs | The feed contains only official `develop` runs; `canonical` is not consumed | **REMOVE:** omit `canonical`, publish `branch: 'develop'`, and reject experiments upstream |
| Trigger names | Producer-specific values such as `push`, `nightly`, or other labels | Exactly `auto` or `manual` | **REQUIRED:** normalize the trigger before publishing |
| Run identity | A commit SHA could be treated as one result | Every workflow attempt has its own `runId`; multiple attempts for one SHA are retained | **REQUIRED:** use a unique attempt ID and never deduplicate by commit SHA |
| Time | One timestamp could represent both commit and execution time | `timestamp` is execution completion time; `commitTimestamp` is tested-commit time | **REQUIRED:** emit both timestamps and preserve the old commit time for historical reruns |
| Commit ordering | Commit time alone | Optional numeric `commitOrder`, then `commitTimestamp` as fallback | **RECOMMENDED:** emit branch-monotonic `commitOrder`, especially when commit time does not represent ancestry |
| Comparison scope | Runs could be compared without an explicit environment/configuration boundary | Comparisons require equal `branch`, `environmentId`, and `configurationId` | **REQUIRED:** populate stable `environmentId` and `configurationId` on every run |
| Provenance | Fixed named fields such as `rocmSdkVersion` and `torchVersion` | Ordered `provenance.details[]` entries with `{ key, label, value }` | **RECOMMENDED:** migrate to `details`; legacy named fields remain display-compatible |
| Benchmark configuration | UI-specific fixed fields only | Ordered `test.configuration[]` entries with `{ key, value }` | **RECOMMENDED:** emit the generic array; legacy fields remain the fallback |
| Expected test count | Top-level `expectedTestsPerRun` could be emitted | Not consumed; coverage is derived from each run's `tests` | **REMOVE:** omit `expectedTestsPerRun` from new output |
| Derived metrics | Could be prepared by the data producer | Durations, baselines, deltas, coverage, classifications, and pagination are computed by the UI | **DO NOT EMIT:** publish facts only |

The loader rejects the complete snapshot if **any** run is missing or violates one of these current run-level acceptance fields:

- `runId`
- valid `timestamp`
- valid `commitTimestamp`
- `branch: 'develop'`
- `trigger: 'auto'` or `trigger: 'manual'`
- non-empty `environmentId`
- non-empty `configurationId`

A representative migration looks like this:

```diff
 window.ROCJITSU_BENCHMARK_DATA = {
-  schemaVersion: 2,
-  expectedTestsPerRun: 21,
+  schemaVersion: 3,
   runs: [{
-    runId: '0123456789abcdef',
-    timestamp: '2026-08-15T09:12:00.000Z',
-    trigger: 'nightly',
-    canonical: true,
+    runId: 'github-123499999-attempt-1',
+    timestamp: '2026-09-02T15:30:00.000Z',
+    commitTimestamp: '2026-08-15T09:12:00.000Z',
+    commitOrder: 1764,
+    trigger: 'manual',
+    branch: 'develop',
+    environmentId: 'rocm-7.2-gfx1250',
+    configurationId: 'clocked-default',
     provenance: {
       rocjitsuCommitSha: '0123456789abcdef0123456789abcdef01234567',
-      rocmSdkVersion: '7.2.0',
-      torchVersion: '2.9.0+rocm7.2',
+      details: [
+        { key: 'rocmSdkVersion', label: 'ROCm SDK', value: '7.2.0' },
+        { key: 'torchVersion', label: 'PyTorch', value: '2.9.0+rocm7.2' },
+      ],
     },
     tests: [{
       testId: 'gfx1250:triton-gemm-f16-1024',
       logicalTestId: 'triton-gemm-f16-1024',
+      configuration: [
+        { key: 'operation', value: 'GEMM' },
+        { key: 'dataType', value: 'FP16' },
+        { key: 'm', value: 1024 },
+        { key: 'n', value: 1024 },
+        { key: 'k', value: 1024 },
+      ],
       durationSeconds: 2.051,
       status: 'completed',
     }],
   }],
 };
```

## Commit-aware behavior

- `runId` is the unique result identity. Never deduplicate runs by commit SHA.
- Multiple attempts for the same SHA are valid and must all be retained.
- Overview uses the newest execution attempt belonging to the newest commit; an incomplete newest attempt is shown as incomplete rather than replaced by an older completed run.
- Recent Runs is ordered by `timestamp` (execution time).
- Performance Trend uses execution time for `1D` and tested-commit time for `1W` through `All`. Late historical reruns are omitted from this Overview chart.
- Aggregate Benchmark Explorer retains every attempt, including late historical reruns, in commit order and identifies attempts by `runId`.
- Benchmark Explorer and automatic baseline selection use commit chronology.
- Overview run-level automatic comparisons use the latest fully completed attempt from the nearest earlier commit in the same branch, environment, and configuration.
- Recent Runs uses the same commit chronology, but evaluates baseline completeness only for tests included by the active global target and suite filters. Failures outside that selected scope do not disqualify the baseline.
- Benchmark Run History compares each result with the latest completed result for the same stable `testId` from an earlier commit in that comparison scope. Failures in unrelated benchmarks do not disqualify that result-level baseline.
- A newer completed rerun of that earlier commit is allowed to update the baseline and therefore recalculate the latest commit's performance change.
- Latest Results, overview metrics, and Largest Changes use the Overview run-level baseline rule. Run Comparison is explicitly user-selected.
- If no earlier completed run exists in the comparison scope, change is unavailable. A positive duration change is slower; a negative change is faster.
- A manual run of an older commit must use its original `commitTimestamp` and its current execution `timestamp`.
- `commitOrder` is optional but recommended. When supplied, it must increase along the benchmark branch and is preferred over `commitTimestamp` for ordering.
- Auto and manual runs are both official dashboard inputs. Official/experimental filtering is an upstream responsibility; `canonical` is no longer part of the web contract.

## Minimal `data.js` example

```js
window.ROCJITSU_BENCHMARK_DATA = {
  schemaVersion: 3,
  generatedAt: '2026-09-02T12:30:00.000Z',
  repository: 'https://github.com/ROCm/rocm-systems',
  isDemo: true,

  targets: ['gfx1250'],

  testCatalog: [
    {
      id: 'triton-gemm-f16-1024',
      suite: 'Triton',
      name: 'GEMM FP16 1024³',
      operation: 'GEMM',
      dataType: 'fp16',
      problem: { m: 1024, n: 1024, k: 1024 },
      execMode: 'clocked',
      numThreads: 1,
    },
  ],

  runs: [
    {
      runId: 'github-123456789-attempt-1',
      // When this benchmark execution completed.
      timestamp: '2026-09-02T12:00:00.000Z',
      // Timestamp/order of the tested RocJitsu commit, not the workflow run.
      commitTimestamp: '2026-09-02T10:42:00.000Z',
      commitOrder: 1842,
      trigger: 'auto',
      machineId: 'sjc-rocjitsu-perf-01',
      branch: 'develop',
      environmentId: 'rocm-7.2-gfx1250',
      configurationId: 'clocked-default',

      provenance: {
        rocjitsuCommitSha: '0123456789abcdef0123456789abcdef01234567',
        commitMessage: 'Improve clocked-mode batching',
        details: [
          { key: 'rocmSdkVersion', label: 'ROCm SDK', value: '7.2.0' },
          { key: 'pythonVersion', label: 'Python', value: '3.12.11' },
          { key: 'torchVersion', label: 'PyTorch', value: '2.9.0+rocm7.2' },
          { key: 'tritonCommitSha', label: 'Triton commit', value: '1234567890abcdef' },
          { key: 'tensileLiteCommitSha', label: 'TensileLite commit', value: 'abcdef1234567890' },
        ],
      },

      tests: [
        {
          testId: 'gfx1250:triton-gemm-f16-1024',
          logicalTestId: 'triton-gemm-f16-1024',
          suite: 'Triton',
          name: 'GEMM FP16 1024³',
          target: 'gfx1250',
          operation: 'GEMM',
          dataType: 'fp16',
          problem: { m: 1024, n: 1024, k: 1024 },
          execMode: 'clocked',
          numThreads: 1,
          configuration: [
            { key: 'operation', value: 'GEMM' },
            { key: 'dataType', value: 'FP16' },
            { key: 'm', value: 1024 },
            { key: 'n', value: 1024 },
            { key: 'k', value: 1024 },
            { key: 'executionMode', value: 'clocked' },
            { key: 'threads', value: 1 },
          ],
          durationSeconds: 2.051,
          status: 'completed',
          exitCode: 0,
          timedOut: false,
          error: null,
        },
      ],
    },
  ],
};
```

For a manual run performed on September 2 against an older August 15 commit, the run-level metadata must look like this (with the normal `provenance` and `tests` fields alongside it):

```js
{
  runId: 'github-123499999-attempt-1',
  timestamp: '2026-09-02T15:30:00.000Z',       // execution time: now
  commitTimestamp: '2026-08-15T09:12:00.000Z', // tested commit time: old
  commitOrder: 1764,                           // old position on develop
  trigger: 'manual',
  branch: 'develop',
  environmentId: 'rocm-7.2-gfx1250',
  configurationId: 'clocked-default',
}
```

## Output file

- Development: `public/data.js`
- Published site: `data.js`, beside `index.html`
- Must assign the complete snapshot to `window.ROCJITSU_BENCHMARK_DATA`
- Must be browser JavaScript, not an ES module

## Top-level fields

- `schemaVersion`: use `3`
- `generatedAt`: ISO-8601 UTC timestamp
- `repository`: repository URL used for links
- `isDemo`: use `false` for production
- `targets`: unique target names in the results
- `testCatalog`: unique logical benchmark definitions
- `runs`: retained normalized test runs

`expectedTestsPerRun` is a legacy field and is ignored by the current UI. Do not emit it in new schema-version-3 files; the UI derives coverage from each run's actual `tests` array under the active filters.

## Each `testCatalog` entry

- `id`: stable logical benchmark ID
- `suite`
- `name`
- `operation`
- `dataType`: normalized lowercase value
- `problem`: problem dimensions and parameters
- `execMode`
- `numThreads`

## Each run

- `runId`: unique workflow-attempt ID
- `timestamp`: required ISO-8601 UTC time when this benchmark execution completed
- **`commitTimestamp`: required ISO-8601 UTC timestamp of the tested RocJitsu commit; do not copy the run time for an older-commit rerun**
- `commitOrder`: optional numeric position on `branch`; recommended when commit timestamps do not reliably express branch ancestry
- **`trigger`: required; exactly `auto` or `manual`**
- `machineId`: optional stable machine identifier displayed in run details when available
- **`branch`: required and must be `develop`**
- **`environmentId`: required stable environment identifier used to prevent cross-environment comparisons**
- **`configurationId`: required stable benchmark-configuration identifier used to prevent incompatible comparisons**
- `provenance`
- `tests`

## Each run's `provenance`

- `rocjitsuCommitSha`: required; identifies the tested source revision
- `commitMessage`: optional
- `details`: optional ordered array of additional provenance items

Each `details` item contains:

- `key`: required stable identifier, unique within the run
- `label`: required human-readable label displayed by the UI
- `value`: string or number; omit the item when the value is unavailable

Use `details` for SDK, runtime, framework, compiler, dependency commit, and other environment metadata. New items are displayed automatically without a UI rebuild. Keep labels concise and keep the same key and label across runs. Do not place layout, color, or other presentation instructions in this array.

The UI ignores malformed entries and hides unavailable details. Schema-version-2 named provenance fields (`rocmSdkVersion`, `pythonVersion`, `torchVersion`, `tritonCommitSha`, and `tensileLiteCommitSha`) remain supported for previously generated data, but new producers should emit `details` instead.

## Each test result

- `testId`: `${target}:${logicalTestId}`
- `logicalTestId`: must match a `testCatalog[].id`
- `suite`
- `name`
- `target`
- `operation`
- `dataType`
- `problem`
- `execMode`
- `numThreads`
- `configuration`: optional ordered array of generic key/value configuration items displayed by the result details dialog
- `durationSeconds`: numeric seconds when completed; otherwise `null`
- `status`: `completed`, `failed`, or `timeout`
- `exitCode`: process exit code or `null`
- `timedOut`: boolean
- `error`: failure message or `null`

Each `configuration` item contains exactly:

- `key`: required stable identifier; camelCase, snake_case, and kebab-case are converted to a readable UI label
- `value`: string, number, or boolean; omit the item when its value is unavailable

New configuration keys are displayed automatically without a UI rebuild. Keep keys concise and stable across runs. Do not include labels, colors, layout instructions, nested objects, or arrays. When `configuration` is omitted for older data, the UI derives a compatibility view from `operation`, `dataType`, `problem`, `execMode`, and `numThreads`.

## Required normalization rules

- Keep `runId` unique across workflow attempts.
- Do not use the commit SHA as `runId`; the same commit may have many run attempts.
- Keep catalog IDs stable across all runs.
- Keep `testId` stable for the same target and logical benchmark.
- Include every test target in the top-level `targets` array.
- Use seconds, not milliseconds, for `durationSeconds`.
- Never use `0` as the duration of a failed or timed-out test.
- Publish only official `develop`-branch runs; reject experiment and feature-branch data upstream.
- Do not emit the obsolete `canonical` field.
- Normalize the trigger to exactly `auto` or `manual`.
- Preserve the tested commit's original `commitTimestamp` when rerunning an old commit.
- Populate `branch`, `environmentId`, and `configurationId` on every run.
- Use the same comparison-scope values only when two runs are genuinely comparable.
- Replace `data.js` atomically with a valid complete snapshot.
- Apply a history-retention limit, such as 180 or 365 days.

## Do not derive in `data.js`

The UI calculates these values:

- Aggregate duration
- Baseline and candidate comparisons
- Performance-change percentages
- Faster, slower, and noise classifications
- Largest changes
- Completion and reliability percentages
- Commit-day history grouping for non-1D Performance Trend ranges
- Pagination
- Graph labels, colors, and layout

## Data-only update flow

1. Collect raw test output and workflow metadata.
2. Normalize them into the fields above.
3. Merge the new run by `runId` with retained history; do not replace other attempts for the same SHA.
4. Validate IDs, execution and commit timestamps, the `develop` branch, normalized trigger, comparison scope, statuses, and durations.
5. Generate the complete `data.js` file.
6. Replace only `data.js` on the GitHub Pages publishing branch.

No React or Vite build is required for a data-only update.
