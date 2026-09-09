import { compareRunExecution, isRunCompleted, sortRunsByCommit } from './runOrdering';

const CURRENT_SCHEMA_VERSION = 1;
const RUN_FILE_PATTERN = /^runs\/[A-Za-z0-9._-]+\.json$/;
const CATALOG_FILE_PATTERN = /^test-catalogs\/[A-Za-z0-9._-]+\.json$/;
const RUN_STATUSES = new Set(['completed', 'failed', 'timeout']);

function hasText(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEnvironmentDetail(detail) {
  return hasText(detail?.key)
    && hasText(detail?.label)
    && ['string', 'number', 'boolean'].includes(typeof detail?.value);
}

function environmentIdentity(environment) {
  return JSON.stringify(environment
    .map(({ key, value }) => [key, value])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function isTestDefinition(definition) {
  return hasText(definition?.id)
    && hasText(definition?.suite)
    && hasText(definition?.name)
    && isPlainObject(definition.problem)
    && Object.entries(definition.problem).every(([key, value]) => (
      hasText(key) && ['string', 'number', 'boolean'].includes(typeof value)
    ));
}

function normalizeCatalog(catalog, catalogPath) {
  if (
    !isPlainObject(catalog)
    || !hasText(catalog.id)
    || !Array.isArray(catalog.tests)
    || catalog.tests.length === 0
    || !isPlainObject(catalog.targets)
    || Object.keys(catalog.targets).length === 0
  ) {
    throw new Error(`Test catalog ${catalogPath} does not match the schema-version-${CURRENT_SCHEMA_VERSION} contract`);
  }

  const definitionIds = catalog.tests.map((definition) => definition?.id);
  if (
    catalog.tests.some((definition) => !isTestDefinition(definition))
    || new Set(definitionIds).size !== definitionIds.length
  ) {
    throw new Error(`Test catalog ${catalogPath} contains an invalid or duplicate test definition`);
  }

  const definitionIdSet = new Set(definitionIds);
  for (const [target, testIds] of Object.entries(catalog.targets)) {
    if (
      !hasText(target)
      || !Array.isArray(testIds)
      || testIds.length === 0
      || testIds.some((testId) => !hasText(testId) || !definitionIdSet.has(testId))
      || new Set(testIds).size !== testIds.length
    ) {
      throw new Error(`Test catalog ${catalogPath} contains an invalid test set for ${target || '(unknown target)'}`);
    }
  }

  return catalog;
}

function isFinding(finding) {
  return isPlainObject(finding)
    && hasText(finding.type)
    && hasText(finding.summary)
    && (!Object.hasOwn(finding, 'location') || hasText(finding.location));
}

function isPublishedResult(result) {
  return hasText(result?.testId)
    && RUN_STATUSES.has(result.status)
    && (result.status === 'completed'
      ? Number.isFinite(result.durationSeconds)
      : result.durationSeconds == null)
    && (!Object.hasOwn(result, 'findings')
      || (Array.isArray(result.findings) && result.findings.every(isFinding)));
}

function sameStringSet(left, right) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function normalizePublishedRun(run, catalog) {
  const source = run?.source;
  const execution = run?.execution;
  const environment = run?.environment;
  const plugin = run?.plugin;
  const targetGroups = run?.targets;
  const runLabel = hasText(run?.id) ? run.id : '(unknown)';

  if (
    !hasText(run?.id)
    || !hasText(run?.comparisonId)
    || !hasText(run?.testCatalog)
    || !plugin
    || !hasText(plugin.id)
    || !hasText(plugin.name)
    || (Object.hasOwn(plugin, 'version') && !hasText(plugin.version))
    || (Object.hasOwn(plugin, 'options') && !isPlainObject(plugin.options))
    || !source
    || !execution
    || !hasText(source.branch)
    || source.branch !== 'develop'
    || !hasText(source.commit)
    || !Number.isFinite(Date.parse(source.committedAt))
    || !Number.isFinite(Date.parse(execution.completedAt))
    || !['auto', 'manual'].includes(execution.trigger)
    || !hasText(execution.machine)
    || !Array.isArray(environment)
    || environment.some((detail) => !isEnvironmentDetail(detail))
    || new Set(environment.map((detail) => detail.key)).size !== environment.length
    || !Array.isArray(targetGroups)
    || targetGroups.length === 0
  ) {
    throw new Error(`Run ${runLabel} does not match the schema-version-${CURRENT_SCHEMA_VERSION} run contract`);
  }

  const targetIds = targetGroups.map((targetGroup) => targetGroup?.id);
  const catalogTargetIds = Object.keys(catalog.targets);
  if (
    targetGroups.some((targetGroup) => !hasText(targetGroup?.id) || !Array.isArray(targetGroup.results))
    || new Set(targetIds).size !== targetIds.length
    || !sameStringSet(targetIds, catalogTargetIds)
  ) {
    throw new Error(`Run ${run.id} does not contain exactly the targets required by ${catalog.id}`);
  }

  const definitions = new Map(catalog.tests.map((definition) => [definition.id, definition]));
  const tests = targetGroups.flatMap((targetGroup) => {
    const expectedIds = catalog.targets[targetGroup.id];
    const resultIds = targetGroup.results.map((result) => result?.testId);
    if (
      targetGroup.results.some((result) => !isPublishedResult(result))
      || new Set(resultIds).size !== resultIds.length
      || !sameStringSet(resultIds, expectedIds)
    ) {
      throw new Error(`Run ${run.id} does not contain exactly one valid result for every ${targetGroup.id} catalog test`);
    }

    return targetGroup.results.map((result) => {
      const definition = definitions.get(result.testId);
      return {
        ...definition,
        testId: `${targetGroup.id}:${result.testId}`,
        logicalTestId: result.testId,
        target: targetGroup.id,
        durationSeconds: result.durationSeconds ?? null,
        status: result.status,
        exitCode: result.exitCode ?? null,
        timedOut: result.status === 'timeout',
        error: result.error ?? null,
        findings: result.findings ?? [],
      };
    });
  });

  return {
    runId: run.id,
    comparisonId: run.comparisonId,
    testCatalog: run.testCatalog,
    catalogId: catalog.id,
    plugin: { ...plugin },
    timestamp: execution.completedAt,
    commitTimestamp: source.committedAt,
    trigger: execution.trigger,
    machineId: execution.machine,
    targets: targetIds,
    branch: source.branch,
    environmentId: environmentIdentity(environment),
    provenance: {
      rocjitsuCommitSha: source.commit,
      ...(hasText(source.message) ? { commitMessage: source.message } : {}),
      details: environment,
    },
    tests,
  };
}

function comparisonIdentity(run) {
  return JSON.stringify({
    testCatalog: run.testCatalog,
    branch: run.branch,
    commitTimestamp: run.commitTimestamp,
    trigger: run.trigger,
    machineId: run.machineId,
    targets: [...run.targets].sort(),
    environmentId: run.environmentId,
    commit: run.provenance.rocjitsuCommitSha,
    message: run.provenance.commitMessage ?? null,
  });
}

function buildDashboardData(raw) {
  const allRuns = raw?.pluginRuns ?? raw?.runs;
  if (
    !raw
    || raw.schemaVersion !== CURRENT_SCHEMA_VERSION
    || !Array.isArray(allRuns)
    || !Array.isArray(raw.testCatalog)
  ) {
    throw new Error(`Expected schema-version-${CURRENT_SCHEMA_VERSION} dashboard data with runs and testCatalog arrays`);
  }

  const definitionIds = raw.testCatalog.map((definition) => definition?.id);
  if (
    raw.testCatalog.some((definition) => !isTestDefinition(definition))
    || new Set(definitionIds).size !== definitionIds.length
  ) {
    throw new Error('The test catalog contains an invalid or duplicate benchmark definition');
  }

  const invalidRun = allRuns.find((run) => (
    !hasText(run?.runId)
    || !hasText(run?.comparisonId)
    || !hasText(run?.plugin?.id)
    || !Number.isFinite(Date.parse(run.timestamp))
    || !Number.isFinite(Date.parse(run.commitTimestamp))
    || run.branch !== 'develop'
    || !['auto', 'manual'].includes(run.trigger)
    || !hasText(run.machineId)
    || !Array.isArray(run.targets)
    || !Array.isArray(run.tests)
    || !hasText(run.environmentId)
    || !hasText(run.provenance?.rocjitsuCommitSha)
  ));
  if (invalidRun) {
    throw new Error(`Run ${invalidRun.runId ?? '(unknown)'} is not a valid official develop run`);
  }

  const pluginRuns = [...allRuns].sort(compareRunExecution);
  const runs = pluginRuns.filter((run) => run.plugin.id === 'vanilla');
  const latestCommitRun = sortRunsByCommit(runs).at(-1) ?? null;
  const latestCompletedRun = sortRunsByCommit(runs.filter(isRunCompleted)).at(-1) ?? null;
  const targets = [...new Set(runs.flatMap((run) => run.targets))];
  const plugins = [...new Map(pluginRuns.map((run) => [run.plugin.id, run.plugin])).values()];

  return {
    ...raw,
    pluginRuns,
    runs,
    latestRun: runs.at(-1) ?? null,
    latestCommitRun,
    latestCompletedRun,
    targets,
    plugins,
    suites: [...new Set(raw.testCatalog.map((test) => test.suite))].sort(),
  };
}

export function loadDashboardData(raw) {
  return buildDashboardData(raw);
}

export function loadPublishedDashboardData({
  metadata,
  index,
  runs,
  runErrors = [],
  catalogs = {},
  catalogErrors = {},
}) {
  if (metadata?.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported dashboard schema version ${metadata?.schemaVersion ?? '(missing)'}`);
  }
  if (typeof metadata.isBeta !== 'boolean') {
    throw new Error('Expected dashboard metadata to contain an isBeta boolean');
  }
  if (!index || !Number.isFinite(Date.parse(index.generatedAt)) || !Array.isArray(index.runFiles)) {
    throw new Error('Expected the dashboard data index to contain generatedAt and runFiles');
  }
  if (!Array.isArray(runs)) {
    throw new Error('Expected loaded runs to be an array');
  }

  const normalizedRuns = [];
  const acceptedSourceRuns = [];
  const warnings = [];
  const seenRunFiles = new Set();
  const seenRunIds = new Set();
  const comparisonGroups = new Map();
  const normalizedCatalogs = new Map();

  index.runFiles.forEach((runFile, runIndex) => {
    const validRunFile = typeof runFile === 'string' && RUN_FILE_PATTERN.test(runFile);
    let error = runErrors[runIndex] ?? null;
    if (!validRunFile) error ??= new Error(`Invalid run filename: ${String(runFile)}`);
    if (validRunFile && seenRunFiles.has(runFile)) error ??= new Error('Duplicate run filename');
    if (validRunFile) seenRunFiles.add(runFile);

    try {
      if (error) throw error;
      const publishedRun = runs[runIndex];
      const catalogPath = publishedRun?.testCatalog;
      if (!hasText(catalogPath) || !CATALOG_FILE_PATTERN.test(catalogPath)) {
        throw new Error(`Run ${publishedRun?.id ?? '(unknown)'} references an invalid test catalog`);
      }
      if (catalogErrors[catalogPath]) throw catalogErrors[catalogPath];
      let catalog = normalizedCatalogs.get(catalogPath);
      if (!catalog) {
        if (!catalogs[catalogPath]) throw new Error(`Unable to load test catalog ${catalogPath}`);
        catalog = normalizeCatalog(catalogs[catalogPath], catalogPath);
        normalizedCatalogs.set(catalogPath, catalog);
      }

      const normalizedRun = normalizePublishedRun(publishedRun, catalog);
      if (seenRunIds.has(normalizedRun.runId)) throw new Error(`Duplicate run ID ${normalizedRun.runId}`);

      const existingGroup = comparisonGroups.get(normalizedRun.comparisonId);
      if (existingGroup) {
        if (existingGroup.identity !== comparisonIdentity(normalizedRun)) {
          throw new Error(`Run ${normalizedRun.runId} does not match comparison ${normalizedRun.comparisonId}`);
        }
        if (existingGroup.plugins.has(normalizedRun.plugin.id)) {
          throw new Error(`Comparison ${normalizedRun.comparisonId} repeats plugin ${normalizedRun.plugin.id}`);
        }
        existingGroup.plugins.add(normalizedRun.plugin.id);
      } else {
        comparisonGroups.set(normalizedRun.comparisonId, {
          identity: comparisonIdentity(normalizedRun),
          plugins: new Set([normalizedRun.plugin.id]),
        });
      }

      seenRunIds.add(normalizedRun.runId);
      normalizedRuns.push(normalizedRun);
      acceptedSourceRuns.push(publishedRun);
    } catch (runError) {
      warnings.push({
        runFile: typeof runFile === 'string' ? runFile : String(runFile),
        message: runError instanceof Error ? runError.message : String(runError),
      });
    }
  });

  const derivedCatalog = new Map();
  [...normalizedRuns]
    .sort(compareRunExecution)
    .forEach((run) => run.tests.forEach((test) => {
      derivedCatalog.set(test.logicalTestId, {
        id: test.logicalTestId,
        suite: test.suite,
        name: test.name,
        problem: test.problem,
      });
    }));

  const sourceData = {
    metadata,
    index,
    catalogs: Object.fromEntries(normalizedCatalogs),
    runs: acceptedSourceRuns,
  };
  const data = buildDashboardData({
    ...metadata,
    generatedAt: index.generatedAt,
    testCatalog: [...derivedCatalog.values()],
    testCatalogs: [...normalizedCatalogs.values()],
    runs: normalizedRuns,
  });

  if (!data.latestRun) throw new Error('The data files do not contain any Vanilla benchmark runs');
  if (!data.latestCompletedRun) throw new Error('The data files do not contain a completed Vanilla benchmark run');

  return { data, sourceData, warnings };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load dashboard data (${response.status} ${response.statusText})`);
  }
  return response.json();
}

export async function loadDashboardDataFiles({ metadataUrl, indexUrl, onManifest }) {
  const [metadata, index] = await Promise.all([
    fetchJson(metadataUrl),
    fetchJson(indexUrl),
  ]);
  if (!index || !Array.isArray(index.runFiles)) {
    throw new Error('Expected the dashboard data index to contain a runFiles array');
  }
  onManifest?.({ ...metadata, generatedAt: index.generatedAt });

  const runResults = await Promise.all(index.runFiles.map(async (runFile) => {
    if (typeof runFile !== 'string' || !RUN_FILE_PATTERN.test(runFile)) {
      return { run: null, error: new Error(`Invalid run filename: ${String(runFile)}`) };
    }
    try {
      return { run: await fetchJson(new URL(runFile, indexUrl)), error: null };
    } catch (error) {
      return { run: null, error };
    }
  }));

  const catalogPaths = [...new Set(runResults
    .map((result) => result.run?.testCatalog)
    .filter((catalogPath) => hasText(catalogPath) && CATALOG_FILE_PATTERN.test(catalogPath)))];
  const catalogResults = await Promise.all(catalogPaths.map(async (catalogPath) => {
    try {
      return { catalogPath, catalog: await fetchJson(new URL(catalogPath, indexUrl)), error: null };
    } catch (error) {
      return { catalogPath, catalog: null, error };
    }
  }));

  return loadPublishedDashboardData({
    metadata,
    index,
    runs: runResults.map((result) => result.run),
    runErrors: runResults.map((result) => result.error),
    catalogs: Object.fromEntries(catalogResults.map((result) => [result.catalogPath, result.catalog])),
    catalogErrors: Object.fromEntries(catalogResults
      .filter((result) => result.error)
      .map((result) => [result.catalogPath, result.error])),
  });
}
