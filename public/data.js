/*
 * RocJitsu dashboard data contract.
 *
 * This file is intentionally independent from the React bundle. Production
 * automation can replace only data.js after the UI has been built. Keep this
 * file limited to benchmark facts; labels, colors, layout, and derived metrics
 * belong to the application.
 */
(function () {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const start = Date.UTC(2026, 5, 1, 5, 30);
  const targets = ['gfx1250', 'gfx950', 'gfx1201'];
  const testCatalog = [
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
    {
      id: 'triton-gemm-bf16-4096',
      suite: 'Triton',
      name: 'GEMM BF16 4096³',
      operation: 'GEMM',
      dataType: 'bf16',
      problem: { m: 4096, n: 4096, k: 4096 },
      execMode: 'clocked',
      numThreads: 1,
    },
    {
      id: 'triton-softmax-f32-4096',
      suite: 'Triton',
      name: 'Softmax FP32 4096×4096',
      operation: 'Softmax',
      dataType: 'fp32',
      problem: { rows: 4096, columns: 4096 },
      execMode: 'clocked',
      numThreads: 1,
    },
    {
      id: 'triton-layernorm-bf16-8192',
      suite: 'Triton',
      name: 'LayerNorm BF16 8192',
      operation: 'LayerNorm',
      dataType: 'bf16',
      problem: { elements: 8192 },
      execMode: 'clocked',
      numThreads: 1,
    },
    {
      id: 'tensile-gemm-f16-8192',
      suite: 'TensileLite',
      name: 'GEMM FP16 8192×8192×4096',
      operation: 'GEMM',
      dataType: 'fp16',
      problem: { m: 8192, n: 8192, k: 4096 },
      execMode: 'clocked',
      numThreads: 1,
    },
    {
      id: 'tensile-gemm-fp8-4096',
      suite: 'TensileLite',
      name: 'GEMM FP8 4096³',
      operation: 'GEMM',
      dataType: 'fp8',
      problem: { m: 4096, n: 4096, k: 4096 },
      execMode: 'clocked',
      numThreads: 1,
    },
    {
      id: 'deepseek-v3-decode-fp8',
      suite: 'DeepSeek',
      name: 'DeepSeek V3 FP8 decode',
      operation: 'Decode',
      dataType: 'fp8',
      problem: { batchSize: 8, sequenceLength: 4096 },
      execMode: 'clocked',
      numThreads: 1,
    },
  ];

  const baseDurations = {
    gfx1250: [2.24, 11.8, 3.42, 4.18, 15.8, 8.5, 27.4],
    gfx950: [1.92, 10.3, 3.01, 3.72, 13.9, 7.36, 23.8],
    gfx1201: [2.05, 10.9, 3.18, 3.88, 14.65, 7.82, 25.2],
  };

  function demoSha(index) {
    let value = (index + 73) >>> 0;
    let result = '';
    for (let block = 0; block < 5; block += 1) {
      value = Math.imul(value ^ (0x9e3779b9 + block), 0x85ebca6b) >>> 0;
      value ^= value >>> 13;
      result += (value >>> 0).toString(16).padStart(8, '0');
    }
    return result.slice(0, 40);
  }

  function statusFor(dayIndex, target, testIndex) {
    if (dayIndex === 88 && target === 'gfx1250' && testIndex === 2) return 'timeout';
    if (dayIndex === 89 && target === 'gfx1250' && testIndex === 0) return 'failed';
    if (dayIndex === 87 && target === 'gfx1250' && testIndex === 5) return 'failed';
    if (dayIndex % 37 === 0 && target === 'gfx950' && testIndex === dayIndex % testCatalog.length) return 'timeout';
    if (dayIndex % 29 === 0 && target === 'gfx1201' && testIndex === (dayIndex + 2) % testCatalog.length) return 'failed';
    return 'completed';
  }

  function durationFor(base, dayIndex, targetIndex, testIndex) {
    const improvement = 1 - 0.00072 * dayIndex;
    const wave = 1 + Math.sin(dayIndex * 0.29 + testIndex * 0.67 + targetIndex) * 0.008;
    const regressionWindow = dayIndex >= 51 && dayIndex <= 57 ? 1.052 : 1;
    let latestChange = 1;
    if (dayIndex === 91 && testIndex === 1) latestChange = 1.071;
    if (dayIndex === 91 && testIndex === 4) latestChange = 0.946;
    if (dayIndex === 91 && testIndex === 6) latestChange = 1.038;
    return Number((base * improvement * wave * regressionWindow * latestChange).toFixed(3));
  }

  function configurationFor(definition) {
    return [
      { key: 'operation', value: definition.operation },
      { key: 'dataType', value: definition.dataType.toUpperCase() },
      ...Object.entries(definition.problem).map(([key, value]) => ({ key, value })),
      { key: 'executionMode', value: definition.execMode },
      { key: 'threads', value: definition.numThreads },
      { key: 'warmupIterations', value: 5 },
    ];
  }

  const runs = Array.from({ length: 92 }, (_, dayIndex) => {
    const timestamp = new Date(start + dayIndex * DAY).toISOString();
    const sha = demoSha(dayIndex);
    const tests = targets.flatMap((target, targetIndex) =>
      testCatalog.map((definition, testIndex) => {
        const status = statusFor(dayIndex, target, testIndex);
        return {
          testId: `${target}:${definition.id}`,
          logicalTestId: definition.id,
          suite: definition.suite,
          name: definition.name,
          target,
          operation: definition.operation,
          dataType: definition.dataType,
          problem: definition.problem,
          execMode: definition.execMode,
          numThreads: definition.numThreads,
          configuration: configurationFor(definition),
          durationSeconds: status === 'completed'
            ? durationFor(baseDurations[target][testIndex], dayIndex, targetIndex, testIndex)
            : null,
          status,
          exitCode: status === 'completed' ? 0 : status === 'timeout' ? 124 : 1,
          timedOut: status === 'timeout',
          error: status === 'failed'
            ? 'Simulation exited before producing a valid timing result'
            : status === 'timeout'
              ? 'Benchmark exceeded its configured timeout'
              : null,
        };
      }),
    );

    return {
      runId: `benchmark-${timestamp.replace(/\D/g, '').slice(0, 12)}-${sha.slice(0, 8)}`,
      timestamp,
      commitTimestamp: timestamp,
      commitOrder: dayIndex,
      trigger: 'auto',
      machineId: 'sjc-rocjitsu-perf-01',
      branch: 'develop',
      environmentId: 'rocm-7.2-demo',
      configurationId: 'clocked-default',
      provenance: {
        rocjitsuCommitSha: sha,
        commitMessage: [
          'Reduce simulator dispatch overhead',
          'Refine wavefront scheduling behavior',
          'Tune memory-system defaults',
          'Improve clocked-mode batching',
        ][dayIndex % 4],
        details: [
          { key: 'rocmSdkVersion', label: 'ROCm SDK', value: dayIndex < 31 ? '7.2.0.dev202606' : dayIndex < 62 ? '7.2.0.dev202607' : '7.2.0.dev202608' },
          { key: 'pythonVersion', label: 'Python', value: '3.12.11' },
          { key: 'torchVersion', label: 'PyTorch', value: '2.9.0a0+rocm7.2' },
          { key: 'tritonCommitSha', label: 'Triton commit', value: '91f34ba7d15e' },
          { key: 'tensileLiteCommitSha', label: 'TensileLite commit', value: 'b3c19e8a2a44' },
        ],
      },
      tests,
    };
  });

  const august31MorningRun = runs.at(-1);
  [
    {
      timestamp: '2026-08-31T13:10:00.000Z',
      commitTimestamp: '2026-08-31T12:42:00.000Z',
      sha: demoSha(92),
      commitMessage: 'Record performance after dispatch queue merge',
      durationFactor: 0.984,
      sdkOnly: true,
    },
    {
      timestamp: '2026-08-31T19:45:00.000Z',
      sha: demoSha(93),
      commitMessage: 'Validate follow-up scheduler tuning',
      durationFactor: 0.971,
    },
  ].forEach((attempt, attemptIndex) => {
    runs.push({
      ...august31MorningRun,
      runId: `benchmark-${attempt.timestamp.replace(/\D/g, '').slice(0, 12)}-${attempt.sha.slice(0, 8)}`,
      timestamp: attempt.timestamp,
      commitTimestamp: attempt.commitTimestamp ?? attempt.timestamp,
      commitOrder: 92 + attemptIndex,
      trigger: 'auto',
      provenance: attempt.sdkOnly
        ? {
            rocjitsuCommitSha: attempt.sha,
            commitMessage: attempt.commitMessage,
            details: [
              { key: 'rocmSdkVersion', label: 'ROCm SDK', value: '7.2.0.dev202608' },
            ],
          }
        : {
            ...august31MorningRun.provenance,
            rocjitsuCommitSha: attempt.sha,
            commitMessage: attempt.commitMessage,
      },
      tests: august31MorningRun.tests.map((test, testIndex) => ({
        ...test,
        durationSeconds: Number((test.durationSeconds * (
          (attempt.durationFactor + Math.sin(testIndex + attemptIndex) * 0.002)
          * (attemptIndex === 1
            ? ({ 1: 1.06, 4: 0.94, 6: 1.05 }[testIndex % testCatalog.length] ?? 1)
            : 1)
        )).toFixed(3)),
      })),
    });
  });

  // A manual validation performed now for an older commit. It remains newest
  // by execution time but stays beside its original commit in commit history.
  const oldCommitSource = runs[75];
  runs.push({
    ...oldCommitSource,
    runId: 'benchmark-202609010115-8418072e-manual',
    timestamp: '2026-09-01T01:15:00.000Z',
    trigger: 'manual',
    provenance: {
      rocjitsuCommitSha: oldCommitSource.provenance.rocjitsuCommitSha,
      commitMessage: oldCommitSource.provenance.commitMessage,
      details: [
        { key: 'rocmSdkVersion', label: 'ROCm SDK', value: '7.2.0.dev202608' },
      ],
    },
    tests: oldCommitSource.tests.map((test, testIndex) => ({
      ...test,
      durationSeconds: Number((test.durationSeconds * (1.004 + Math.sin(testIndex) * 0.001)).toFixed(3)),
    })),
  });

  window.ROCJITSU_BENCHMARK_DATA = {
    schemaVersion: 3,
    generatedAt: '2026-09-01T06:35:00Z',
    repository: 'https://github.com/ROCm/rocm-systems',
    isDemo: true,
    targets,
    testCatalog,
    runs,
  };
})();
