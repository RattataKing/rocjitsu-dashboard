import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadDashboardData, loadPublishedDashboardData } from '../src/data/dashboardData.js';
import { provenanceDetails } from '../src/data/provenance.js';
import { commitShaFor, isRunCompleted } from '../src/data/runOrdering.js';
import { chartGapPresentation } from '../src/utils/chartGaps.js';
import { selectPluginComparisonGroups } from '../src/data/pluginComparison.js';
import {
  selectAggregateRunSeries,
  selectOverview,
  selectRecentRuns,
} from '../src/data/selectors.js';

function readJson(fileUrl) {
  return JSON.parse(readFileSync(fileUrl, 'utf8'));
}

const dataMetadataUrl = new URL('../public/data/metadata.json', import.meta.url);
const dataIndexUrl = new URL('../public/data/index.json', import.meta.url);
const dataMetadata = readJson(dataMetadataUrl);
const dataIndex = readJson(dataIndexUrl);
const publishedRunResults = dataIndex.runFiles.map((runFile) => {
  try {
    return { run: readJson(new URL(runFile, dataIndexUrl)), error: null };
  } catch (error) {
    return { run: null, error };
  }
});
const publishedRuns = publishedRunResults.map((result) => result.run);
const publishedRunErrors = publishedRunResults.map((result) => result.error);
const publishedCatalogs = Object.fromEntries([...new Set(publishedRuns
  .map((run) => run?.testCatalog)
  .filter(Boolean))].map((catalogPath) => [catalogPath, readJson(new URL(catalogPath, dataIndexUrl))]));
const benchmarkData = loadPublishedDashboardData({
  metadata: dataMetadata,
  index: dataIndex,
  runs: publishedRuns,
  runErrors: publishedRunErrors,
  catalogs: publishedCatalogs,
}).data;

function cloneBenchmarkData() {
  const cloned = structuredClone(benchmarkData);
  delete cloned.pluginRuns;
  return cloned;
}

async function clickCompletedChartPoint(chart, completedOffset = 0) {
  const position = await chart.evaluate((element, offset) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const instance = fiber.stateNode.getEchartsInstance();
    const option = instance.getOption();
    const points = option.series[0].data;
    let index = points.length - 1;
    let remaining = offset;
    while (index >= 0) {
      if (points[index] && remaining === 0) break;
      if (points[index]) remaining -= 1;
      index -= 1;
    }
    return instance.convertToPixel(
      { seriesIndex: 0 },
      [option.xAxis[0].data[index], points[index].value],
    );
  }, completedOffset);
  await chart.click({ position: { x: position[0], y: position[1] } });
}

async function clickLastCompletedChartPoint(chart) {
  await clickCompletedChartPoint(chart);
}

async function clickLastStatusChartPoint(chart) {
  const position = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const instance = fiber.stateNode.getEchartsInstance();
    const option = instance.getOption();
    const seriesIndex = option.series.findIndex((series) => series.name === 'Failed or timed-out test results');
    const point = option.series[seriesIndex].data.at(-1);
    return instance.convertToPixel({ seriesIndex }, point.value);
  });
  await chart.click({ position: { x: position[0], y: position[1] } });
}

async function clickAggregateIncompletePoint(chart, commitSha) {
  const position = await chart.evaluate((element, sha) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const instance = fiber.stateNode.getEchartsInstance();
    const option = instance.getOption();
    const seriesIndex = option.series.findIndex((series) => series.name === 'Incomplete aggregate results');
    const point = option.series[seriesIndex].data.find((candidate) => (
      candidate.run?.provenance?.rocjitsuCommitSha?.startsWith(sha)
    ));
    return instance.convertToPixel({ seriesIndex }, point.value);
  }, commitSha);
  await chart.click({ position: { x: position[0], y: position[1] } });
}

async function chartScale(chart) {
  return chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const instance = fiber.stateNode.getEchartsInstance();
    const option = instance.getOption();
    return {
      zoom: option.dataZoom.map((item) => ({
        start: Number(item.start.toFixed(4)),
        end: Number(item.end.toFixed(4)),
      })),
      yExtent: instance.getModel().getComponent('yAxis').axis.scale.getExtent()
        .map((value) => Number(value.toFixed(4))),
    };
  });
}

async function selectedDotsViewport(chart, selectedSeriesName) {
  return chart.evaluate((element, seriesName) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const instance = fiber.stateNode.getEchartsInstance();
    const option = instance.getOption();
    const indexes = [...new Set(option.series
      .filter((series) => series.name === seriesName || series.name.endsWith(seriesName))
      .flatMap((series) => series.data.flatMap((point, index) => {
        if (!point) return [];
        if (Array.isArray(point.value)) return [point.value[0]];
        return [index];
      })))];
    const gridComponent = instance.getModel().getComponent('grid');
    const grid = gridComponent?.coordinateSystem?.getRect();
    const pixels = indexes.map((index) => instance.convertToPixel(
      { xAxisIndex: 0 },
      option.xAxis[0].data[index],
    ));
    const zoom = option.dataZoom[0];
    return {
      indexes,
      pixels,
      startValue: zoom.startValue,
      endValue: zoom.endValue,
      allVisible: Boolean(grid)
        && pixels.every((pixel) => pixel >= grid.x && pixel <= grid.x + grid.width),
    };
  }, selectedSeriesName);
}

async function expectDialogTypographyContained(dialog) {
  const overflowingText = await dialog.evaluate((root) => [...root.querySelectorAll('.MuiTypography-root')]
    .filter((element) => element.textContent.trim())
    .flatMap((element) => {
      const elementBounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const textBounds = range.getBoundingClientRect();
      return textBounds.top < elementBounds.top - 0.1 || textBounds.bottom > elementBounds.bottom + 0.1
        ? [element.textContent.trim().replace(/\s+/g, ' ')]
        : [];
    }));
  expect(overflowingText).toEqual([]);
}

test('loads the data-driven overview without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('rocjitsu-logo')).toHaveCount(0);
  await expect(page.getByText('Beta', { exact: true })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'RocJitsu Performance Health' })).toBeVisible();
  await expect(page.getByText('Performance Trend')).toBeVisible();
  await expect(page.getByText('Overview run coverage', { exact: false })).toBeVisible();
  await expect(page.getByText('Recent Runs')).toBeVisible();
  await expect(page.getByText('RocJitsu Commit Activity')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByText('GEMM BF16 4096³').first()).toBeVisible();
  const officialPolicy = benchmarkData.runs.every((run) => (
    !Object.hasOwn(run, 'canonical')
    && run.branch === 'develop'
    && ['auto', 'manual'].includes(run.trigger)
  ));
  expect(officialPolicy).toBe(true);
  const run = benchmarkData.runs.find((candidate) => candidate.timestamp === '2026-08-31T13:10:00.000Z');
  const separatedTimestamps = { runTime: run.timestamp, commitTime: run.commitTimestamp };
  expect(separatedTimestamps).toEqual({
    runTime: '2026-08-31T13:10:00.000Z',
    commitTime: '2026-08-31T12:42:00.000Z',
  });
  expect(await page.evaluate(() => Object.hasOwn(window, 'ROCJITSU_BENCHMARK_DATA'))).toBe(false);
  expect(errors).toEqual([]);
});

test('loads merged target runs from immutable test catalogs', async () => {
  expect(dataMetadata.schemaVersion).toBe(1);
  expect(dataIndex.runFiles).toHaveLength(99);
  expect(dataIndex.runFiles.every((runFile) => /^runs\/[^/]+\.json$/.test(runFile))).toBe(true);
  expect(Object.keys(publishedCatalogs).sort()).toEqual([
    'test-catalogs/rocjitsu-core-v1.json',
    'test-catalogs/rocjitsu-core-v2.json',
  ]);
  expect(benchmarkData.runs).toHaveLength(95);
  expect(benchmarkData.pluginRuns).toHaveLength(99);
  expect(benchmarkData.runs.every((run) => run.plugin.id === 'vanilla')).toBe(true);
  expect(benchmarkData.runs.every((run) => (
    run.targets.includes('gfx1250') && run.targets.includes('gfx950')
  ))).toBe(true);
  const pluginGroups = selectPluginComparisonGroups(benchmarkData);
  expect(pluginGroups.map((group) => group.comparisonId)).toEqual([
    'benchmark-202607250530-8e0c5183',
    'benchmark-202608311945-31369c4d',
  ]);
  expect(pluginGroups[0].runs.map((run) => run.plugin.id)).toEqual(['vanilla', 'asan']);
  expect(pluginGroups[1].runs.map((run) => run.plugin.id)).toEqual(['vanilla', 'asan', 'tsan', 'ubsan']);
});

test('compares controlled plugins for every target without a target picker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Plugin Comparison' }).click();

  const view = page.getByTestId('plugin-comparison');
  await expect(view.getByRole('heading', { name: 'Plugin Comparison' })).toBeVisible();
  await expect(view.getByRole('combobox', { name: 'Baseline plugin' })).toHaveText('Vanilla');
  await expect(page.getByLabel('Targets')).toBeVisible();
  await expect(view.getByText('Same commit, catalog, machine, environment, and test definitions.')).toBeVisible();

  const gfx1250 = view.getByTestId('plugin-target-gfx1250');
  const gfx950 = view.getByTestId('plugin-target-gfx950');
  await expect(gfx1250.getByRole('heading', { name: 'gfx1250' })).toBeVisible();
  await expect(gfx950).toHaveCount(0);
  await page.getByLabel('Targets').click();
  await page.getByRole('option', { name: /Check all targets/ }).click();
  await page.keyboard.press('Escape');
  await expect(gfx950.getByRole('heading', { name: 'gfx950' })).toBeVisible();
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-vanilla')).toContainText('7/7');
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-asan')).toContainText('Geometric-mean runtime overhead');
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-tsan')).toContainText('6/7');
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-tsan')).toContainText(/\+\d+\.\d%\*/);
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-tsan')).toContainText('Estimated for all 7 tests from 6 passed pairs');
  await expect(gfx1250.getByText(/geometric-mean overhead measured from passed plugin\/baseline pairs is assumed/)).toBeVisible();
  await expect(gfx1250.getByTestId('plugin-summary-gfx1250-ubsan')).toContainText('7/7');
  const gfx1250Chart = gfx1250.getByRole('img', { name: 'Plugin runtime overhead for gfx1250' });
  await expect(gfx1250Chart).toBeVisible();
  await expect(gfx950.getByRole('img', { name: 'Plugin runtime overhead for gfx950' })).toBeVisible();
  await expect(gfx1250.getByText('Concurrent access to scheduler state')).toBeVisible();

  const seriesColors = async () => gfx1250Chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return Object.fromEntries(fiber.stateNode.getEchartsInstance().getOption().series
      .map((series) => [series.name, series.itemStyle.color]));
  });
  expect(await seriesColors()).toEqual({
    AddressSanitizer: '#D97706',
    ThreadSanitizer: '#8B5CF6',
    UndefinedBehaviorSanitizer: '#0891B2',
  });

  await view.getByRole('combobox', { name: 'Baseline plugin' }).click();
  await page.getByRole('option', { name: 'AddressSanitizer' }).click();
  await expect(view.getByRole('combobox', { name: 'Baseline plugin' })).toHaveText('AddressSanitizer');
  expect(await seriesColors()).toEqual({
    Vanilla: '#16A34A',
    ThreadSanitizer: '#8B5CF6',
    UndefinedBehaviorSanitizer: '#0891B2',
  });

  const layerNormRow = gfx1250.getByRole('row', { name: /LayerNorm BF16 8192/ });
  await layerNormRow.getByRole('button', { name: /Open ThreadSanitizer result/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('ThreadSanitizer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('LLVM 20', { exact: true })).toBeVisible();
  await expect(dialog.getByText('ThreadSanitizer: data race detected in scheduler state')).toBeVisible();
  await expect(dialog.getByText('Problem Details', { exact: true })).toBeVisible();
});

test('renders the dashboard shell while run data is still loading', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Loading behavior is viewport independent');
  let releaseRunRequest;
  const runRequestGate = new Promise((resolve) => {
    releaseRunRequest = resolve;
  });
  await page.route('**/data/runs/**', async (route) => {
    await runRequestGate;
    await route.continue();
  }, { times: 1 });

  await page.goto('/');
  try {
    await expect(page.getByText('RocJitsu / Performance Dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'RocJitsu Performance Health' })).toBeVisible();
    await expect(page.getByText('Beta', { exact: true })).toBeVisible();
    const loadingState = page.getByTestId('dashboard-data-loading');
    await expect(loadingState).toBeVisible();
    await expect(loadingState).toHaveAttribute('aria-busy', 'true');
    await expect(loadingState.getByRole('progressbar', { name: 'Loading benchmark run data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
  } finally {
    releaseRunRequest();
  }

  await expect(page.getByTestId('dashboard-data-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-navigation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
});

test('renders valid history with a warning when an indexed run is invalid', async ({ page }) => {
  const invalidRunFile = 'runs/invalid-run.json';
  const invalidRun = structuredClone(publishedRuns[0]);
  invalidRun.targets[1].id = 'gfx1250';
  await page.route('**/data/index.json', async (route) => {
    const response = await route.fetch();
    const index = await response.json();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...index, runFiles: [index.runFiles[0], invalidRunFile] }),
    });
  });
  await page.route('**/data/runs/invalid-run.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invalidRun) });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'RocJitsu Performance Health' })).toBeVisible();
  const warning = page.getByTestId('invalid-run-warning');
  await expect(warning).toContainText('Skipped 1 invalid run file');
  await expect(warning).toContainText(invalidRunFile);
  await expect(warning).toContainText('does not contain exactly the targets required');
});

test('rejects data outside the official develop-run policy', async () => {
  const invalidData = cloneBenchmarkData();
  invalidData.runs[0].branch = 'feature/experiment';
  expect(() => loadDashboardData(invalidData)).toThrow(/not a valid official develop run/);
});

test('accepts an empty environment array', async () => {
  const runs = structuredClone(publishedRuns);
  runs[0].environment = [];
  expect(() => loadPublishedDashboardData({
    metadata: dataMetadata,
    index: dataIndex,
    runs,
    runErrors: publishedRunErrors,
    catalogs: publishedCatalogs,
  })).not.toThrow();
});

test('skips an invalid published run and reports its filename and reason', async () => {
  const runFiles = dataIndex.runFiles.slice(0, 2);
  const runs = structuredClone(publishedRuns.slice(0, 2));
  runs[1].targets[1].id = 'gfx1250';

  const result = loadPublishedDashboardData({
    metadata: dataMetadata,
    index: { generatedAt: dataIndex.generatedAt, runFiles },
    runs,
    catalogs: publishedCatalogs,
  });

  expect(result.data.runs).toHaveLength(1);
  expect(result.data.runs[0].targets).toEqual(['gfx1250', 'gfx950']);
  expect(result.warnings).toEqual([{
    runFile: runFiles[1],
    message: `Run ${runs[1].id} does not contain exactly the targets required by rocjitsu-core-v1`,
  }]);
});

test('counts failed tests in the run denominator', async () => {
  const summary = selectRecentRuns(
    benchmarkData,
    { targets: ['gfx1250'], suites: benchmarkData.suites },
    benchmarkData.runs.length,
  ).find((candidate) => candidate.run.runId === 'benchmark-202606020530-187a7544');
  expect(summary).toMatchObject({ completed: 4, total: 5, failed: 1 });
  expect(isRunCompleted(summary.run)).toBe(false);
});

test('interpolates only the dotted bridge across unavailable chart values', async () => {
  const presentation = chartGapPresentation([{ value: 10 }, null, null, { value: 16 }]);
  expect(presentation.estimatedValues).toEqual([10, 12, 14, 16]);
  expect(presentation.segments).toEqual([[10, 12, 14, 16]]);
});

test('keeps an older smaller test set complete after the catalog grows', async () => {
  const historicalRun = benchmarkData.runs.find((run) => run.runId === 'benchmark-202606010530-86b362ea');
  const historicalTargetTests = historicalRun.tests.filter((test) => test.target === 'gfx1250');
  const currentTargetTests = benchmarkData.latestCompletedRun.tests.filter((test) => test.target === 'gfx1250');
  expect(historicalTargetTests).toHaveLength(5);
  expect(currentTargetTests).toHaveLength(7);
  expect(isRunCompleted(historicalRun)).toBe(true);
  expect(benchmarkData.testCatalog).toHaveLength(7);
});

test('performance trend fills the row beside largest changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Cards share a row at laptop width');
  await page.goto('/');

  const trend = page.getByTestId('performance-trend');
  const changes = page.getByTestId('largest-changes');
  const chartWrapper = page.getByTestId('performance-trend-chart');
  const chart = trend.getByRole('img', { name: 'Performance trend for ALL' });
  const boxes = await Promise.all([
    trend.boundingBox(),
    changes.boundingBox(),
    chartWrapper.boundingBox(),
    chart.boundingBox(),
  ]);

  expect(Math.abs(boxes[0].height - boxes[1].height)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes[2].height - boxes[3].height)).toBeLessThanOrEqual(1);
  expect(boxes[3].height).toBeGreaterThanOrEqual(278);

  await page.waitForTimeout(400);
  const markers = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    return {
      xAxisName: option.xAxis[0].name,
      yAxisScale: option.yAxis[0].scale,
      series: option.series
        .filter((series) => series.type === 'line')
        .map((series) => ({
          showSymbol: series.showSymbol,
          connectNulls: series.connectNulls,
          smooth: series.smooth,
          latestMarkers: series.markPoint?.data?.length ?? 0,
        })),
    };
  });
  expect(markers.xAxisName).toBe('Commit Date (UTC)');
  expect(markers.yAxisScale).toBe(true);
  expect(markers.series.every((series) => series.showSymbol === false)).toBe(true);
  expect(markers.series.every((series) => series.connectNulls === true)).toBe(true);
  expect(markers.series.every((series) => Number(series.smooth) > 0)).toBe(true);
  expect(markers.series.every((series) => series.latestMarkers === 1)).toBe(true);
});

test('failures count stays fully inside the navigation bar', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByTestId('dashboard-navigation');
  const failuresTab = page.getByRole('tab', { name: /Failures/ });
  const badge = failuresTab.locator('.MuiBadge-badge');
  const [navigationBox, tabBox, badgeBox] = await Promise.all([
    navigation.boundingBox(),
    failuresTab.boundingBox(),
    badge.boundingBox(),
  ]);

  expect(badgeBox.y).toBeGreaterThanOrEqual(navigationBox.y);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(navigationBox.y + navigationBox.height);
  expect(badgeBox.x).toBeGreaterThanOrEqual(tabBox.x);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(tabBox.x + tabBox.width);
});

test('keeps diagnostic views available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();
  await expect(page.getByText('Benchmark Explorer')).toBeVisible();

  await page.getByRole('tab', { name: 'Run Comparison' }).click();
  await expect(page.getByText('Performance Change by Benchmark')).toBeVisible();
  await expect(page.getByText('Aggregate change')).toBeVisible();
  await expect(page.getByText('Not comparable', { exact: true })).toBeVisible();
  await expect(page.getByText('Only benchmarks with valid completed durations in both runs are compared.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Performance change by benchmark comparison chart' })).toBeVisible();

  await page.getByRole('tab', { name: /Failures/ }).click();
  await expect(page.getByText('Run Reliability')).toBeVisible();
  await expect(page.getByText('Failed and Timed-Out Cases')).toBeVisible();
});

test('uses contrasting target series and engineering-tone comparison labels', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Targets').click();
  await page.getByRole('option', { name: /Check all targets/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'RocJitsu Performance Health' }).click();

  const trend = page.getByRole('img', { name: 'Performance trend for ALL' });
  const targetSeriesColors = await trend.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return fiber.stateNode.getEchartsInstance().getOption().series
      .filter((series) => series.type === 'line')
      .map((series) => series.lineStyle.color.toLowerCase());
  });
  expect(targetSeriesColors).toEqual(['#2166c1', '#c25430']);
  expect(new Set(targetSeriesColors).size).toBe(targetSeriesColors.length);

  await page.getByRole('tab', { name: 'Run Comparison' }).click();

  const chart = page.getByRole('img', { name: 'Performance change by benchmark comparison chart' });
  const encoding = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const barData = fiber.stateNode.getEchartsInstance().getOption().series
      .find((series) => series.type === 'bar').data;
    const fills = [...new Set(barData.map((item) => item.itemStyle.color))];
    const yAxis = fiber.stateNode.getEchartsInstance().getOption().yAxis[0];
    return {
      fillCount: fills.length,
      usesEngineeringTokens: yAxis.data.every((label) => label.includes('{target|') && label.includes('{benchmark|')),
      richStyleKeys: Object.keys(yAxis.axisLabel.rich),
      targetLabelColor: yAxis.axisLabel.rich.target.color,
      benchmarkLabelColor: yAxis.axisLabel.rich.benchmark.color,
      hasOutlinedBars: barData.some((item) => item.itemStyle.borderWidth > 0),
    };
  });
  expect(encoding.fillCount).toBeLessThanOrEqual(3);
  expect(encoding.usesEngineeringTokens).toBe(true);
  expect(encoding.richStyleKeys.sort()).toEqual(['benchmark', 'separator', 'target']);
  expect(encoding.targetLabelColor).not.toBe(encoding.benchmarkLabelColor);
  expect(encoding.hasOutlinedBars).toBe(false);
});

test('recent runs waits for two selections before opening compare', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByText('Each perf change uses the latest run from the nearest earlier commit that completed all currently selected tests.')).toBeVisible();
  await expect(page.getByText('To compare runs, select the candidate first and the baseline second.')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const recentRuns = page.getByTestId('recent-runs-table');
    await expect(recentRuns.getByRole('columnheader', { name: 'Actions' })).toBeVisible();
    await expect(recentRuns.getByRole('columnheader', { name: 'Run time (UTC)' })).toBeVisible();
    await expect(recentRuns.getByRole('columnheader', { name: 'Commit time (UTC)' })).toBeVisible();
    await expect(recentRuns.getByRole('columnheader', { name: 'Trigger' })).toHaveCount(0);
    await expect(recentRuns.getByRole('columnheader', { name: 'Run type' })).toBeVisible();
    const contentGroupCenters = await recentRuns.locator('tbody tr').first().locator('[data-table-cell-group]').evaluateAll(
      (elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      }),
    );
    expect(Math.max(...contentGroupCenters) - Math.min(...contentGroupCenters)).toBeLessThanOrEqual(1);
    const rowHeights = await recentRuns.locator('tbody tr').evaluateAll(
      (rows) => rows.slice(0, 3).map((row) => row.getBoundingClientRect().height),
    );
    expect(Math.abs(rowHeights[0] - rowHeights[1])).toBeLessThanOrEqual(1);
    expect(rowHeights[1] - rowHeights[2]).toBeGreaterThanOrEqual(24);
  }
  await expect(page.getByLabel('Show runs')).toHaveText('8 runs');
  await expect(page.getByText('Push', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Nightly', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show runs').click();
  await page.getByRole('option', { name: '5 runs' }).click();
  const runSelectors = page.getByRole('button', { name: /^Compare [a-f0-9]+$/ });
  const exploreActions = page.getByRole('button', { name: /^View run [a-f0-9]+ in Benchmark Explorer$/ });
  await expect(runSelectors).toHaveCount(5);
  await expect(exploreActions).toHaveCount(5);
  await runSelectors.first().click();

  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Candidate selected')).toBeVisible();
  await expect(page.getByText('Select another run as the baseline to open Run Comparison.')).toBeVisible();
  await expect(runSelectors.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(runSelectors.first()).toHaveCSS('background-color', 'rgb(85, 102, 233)');
  await runSelectors.nth(2).click();

  await expect(page.getByRole('tab', { name: 'Run Comparison' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Candidate run' })).toHaveValue(/8418072e/);
  await expect(page.getByRole('combobox', { name: 'Baseline run' })).toHaveValue(/9f774d29/);
  await expect(page.getByText('Candidate vs baseline · Lower duration is faster')).toBeVisible();
});

test('recent run baselines respect the active global test scope', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Scoped-baseline selection is viewport independent');
  await page.goto('/');

  const recentRuns = page.getByTestId('recent-runs-table');
  const august30 = recentRuns.getByRole('row').filter({ hasText: '9398bd3f' });
  await expect(august30.getByLabel('Candidate commit 9398bd3f versus baseline commit daaf4bae')).toBeVisible();

  await page.getByLabel('Suites').click();
  await page.getByRole('option', { name: 'TensileLite' }).click();
  await page.getByRole('option', { name: 'DeepSeek' }).click();
  await page.keyboard.press('Escape');

  await expect(august30.getByLabel('Candidate commit 9398bd3f versus baseline commit 0db03af1')).toBeVisible();
});

test('an incomplete recent run has clickable aggregate and failed-test markers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The aggregate result is viewport independent');
  await page.goto('/');

  const incompleteRun = page.getByTestId('recent-runs-table').locator('tbody tr').filter({ hasText: '19872076' });
  await incompleteRun.getByRole('button', { name: 'View run 19872076 in Benchmark Explorer' }).click();

  await expect(page.getByRole('tab', { name: 'Benchmarks' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Aggregate' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Selected 19872076 · Auto')).toBeVisible();

  const aggregateChart = page.getByRole('img', { name: 'Aggregate duration history for all runs' });
  await expect(aggregateChart).toBeVisible();
  await page.waitForTimeout(400);
  const selection = await aggregateChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    const incompleteSeries = option.series
      .find((series) => series.name === 'Incomplete aggregate results');
    const incompletePoint = incompleteSeries?.data.find((point) => (
      point?.run?.provenance?.rocjitsuCommitSha?.startsWith('19872076')
    ));
    return {
      yAxisName: option.yAxis[0].name,
      target: incompletePoint?.target,
      completed: incompletePoint?.completed,
      total: incompletePoint?.total,
      label: incompletePoint?.label?.formatter,
      symbolSize: incompletePoint?.symbolSize,
      borderWidth: incompletePoint?.itemStyle?.borderWidth,
      shadowBlur: incompletePoint?.itemStyle?.shadowBlur,
    };
  });
  expect(selection.yAxisName).toBe('Seconds');
  expect(selection).toMatchObject({
    target: 'gfx1250',
    completed: 5,
    total: 7,
    label: '5/7',
    symbolSize: 17,
    borderWidth: 4,
    shadowBlur: 13,
  });

  await clickAggregateIncompletePoint(aggregateChart, '19872076');
  const runDetails = page.getByRole('dialog', { name: 'Run Details' });
  await expect(runDetails).toBeVisible();
  await expect(runDetails.getByRole('heading', { name: 'Selected Scope' })).toBeVisible();
  await expect(runDetails.getByText('5/7 completed')).toBeVisible();
  await expect(runDetails.getByText('Incomplete Tests')).toBeVisible();
  await expect(runDetails.getByText('GEMM FP16 1024³')).toBeVisible();
  await expect(runDetails.getByText('Failed', { exact: true })).toBeVisible();
  await expect(runDetails.getByText('Simulation exited before producing a valid timing result')).toBeVisible();
  await expect(runDetails.getByText('Softmax FP32 4096×4096')).toBeVisible();
  await expect(runDetails.getByText('Timeout', { exact: true })).toBeVisible();
  await expect(runDetails.getByText('Benchmark exceeded its configured timeout')).toBeVisible();
  await runDetails.getByRole('button', { name: 'Close Run Details' }).click();

  await page.getByRole('button', { name: 'Single' }).click();
  const benchmarkChart = page.getByRole('img', { name: /duration history/ });
  const failedSelection = await benchmarkChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const series = fiber.stateNode.getEchartsInstance().getOption().series
      .find((candidate) => candidate.name === 'Failed or timed-out test results');
    const point = series?.data.find((candidate) => (
      candidate.record?.run?.provenance?.rocjitsuCommitSha?.startsWith('19872076')
    ));
    return {
      sha: point?.record?.run?.provenance?.rocjitsuCommitSha?.slice(0, 8),
      label: point?.label?.formatter,
      status: point?.record?.test?.status,
    };
  });
  expect(failedSelection).toEqual({ sha: '19872076', label: 'Failed', status: 'failed' });
});

test('manual runs of older commits do not become the latest completed commit or move to the history end', async ({ page }, testInfo) => {
  await page.goto('/');

  await expect(page.getByTestId('latest-commit-run')).toContainText('31369c4d');
  const newestExecution = testInfo.project.name === 'desktop'
    ? page.getByTestId('recent-runs-table').locator('tbody tr').first()
    : page.getByTestId('mobile-run').first();
  await expect(newestExecution).toContainText('8418072e');
  await expect(newestExecution).toContainText('Sep 1 · 01:15');
  await expect(newestExecution).toContainText('Aug 15 · 05:30');
  await expect(newestExecution.getByLabel('Most recent run')).toBeVisible();
  await expect(newestExecution).toContainText('Most recent');
  await expect(newestExecution).toContainText('Manual');
  await expect(newestExecution.getByLabel('Historical rerun')).toBeVisible();
  await expect(newestExecution).toContainText('Historical rerun');
  await expect(newestExecution).not.toContainText('Reference');
  await expect(newestExecution.locator('[title*="nearest earlier commit: f25f5a48"]')).toHaveCount(1);

  const newestCommitRun = testInfo.project.name === 'desktop'
    ? page.getByTestId('recent-runs-table').locator('tbody tr').filter({ hasText: '31369c4d' })
    : page.getByTestId('mobile-run').filter({ hasText: '31369c4d' });
  await expect(newestCommitRun).toHaveCount(1);
  await expect(newestCommitRun.getByLabel('Latest commit')).toBeVisible();
  await expect(newestCommitRun).toContainText('Latest commit');
  await expect(newestCommitRun.locator('[title*="nearest earlier commit: 9f774d29"]')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Benchmarks' }).click();
  const chart = page.getByRole('img', { name: 'GEMM FP16 1024³ duration history' });
  const placement = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const labels = fiber.stateNode.getEchartsInstance().getOption().xAxis[0].data;
    const oldCommitIndexes = labels
      .map((label, index) => (label.includes('8418072e') ? index : -1))
      .filter((index) => index >= 0);
    return {
      oldCommitIndexes,
      latestLabels: labels.slice(-3),
    };
  });
  expect(placement.oldCommitIndexes).toHaveLength(2);
  expect(placement.oldCommitIndexes[1] - placement.oldCommitIndexes[0]).toBe(1);
  expect(placement.latestLabels.join(' ')).not.toContain('8418072e');

  await page.getByRole('tab', { name: 'Run Comparison' }).click();
  const candidateRun = page.getByRole('combobox', { name: 'Candidate run' });
  await candidateRun.click();
  await expect(page.getByRole('option')).toHaveCount(50);
  await candidateRun.fill('8418072e');
  const matchingOptions = page.getByRole('option');
  await expect(matchingOptions).toHaveCount(2);
  await expect(matchingOptions.first()).not.toContainText(/additional|reference/i);
  await page.getByRole('option', { name: /Test run.*Sep 1.*8418072e.*Commit.*Aug 15/ }).click();
  await expect(page.getByRole('combobox', { name: 'Baseline run' })).toHaveValue(/784750dd/);
});

test('Overview uses the newest attempt of the newest commit even when it is incomplete', async () => {
  const rawData = cloneBenchmarkData();
  const source = rawData.runs.find((run) => run.provenance.rocjitsuCommitSha.startsWith('31369c4d'));
  rawData.runs.push({
    ...source,
    runId: 'incomplete-latest-commit-attempt',
    timestamp: '2026-09-01T04:00:00.000Z',
    trigger: 'manual',
    tests: source.tests.map((result, index) => index === 0 ? {
      ...result,
      durationSeconds: null,
      status: 'failed',
      exitCode: 1,
      error: 'Synthetic incomplete latest attempt',
    } : { ...result }),
  });
  const data = loadDashboardData(rawData);
  const overview = selectOverview(data, { targets: ['gfx1250'], suites: data.suites });

  expect(data.latestCommitRun.timestamp).toBe('2026-09-01T04:00:00.000Z');
  expect(commitShaFor(data.latestCommitRun)).toMatch(/^31369c4d/);
  expect(overview.metrics).toMatchObject({ completed: 6, total: 7, durationDelta: null });
  expect(overview.results.some((result) => result.status === 'failed')).toBe(true);
});

test('a newer rerun of the nearest earlier commit updates the Overview baseline', async () => {
  const rawData = cloneBenchmarkData();
  const source = rawData.runs.find((run) => run.provenance.rocjitsuCommitSha.startsWith('9f774d29'));
  rawData.runs.push({
    ...source,
    runId: 'newer-9f774d29-rerun',
    timestamp: '2026-09-01T04:30:00.000Z',
    trigger: 'manual',
    tests: source.tests.map((result) => ({
      ...result,
      durationSeconds: Number.isFinite(result.durationSeconds)
        ? Number((result.durationSeconds * 2).toFixed(3))
        : result.durationSeconds,
    })),
  });
  const data = loadDashboardData(rawData);
  const overview = selectOverview(data, { targets: ['gfx1250'], suites: data.suites });
  const fp16Result = overview.results.find((result) => result.logicalTestId === 'triton-gemm-f16-1024');

  expect(commitShaFor(overview.candidate)).toMatch(/^31369c4d/);
  expect(overview.baseline.runId).toBe('newer-9f774d29-rerun');
  expect(fp16Result.previous.durationSeconds).toBeCloseTo(4.15, 2);
});

test('a late old-commit run stays out of Overview and remains addressable in Aggregate Explorer data', async () => {
  const rawData = cloneBenchmarkData();
  const source = rawData.runs.find((run) => run.provenance.rocjitsuCommitSha.startsWith('31369c4d'));
  rawData.runs.push({
    ...source,
    runId: 'late-run-for-01d0c0de',
    timestamp: '2026-09-01T03:00:00.000Z',
    commitTimestamp: '2026-08-29T12:00:00.000Z',
    trigger: 'manual',
    provenance: {
      ...source.provenance,
      rocjitsuCommitSha: '01d0c0de00000000000000000000000000000000',
      commitMessage: 'Validate historical commit placement',
    },
  });
  const data = loadDashboardData(rawData);
  const filters = { targets: ['gfx1250'], suites: data.suites };
  const commitHistory = selectOverview(data, filters, '3M').history;
  const intradayHistory = selectOverview(data, filters, '1D').history;
  const recentRuns = selectRecentRuns(data, filters);
  const aggregate = selectAggregateRunSeries(data, filters);

  expect(commitHistory.slots.some((slot) => slot.run?.runId === 'late-run-for-01d0c0de')).toBe(false);
  expect(intradayHistory.slots.some((slot) => slot.run?.runId === 'late-run-for-01d0c0de')).toBe(false);
  expect(recentRuns[0]).toMatchObject({ olderCommit: true, run: { runId: 'late-run-for-01d0c0de' } });
  expect(aggregate.runs.some((run) => run.runId === 'late-run-for-01d0c0de')).toBe(true);
  expect(aggregate.runs.at(-1).runId).not.toBe('late-run-for-01d0c0de');
});

test('automatic change views expose the expected baseline for fully completed commits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Comparison-policy validation is viewport independent');
  await page.goto('/');

  const recentRun = page.getByTestId('recent-runs-table').locator('tbody tr').filter({ hasText: '31369c4d' });
  await expect(recentRun.locator('[title*="nearest earlier commit: 9f774d29"]')).toHaveCount(1);

  await page.getByTestId('latest-results').getByRole('row', { name: /GEMM FP16 1024/ }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Result' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Problem Details' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Run Provenance' })).toBeVisible();
  await expect(dialog.getByText('Baseline run', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close details' }).click();

  await page.getByRole('tab', { name: 'Benchmarks' }).click();
  const latestHistoryRow = page.getByTestId('historical-records').getByRole('row', { name: /31369c4d/ });
  await expect(latestHistoryRow).toContainText('Validate follow-up scheduler tuning');
  await expect(latestHistoryRow.getByText('Validate follow-up scheduler tuning')).toHaveCSS('white-space', 'nowrap');
  await latestHistoryRow.click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Baseline run', { exact: true })).toHaveCount(0);
});

test('benchmark history uses the previous completed result for the same test', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Result-baseline selection is viewport independent');
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const history = page.getByTestId('historical-records');
  const august28 = history.getByRole('row', { name: /Aug 28, 2026/ });
  const august27 = history.getByRole('row', { name: /Aug 27, 2026/ });
  await expect(august28.getByLabel('Candidate commit 87c0b32c versus baseline commit 0db03af1')).toBeVisible();
  await expect(august27.getByLabel('Candidate commit 0db03af1 versus baseline commit daaf4bae')).toBeVisible();

  await august28.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Baseline run', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Problem Details', { exact: true })).toBeVisible();
});

test('every performance-change surface identifies both compared commits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Comparison labels are viewport independent');
  await page.goto('/');

  const latestPair = 'Candidate commit 31369c4d versus baseline commit 9f774d29';
  const metric = page.getByText('Perf change', { exact: true }).first().locator('..');
  await expect(metric.getByLabel(latestPair)).toBeVisible();
  await expect(page.getByTestId('performance-trend').getByLabel('Candidate commit 255eabe3 versus baseline commit 68c7dece')).toBeVisible();

  const largestChangePairs = page.getByTestId('largest-changes').getByLabel(latestPair);
  await expect(largestChangePairs).toHaveCount(6);
  const latestResultPairs = page.getByTestId('latest-results').getByLabel(latestPair);
  await expect(latestResultPairs).toHaveCount(7);

  const latestExecution = page.getByTestId('recent-runs-table').locator('tbody tr').first();
  await expect(latestExecution.getByLabel('Candidate commit 8418072e versus baseline commit f25f5a48')).toBeVisible();

  await page.getByRole('tab', { name: 'Benchmarks' }).click();
  const latestCommitRecord = page.getByTestId('historical-records').locator('tbody tr').filter({ hasText: '31369c4d' });
  await expect(latestCommitRecord.getByLabel(latestPair)).toBeVisible();

  await page.getByRole('tab', { name: 'Run Comparison' }).click();
  await expect(page.getByLabel(latestPair)).toHaveCount(2);
});

test('failures shows reliability for official runs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Failures/ }).click();

  await expect(page.getByText('Coverage for the latest 20 official runs under the current filters.')).toBeVisible();
  await expect(page.getByText('17/20')).toBeVisible();
  await expect(page.getByText('Runs below 100%')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Run reliability coverage trend' })).toBeVisible();

  const progressBars = page.getByTestId('reliability-progress');
  const barPositions = await progressBars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
  expect(new Set(barPositions.map((position) => Math.round(position))).size).toBe(1);
});

test('benchmark picker can locally reveal suites hidden by global filters', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Suites').click();
  await page.getByRole('option', { name: /Check all suites/ }).click();
  await page.getByRole('option', { name: 'Triton' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Benchmarks' }).click();
  await page.getByRole('combobox', { name: 'Benchmark' }).click();
  await expect(page.getByText('3 benchmarks hidden by global Suite filters')).toBeVisible();
  await page.getByRole('button', { name: 'Show all benchmarks' }).click();
  await page.getByRole('combobox', { name: 'Benchmark' }).fill('DeepSeek');
  await page.getByRole('option', { name: /DeepSeek V3 FP8 decode/ }).click();

  await expect(page.getByText('Outside global Suite filter')).toBeVisible();
  await expect(page.getByText(/This local override applies only to Benchmark Explorer/)).toBeVisible();
  await page.getByLabel('Suites').click();
  await expect(page.getByRole('option', { name: 'Triton' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: 'DeepSeek' })).toHaveAttribute('aria-selected', 'false');
});

test('benchmark explorer switches among single, grid, and aggregate modes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const singleMode = page.getByRole('button', { name: 'Single' });
  const clickDetails = page.getByRole('button', { name: 'Disable details on click' });
  const scrollZoom = page.getByRole('button', { name: 'Disable scroll zoom' });
  await expect(singleMode).toHaveAttribute('aria-pressed', 'true');
  const controlPositions = await Promise.all([singleMode, clickDetails, scrollZoom].map(async (control) => {
    const bounds = await control.boundingBox();
    return { top: bounds.y, center: bounds.x + bounds.width / 2 };
  }));
  expect(controlPositions[1].top).toBeGreaterThan(controlPositions[0].top);
  expect(Math.abs(controlPositions[1].top - controlPositions[2].top)).toBeLessThanOrEqual(1);
  const benchmarkInputBox = await page.getByRole('combobox', { name: 'Benchmark' }).locator('..').boundingBox();
  const detailsButtonBox = await clickDetails.boundingBox();
  if (page.viewportSize().width >= 900) {
    expect(Math.abs(
      (benchmarkInputBox.y + benchmarkInputBox.height / 2)
      - (detailsButtonBox.y + detailsButtonBox.height / 2),
    )).toBeLessThanOrEqual(1);
  } else {
    expect(detailsButtonBox.y).toBeGreaterThanOrEqual(benchmarkInputBox.y + benchmarkInputBox.height);
  }
  await expect(page.getByRole('img', { name: /duration history/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByText('1 of 8 benchmarks selected', { exact: false })).toBeVisible();

  await page.getByRole('combobox', { name: 'Benchmarks to graph' }).click();
  const option = page.getByRole('option', { name: /GEMM BF16 4096/ });
  await expect(option.getByRole('checkbox')).not.toBeChecked();
  await option.click();
  await expect(option.getByRole('checkbox')).toBeChecked();
  await page.keyboard.press('Escape');

  await expect(page.getByText('2 of 8 benchmarks selected', { exact: false })).toBeVisible();
  await expect(page.getByTestId('benchmark-grid').getByRole('img', { name: /duration history/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Hide GEMM BF16 4096³ graph' }).click();
  await expect(page.getByTestId('benchmark-grid').getByRole('img', { name: /duration history/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Aggregate' }).click();
  await expect(page.getByRole('button', { name: 'Aggregate' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Selected-suite duration by target across all official attempts, including reruns')).toBeVisible();
  const aggregateInstructions = page.getByText(/official attempts · Selected runs remain visible while zooming/);
  const aggregateInstructionBox = await aggregateInstructions.boundingBox();
  const aggregateDetailsBox = await page.getByRole('button', { name: 'Disable details on click' }).boundingBox();
  expect(aggregateInstructionBox.y + aggregateInstructionBox.height).toBeLessThanOrEqual(aggregateDetailsBox.y);
  const aggregateChart = page.getByRole('img', { name: 'Aggregate duration history for all runs' });
  await expect(aggregateChart).toBeVisible();
  await page.waitForTimeout(350);
  const aggregateOption = await aggregateChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    return {
      runCount: option.xAxis[0].data.length,
      lineSeries: option.series.filter((series) => (
        series.type === 'line' && !series.name.includes('missed-data bridge')
      )).map((series) => ({
        name: series.name,
        showSymbol: series.showSymbol,
        hasLatestMarker: Boolean(series.markPoint?.data?.length),
      })),
      gapBridgeTypes: option.series
        .filter((series) => series.name.includes('missed-data bridge'))
        .map((series) => series.lineStyle.type),
      yAxisName: option.yAxis[0].name,
      yAxisScale: option.yAxis[0].scale,
      legendTargets: option.legend[0].data,
      zoomTypes: option.dataZoom.map((item) => item.type),
      initialStart: option.dataZoom[0].startValue,
      initialEnd: option.dataZoom[0].endValue,
    };
  });
  expect(aggregateOption.runCount).toBe(95);
  expect(aggregateOption.lineSeries.map((series) => series.name)).toEqual(['gfx1250']);
  expect(aggregateOption.lineSeries.every((series) => series.showSymbol === false)).toBe(true);
  expect(aggregateOption.lineSeries.every((series) => series.hasLatestMarker === false)).toBe(true);
  expect(aggregateOption.gapBridgeTypes.length).toBeGreaterThan(0);
  expect(aggregateOption.gapBridgeTypes.every((type) => type === 'dotted')).toBe(true);
  expect(aggregateOption.yAxisName).toBe('Seconds');
  expect(aggregateOption.yAxisScale).toBe(true);
  expect(aggregateOption.legendTargets).toEqual(aggregateOption.lineSeries.map((series) => series.name));
  expect(aggregateOption.zoomTypes.sort()).toEqual(['inside', 'slider']);
  expect(aggregateOption.initialEnd - aggregateOption.initialStart + 1).toBe(45);

  await aggregateChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    fiber.stateNode.getEchartsInstance().dispatchAction({ type: 'dataZoom', start: 82, end: 100 });
  });
  await page.waitForTimeout(400);
  const scaleBeforeSelection = await chartScale(aggregateChart);
  const disableDetailsOnClick = page.getByRole('button', { name: 'Disable details on click' });
  await expect(disableDetailsOnClick).toHaveAttribute('aria-pressed', 'true');
  await expect(disableDetailsOnClick).toHaveText('Click details · On');
  await disableDetailsOnClick.click();
  const enableDetailsOnClick = page.getByRole('button', { name: 'Enable details on click' });
  await expect(enableDetailsOnClick).toHaveAttribute('aria-pressed', 'false');
  await expect(enableDetailsOnClick).toHaveText('Click details · Off');
  await clickLastCompletedChartPoint(aggregateChart);
  await expect(page.getByText('Selected 31369c4d · Auto')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const clearRuns = page.getByRole('button', { name: /Clear selected runs/ });
  await expect(clearRuns).toHaveText('Clear selected runs (1)');
  expect(await chartScale(aggregateChart)).toEqual(scaleBeforeSelection);

  await clickLastCompletedChartPoint(aggregateChart);
  await expect(clearRuns).toHaveText('Clear selected runs (0)');
  expect(await chartScale(aggregateChart)).toEqual(scaleBeforeSelection);

  await clickLastCompletedChartPoint(aggregateChart);
  await page.waitForTimeout(400);
  await clickCompletedChartPoint(aggregateChart, 1);
  await expect(clearRuns).toHaveText('Clear selected runs (2)');
  await expect(page.getByText('2 selected runs · latest selection 9f774d29')).toBeVisible();

  await aggregateChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    fiber.stateNode.getEchartsInstance().dispatchAction({ type: 'dataZoom', start: 99.9, end: 100 });
  });
  await page.waitForTimeout(300);
  const aggregateSelectedViewport = await selectedDotsViewport(aggregateChart, 'Selected run');
  expect(aggregateSelectedViewport.indexes).toHaveLength(2);
  expect(aggregateSelectedViewport.allVisible).toBe(true);
  expect(aggregateSelectedViewport.startValue).toBeLessThanOrEqual(Math.min(...aggregateSelectedViewport.indexes));
  expect(aggregateSelectedViewport.endValue).toBeGreaterThanOrEqual(Math.max(...aggregateSelectedViewport.indexes));

  await page.getByRole('button', { name: 'Single' }).click();
  await expect(page.getByRole('button', { name: 'Single' })).toHaveAttribute('aria-pressed', 'true');
  const singleChart = page.getByRole('img', { name: /duration history/ });
  const singleHasSelection = await singleChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return [...new Set(fiber.stateNode.getEchartsInstance().getOption().series
      .filter((series) => series.name.endsWith('selected points'))
      .flatMap((series) => series.data)
      .filter(Boolean)
      .map((point) => point.record.run.runId))].length;
  });
  expect(singleHasSelection).toBe(2);
  await expect.poll(async () => (
    await selectedDotsViewport(singleChart, 'selected points')
  ).allVisible).toBe(true);

  await page.getByRole('button', { name: 'Grid' }).click();
  const gridChart = page.getByTestId('benchmark-grid').getByRole('img', { name: /duration history/ }).first();
  const gridHasSelection = await gridChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return [...new Set(fiber.stateNode.getEchartsInstance().getOption().series
      .filter((series) => series.name.endsWith('selected points'))
      .flatMap((series) => series.data)
      .filter(Boolean)
      .map((point) => point.record.run.runId))].length;
  });
  expect(gridHasSelection).toBe(2);
  await expect.poll(async () => (
    await selectedDotsViewport(gridChart, 'selected points')
  ).allVisible).toBe(true);

  await page.getByRole('button', { name: 'Aggregate' }).click();
  await expect(page.getByText('2 selected runs · latest selection 9f774d29')).toBeVisible();
  await expect.poll(() => aggregateChart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const series = fiber.stateNode.getEchartsInstance().getOption()?.series;
    const selected = series?.find((candidate) => candidate.name === 'Selected run');
    return new Set((selected?.data ?? [])
      .filter(Boolean)
      .map((point) => point.run.runId)).size;
  })).toBe(2);

  await enableDetailsOnClick.click();
  await expect(page.getByRole('button', { name: 'Disable details on click' })).toHaveText('Click details · On');
  await clickLastCompletedChartPoint(aggregateChart);
  const runDialog = page.getByRole('dialog');
  await expect(runDialog.getByText('Run Details')).toBeVisible();
  await expect(runDialog.getByText('Commit 31369c4d · Auto')).toBeVisible();
  if (page.viewportSize().width >= 600) {
    const commitLabel = await runDialog.getByText('RocJitsu commit', { exact: true }).boundingBox();
    const messageLabel = await runDialog.getByText('Commit message', { exact: true }).boundingBox();
    expect(messageLabel.x).toBeGreaterThan(commitLabel.x);
  }
  await expectDialogTypographyContained(runDialog);
  await page.getByRole('button', { name: 'Close Run Details' }).click();
});

test('benchmark explorer scroll zoom is enabled by default and can be disabled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const chart = page.getByRole('img', { name: /duration history/ });
  const disableScrollZoom = page.getByRole('button', { name: 'Disable scroll zoom' });
  await expect(disableScrollZoom).toHaveAttribute('aria-pressed', 'true');
  await expect(disableScrollZoom).toHaveText('Scroll zoom · On');

  const insideZoomDisabled = () => chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return fiber.stateNode.getEchartsInstance().getOption().dataZoom[0].disabled;
  });
  await expect.poll(insideZoomDisabled).toBe(false);

  await disableScrollZoom.click();
  const enableScrollZoom = page.getByRole('button', { name: 'Enable scroll zoom' });
  await expect(enableScrollZoom).toHaveAttribute('aria-pressed', 'false');
  await expect(enableScrollZoom).toHaveText('Scroll zoom · Off');
  await expect.poll(insideZoomDisabled).toBe(true);
});

test('benchmark history bridges gaps and opens failed result details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const chart = page.getByRole('img', { name: 'GEMM FP16 1024³ duration history' });
  await expect(chart).toBeVisible();
  const gapPresentation = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    const bridges = option.series.filter((series) => series.name.includes('missed-data bridge'));
    const statuses = option.series.find((series) => series.name === 'Failed or timed-out test results');
    return {
      bridgeTypes: bridges.map((series) => series.lineStyle.type),
      statuses: statuses.data.map((point) => point.record.test.status),
    };
  });
  expect(gapPresentation.bridgeTypes.length).toBeGreaterThan(0);
  expect(gapPresentation.bridgeTypes.every((type) => type === 'dotted')).toBe(true);
  expect(gapPresentation.statuses).toContain('failed');

  await clickLastStatusChartPoint(chart);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Failed', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Simulation exited before producing a valid timing result')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close details' }).click();
  const failedSelection = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    const marker = option.series
      .find((series) => series.name === 'Failed or timed-out test results')
      ?.data.find((point) => point.selected);
    return {
      markerSize: marker?.symbolSize,
      borderWidth: marker?.itemStyle?.borderWidth,
      shadowBlur: marker?.itemStyle?.shadowBlur,
      hasRippleEffect: option.series.some((series) => series.type === 'effectScatter'),
    };
  });
  expect(failedSelection).toMatchObject({
    borderWidth: 4,
    shadowBlur: 13,
    hasRippleEffect: false,
  });
  expect(failedSelection.markerSize).toBeGreaterThanOrEqual(14);
  expect(failedSelection.markerSize).toBeLessThanOrEqual(17);
});

test('historical rows and completed chart points open shared provenance details', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  await page.getByTestId('historical-records').getByRole('row', { name: /31369c4d/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Run Provenance')).toBeVisible();
  expect(await dialog.getByText(/^(Environment|Run Provenance)$/).allTextContents()).toEqual([
    'Environment',
    'Run Provenance',
  ]);
  await expect(dialog.getByRole('link', { name: 'Commit 31369c4d' })).toBeVisible();
  await expect(dialog.getByText('Validate follow-up scheduler tuning')).toBeVisible();
  await expect(dialog.getByText('ROCm SDK', { exact: true })).toBeVisible();
  await expect(dialog.getByText('7.2.0.dev202608', { exact: true })).toBeVisible();
  await expect(dialog.getByText('PyTorch', { exact: true })).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const machineLabel = await dialog.getByText('Machine', { exact: true }).boundingBox();
    const commitLabel = await dialog.getByText('RocJitsu commit', { exact: true }).boundingBox();
    expect(commitLabel.x).toBeGreaterThan(machineLabel.x);
  }
  await page.getByRole('button', { name: 'Close details' }).click();

  const chart = page.getByRole('img', { name: 'GEMM FP16 1024³ duration history' });
  const clearRuns = page.getByRole('button', { name: /Clear selected runs/ });
  const disableDetails = page.getByRole('button', { name: 'Disable details on click' });
  await expect(clearRuns).toHaveText('Clear selected runs (0)');
  await expect(clearRuns).toBeDisabled();
  await expect(disableDetails).toHaveAttribute('aria-pressed', 'true');
  await disableDetails.click();
  const chartPresentation = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    const zoom = option.dataZoom[0];
    const visibleValues = option.series
      .filter((series) => series.type === 'line')
      .flatMap((series) => series.data
        .slice(zoom.startValue, zoom.endValue + 1)
        .map((point) => point?.value)
        .filter(Number.isFinite));
    return {
      lineSymbols: option.series
        .filter((series) => series.type === 'line')
        .map((series) => series.showSymbol),
      xAxisName: option.xAxis[0].name,
      yAxisName: option.yAxis[0].name,
      yAxisMinimum: option.yAxis[0].min,
      yAxisMaximum: option.yAxis[0].max,
      visibleMinimum: Math.min(...visibleValues),
      visibleMaximum: Math.max(...visibleValues),
      tooltipRenderMode: option.tooltip[0].renderMode,
      tooltipTriggerOn: option.tooltip[0].triggerOn,
    };
  });
  expect(chartPresentation.lineSymbols.every((showSymbol) => showSymbol === false)).toBe(true);
  expect(chartPresentation.xAxisName).toBe('Commit date / commit');
  expect(chartPresentation.yAxisName).toBe('Seconds');
  expect(chartPresentation.yAxisMinimum).toBeGreaterThan(0);
  expect(chartPresentation.yAxisMaximum).toBeGreaterThan(chartPresentation.yAxisMinimum);
  expect(chartPresentation.yAxisMaximum - chartPresentation.yAxisMinimum).toBeGreaterThanOrEqual(
    (chartPresentation.visibleMaximum - chartPresentation.visibleMinimum) * 2,
  );
  expect(chartPresentation.tooltipRenderMode).not.toBe('richText');
  expect(chartPresentation.tooltipTriggerOn).toBe('mousemove');

  await page.waitForTimeout(600);
  await clickLastCompletedChartPoint(chart);
  await expect(dialog).not.toBeVisible();
  await expect(clearRuns).toHaveText('Clear selected runs (1)');
  await clickLastCompletedChartPoint(chart);
  await expect(clearRuns).toHaveText('Clear selected runs (0)');

  await page.getByRole('button', { name: 'Enable details on click' }).click();
  await clickLastCompletedChartPoint(chart);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Commit 31369c4d' })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(clearRuns).toHaveText('Clear selected runs (1)');

  await page.waitForTimeout(700);
  // Keep enough horizontal distance from the selected latest point for narrow
  // viewports, where adjacent scatter hit targets intentionally overlap.
  await clickCompletedChartPoint(chart, 5);
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(clearRuns).toHaveText('Clear selected runs (2)');
  await page.waitForTimeout(100);
  const pinnedPointCount = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return fiber.stateNode.getEchartsInstance().getOption().series
      .filter((series) => series.name.endsWith('selected points'))
      .flatMap((series) => series.data)
      .filter(Boolean).length;
  });
  expect(pinnedPointCount).toBe(2);
  await clearRuns.click();
  await expect(clearRuns).toHaveText('Clear selected runs (0)');
  await expect(clearRuns).toBeDisabled();
});

test('hides unavailable optional provenance fields and columns', async () => {
  const rawData = cloneBenchmarkData();
  rawData.runs.forEach((run) => {
    delete run.provenance.commitMessage;
    delete run.provenance.details;
    delete run.provenance.rocmSdkVersion;
    delete run.provenance.pythonVersion;
    delete run.provenance.torchVersion;
    delete run.provenance.tritonCommitSha;
    delete run.provenance.tensileLiteCommitSha;
  });
  const data = loadDashboardData(rawData);

  expect(data.runs.every((run) => provenanceDetails(run.provenance).length === 0)).toBe(true);
  expect(data.runs.every((run) => !Object.hasOwn(run.provenance, 'commitMessage'))).toBe(true);
  expect(data.runs.every((run) => Boolean(run.provenance.rocjitsuCommitSha))).toBe(true);
});

test('benchmark history keeps same-day commits as separate points', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const chart = page.getByRole('img', { name: 'GEMM FP16 1024³ duration history' });
  const latestLabels = await chart.evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    return fiber.stateNode.getEchartsInstance().getOption().xAxis[0].data.slice(-3);
  });
  expect(latestLabels).toHaveLength(3);
  expect(new Set(latestLabels).size).toBe(3);
  expect(latestLabels.join(' ')).toContain('255eabe3');
  expect(latestLabels.join(' ')).toContain('9f774d29');
  expect(latestLabels.join(' ')).toContain('31369c4d');
});

test('historical records renders one bounded page at a time', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Benchmarks' }).click();

  const history = page.getByTestId('historical-records');
  await expect(history.locator('tbody tr')).toHaveCount(25);
  await expect(history.getByText('1–25 of 95 results')).toBeVisible();
  await history.getByRole('button', { name: 'Go to next page' }).click();
  await expect(history.getByText('26–50 of 95 results')).toBeVisible();
  await expect(history.locator('tbody tr')).toHaveCount(25);

  await history.getByRole('combobox', { name: 'Rows per page' }).click();
  await page.getByRole('option', { name: '50' }).click();
  await expect(history.getByText('1–50 of 95 results')).toBeVisible();
  await expect(history.locator('tbody tr')).toHaveCount(50);
});

test('opens benchmark details and toggles theme', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('row', { name: /GEMM FP16 1024/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Result', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Problem Details', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Run Provenance', { exact: true })).toBeVisible();
  expect(await dialog.getByText(/^(Environment|Run Provenance)$/).allTextContents()).toEqual([
    'Environment',
    'Run Provenance',
  ]);
  await expect(dialog.getByText('Status', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Duration', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Operation', { exact: true }).locator('..')).toContainText('GEMM');
  await expect(dialog.getByText('Data type', { exact: true }).locator('..')).toContainText('fp16');
  if (testInfo.project.name === 'desktop') {
    const machineLabel = await dialog.getByText('Machine', { exact: true }).boundingBox();
    const commitLabel = await dialog.getByText('RocJitsu commit', { exact: true }).boundingBox();
    expect(commitLabel.x).toBeGreaterThan(machineLabel.x);
  }
  await expect(dialog.getByText('Baseline run', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Raw problem configuration', { exact: true })).toHaveCount(0);
  await expectDialogTypographyContained(dialog);
  await page.getByRole('button', { name: 'Close details' }).click();

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.getByRole('button', { name: 'Use light theme' })).toBeVisible();
});

test('latest results can be sorted by every column', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'All result columns are visible at laptop width');
  await page.goto('/');

  const results = page.getByTestId('latest-results');
  const labels = ['Target', 'Suite', 'Benchmark', 'Type', 'Problem', 'Duration', 'Baseline', 'Change', 'Status'];
  for (const label of labels) {
    const header = results.getByRole('columnheader', { name: label, exact: true });
    await header.getByRole('button', { name: label, exact: true }).click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
  }

  const durationHeader = results.getByRole('columnheader', { name: 'Duration', exact: true });
  await expect(durationHeader.getByRole('button', { name: 'Duration', exact: true })).toHaveCSS('flex-direction', 'row');
  await expect(durationHeader.locator('.MuiTableSortLabel-icon')).toHaveCSS('position', 'absolute');
  const durationCell = results.locator('tbody tr').first().locator('td').nth(5);
  const rightPadding = await Promise.all([
    durationHeader.evaluate((element) => getComputedStyle(element).paddingRight),
    durationCell.evaluate((element) => getComputedStyle(element).paddingRight),
  ]);
  expect(rightPadding[0]).toBe(rightPadding[1]);
  await durationHeader.getByRole('button', { name: 'Duration', exact: true }).click();
  const durations = (await results.locator('tbody tr td:nth-child(6)').allTextContents()).map((value) => Number.parseFloat(value));
  expect(durations).toEqual([...durations].sort((left, right) => left - right));
  await durationHeader.getByRole('button', { name: 'Duration', exact: true }).click();
  await expect(durationHeader).toHaveAttribute('aria-sort', 'descending');
});

test('latest results precedes recent runs and renders one bounded page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Targets').click();
  await page.getByRole('option', { name: /Check all targets/ }).click();
  await page.keyboard.press('Escape');

  const results = page.getByTestId('latest-results');
  const recentRunsTable = page.getByTestId('recent-runs-table');
  const resultsComeFirst = await results.evaluate((element, recentRuns) => (
    Boolean(element.compareDocumentPosition(recentRuns) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await recentRunsTable.elementHandle());
  expect(resultsComeFirst).toBe(true);

  await expect(results.locator('tbody tr')).toHaveCount(10);
  await expect(results.getByText('1–10 of 14 results')).toBeVisible();
  await results.getByRole('button', { name: 'Go to next page' }).click();
  await expect(results.getByText('11–14 of 14 results')).toBeVisible();
  await expect(results.locator('tbody tr')).toHaveCount(4);
});

test('target and suite filters use checkbox menus with check-all controls', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Targets').click();
  await expect(page.getByRole('option', { name: /Check all targets/ })).toBeVisible();
  await expect(page.getByRole('option', { name: 'gfx1250' })).toBeVisible();
  await page.getByRole('option', { name: /Check all targets/ }).click();
  await expect(page.getByText('gfx950', { exact: true }).first()).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByLabel('Suites').click();
  await expect(page.getByRole('option', { name: /Check all suites/ })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Triton' })).toBeVisible();
});

test('suite filter keeps labels visible until they approach the dropdown control', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Responsive resizing is covered in the desktop project');
  await page.goto('/');

  const suites = page.getByTestId('suites-filter');
  await expect(suites.locator('[data-responsive-tag]')).toHaveCount(3);
  await expect(suites.locator('[data-overflow-tag]')).toHaveCount(0);

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(suites.locator('[data-responsive-tag]')).toHaveCount(1);
  await expect(suites.locator('[data-overflow-tag]')).toHaveText('+2');
  const spacing = await suites.evaluate((element) => {
    const overflow = element.querySelector('[data-overflow-tag]').getBoundingClientRect();
    const controls = element.querySelector('.MuiAutocomplete-endAdornment').getBoundingClientRect();
    return controls.left - overflow.right;
  });
  expect(spacing).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(suites.locator('[data-responsive-tag]')).toHaveCount(3);
  await expect(suites.locator('[data-overflow-tag]')).toHaveCount(0);
});

test('keeps timeframe controls local to the duration history', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Comparison period')).toHaveCount(0);
  await expect(page.getByLabel('History range')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'All available history' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/\d+ UTC commit dates? shown/)).toBeVisible();
  await expect(page.getByTestId('performance-range-change')).toHaveAttribute('data-change-state', 'faster');
  await expect(page.getByTestId('performance-range-change')).toContainText('1.3%');
  await expect(page.getByText('Latest vs first shown in ALL')).toBeVisible();

  await page.getByRole('button', { name: 'Trailing 7 days' }).click();
  await expect(page.getByText(/\d+ UTC commit dates? shown/)).toBeVisible();
  await expect(page.getByTestId('performance-range-change')).toHaveAttribute('data-change-state', 'slower');
  await expect(page.getByTestId('performance-range-change')).toContainText('0.5%');
  await expect(page.getByText('Latest vs first shown in 1W')).toBeVisible();

  await page.getByRole('button', { name: 'Trailing 24 hours' }).click();
  await expect(page.getByText('3 completed runs shown')).toBeVisible();
  await expect(page.getByTestId('performance-range-change')).toHaveAttribute('data-change-state', 'faster');
  await expect(page.getByTestId('performance-range-change')).toContainText('1.2%');
  await expect(page.getByText('Latest vs first shown in 1D')).toBeVisible();
  const intradayTooltip = await page.getByRole('img', { name: 'Performance trend for 1D' }).evaluate((element) => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = element[fiberKey];
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return;
    const option = fiber.stateNode.getEchartsInstance().getOption();
    const series = option.series.find((candidate) => candidate.type === 'line');
    const dataIndex = series.data.findIndex((value) => Number.isFinite(value));
    return option.tooltip[0].formatter([{
      dataIndex,
      value: series.data[dataIndex],
      marker: '',
      seriesName: series.name,
    }]);
  });
  expect(intradayTooltip).toContain('Run time ·');
  expect(intradayTooltip).toContain('Commit time ·');
});

test('largest changes uses a fixed three-percent noise tolerance', async ({ page }) => {
  await page.goto('/');

  const largestChanges = page.getByTestId('largest-changes');
  await expect(page.getByLabel('Noise tolerance')).toHaveCount(0);
  await expect(page.getByText('Largest benchmark changes in the Overview comparison', { exact: true })).toBeVisible();
  await expect(largestChanges.locator('[data-legend-state="slower"]')).toHaveText('Slower');
  await expect(largestChanges.locator('[data-legend-state="neutral"]')).toHaveText('Within ±3%');
  await expect(largestChanges.locator('[data-legend-state="faster"]')).toHaveText('Faster');
  await expect(largestChanges.getByText(/Slower >|Faster </)).toHaveCount(0);
  await expect(largestChanges.locator('[data-change-state="neutral"]')).toHaveCount(3);
});

test('recent runs contains horizontal scrolling on compact laptops', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-width assertion');

  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const documentWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client);

    const table = page.getByTestId('recent-runs-table');
    await expect(table).toBeVisible();
    const tableWidths = await table.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    if (width < 1200) {
      expect(tableWidths.scroll).toBeGreaterThan(tableWidths.client);
    } else {
      expect(tableWidths.scroll).toBeLessThanOrEqual(tableWidths.client);
    }
  }
});

test('does not overflow the mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only assertion');
  await page.goto('/');
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole('heading', { name: 'RocJitsu Performance Health' })).toBeVisible();
});
