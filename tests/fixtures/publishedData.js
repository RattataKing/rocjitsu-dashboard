import { readFileSync } from 'node:fs';
import { loadPublishedDashboardData } from '../../src/data/dashboardData.js';

function readJson(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, 'utf8'));
}

export const dataIndexUrl = new URL('../../public/data/index.json', import.meta.url);
export const dataMetadata = readJson(new URL('../../public/data/metadata.json', import.meta.url));
export const dataIndex = readJson(dataIndexUrl);

const publishedRunResults = dataIndex.runFiles.map((runFile) => {
  try {
    return { run: readJson(new URL(runFile, dataIndexUrl)), error: null };
  } catch (error) {
    return { run: null, error };
  }
});

export const publishedRuns = publishedRunResults.map((result) => result.run);
export const publishedRunErrors = publishedRunResults.map((result) => result.error);
export const publishedCatalogs = Object.fromEntries([...new Set(publishedRuns
  .map((run) => run?.testCatalog)
  .filter(Boolean))].map((catalogPath) => [catalogPath, readJson(new URL(catalogPath, dataIndexUrl))]));

export const publishedResult = loadPublishedDashboardData({
  metadata: dataMetadata,
  index: dataIndex,
  runs: publishedRuns,
  runErrors: publishedRunErrors,
  catalogs: publishedCatalogs,
});

export const benchmarkData = publishedResult.data;

// `loadDashboardData` rebuilds `pluginRuns` from `runs`, so a clone destined for it must drop the
// derived field to avoid re-seeding the loader with already-normalized plugin runs.
export function cloneBenchmarkData() {
  const cloned = structuredClone(benchmarkData);
  delete cloned.pluginRuns;
  return cloned;
}
