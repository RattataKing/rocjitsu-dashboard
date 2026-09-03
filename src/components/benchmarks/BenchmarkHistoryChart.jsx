import { useMemo, useState } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import Chart from '../shared/Chart';
import { selectBenchmarkSeries } from '../../data/selectors';
import { commitTimestampFor } from '../../data/runOrdering';
import { formatDuration, formatFullDate, shortSha } from '../../utils/formatters';
import { chartAreaGradient, chartLineStyle, chartPointStyle } from '../../utils/chartStyles';
import { durationAxisBounds } from '../../utils/durationAxis';
import { initialZoomWindow, zoomFromEvent, zoomIncludingIndexes, zoomIndexRange } from '../../utils/chartZoom';

const INITIAL_VISIBLE_RUNS = 45;

export default function BenchmarkHistoryChart({
  data,
  filters,
  benchmark,
  height = 370,
  selectedRunIds = [],
  onSelectRecord,
  onSelectRun,
  showDetailsOnClick = false,
  scrollZoomEnabled = true,
}) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const viewModel = useMemo(
    () => selectBenchmarkSeries(data, filters, benchmark.id),
    [benchmark.id, data, filters],
  );
  const selectedRunIdSet = useMemo(() => new Set(selectedRunIds), [selectedRunIds]);
  const selectedIndexes = useMemo(() => viewModel.runs
    .map((run, index) => (selectedRunIdSet.has(run.runId) ? index : -1))
    .filter((index) => index >= 0), [selectedRunIdSet, viewModel.runs]);
  const [initialAnchorRunId] = useState(() => selectedRunIds.at(-1) ?? null);
  const initialAnchorIndex = viewModel.runs.findIndex((run) => run.runId === initialAnchorRunId);
  const [zoom, setZoom] = useState(() => (
    zoomIncludingIndexes(
      initialZoomWindow(viewModel.runs.length, INITIAL_VISIBLE_RUNS, initialAnchorIndex),
      viewModel.runs.length,
      selectedIndexes,
    )
  ));
  const displayZoom = zoomIncludingIndexes(zoom, viewModel.runs.length, selectedIndexes);
  const { startIndex, endIndex } = zoomIndexRange(displayZoom, viewModel.runs.length);
  const chartValues = viewModel.series.flatMap((series) => (
    series.points
      .slice(startIndex, endIndex + 1)
      .map((point) => point?.value)
      .filter(Number.isFinite)
  ));
  const durationAxis = durationAxisBounds(chartValues);
  const minimumValue = chartValues.length ? Math.min(...chartValues) : 0;
  const unavailableMarkerData = selectedIndexes.flatMap((index) => {
    const unavailableTargets = viewModel.series
      .filter((series) => !series.points[index]?.record)
      .map((series) => series.name);
    if (unavailableTargets.length === 0) return [];
    return [{
      value: [index, minimumValue],
      run: viewModel.runs[index],
      unavailableTargets,
      label: {
        show: true,
        formatter: unavailableTargets.length === 1 ? 'N/A' : `N/A · ${unavailableTargets.join(', ')}`,
        position: 'top',
        color: theme.palette.text.secondary,
        fontSize: 10,
        fontWeight: 700,
      },
    }];
  });
  const option = {
    color: viewModel.series.map((series) => series.color),
    tooltip: {
      trigger: 'axis',
      triggerOn: showDetailsOnClick ? 'mousemove|click' : 'mousemove',
      backgroundColor: theme.palette.background.paper,
      borderColor: theme.palette.divider,
      textStyle: { color: theme.palette.text.primary },
      formatter: (parameters) => {
        const points = (Array.isArray(parameters) ? parameters : [parameters])
          .filter((point) => point.seriesType === 'line' && point.data?.record);
        if (points.length === 0) return 'No completed result';
        const run = points[0].data.record.run;
        return [
          `<strong>Run time · ${formatFullDate(run.timestamp)}</strong>`,
          `Commit ${shortSha(run)} · ${formatFullDate(commitTimestampFor(run))}`,
          ...points.map((point) => `${point.marker}${point.seriesName}&nbsp;&nbsp;<strong>${formatDuration(point.data.value)}</strong>`),
        ].join('<br/>');
      },
    },
    legend: {
      data: viewModel.series.map((series) => series.name),
      top: 0,
      right: 0,
      textStyle: { color: theme.palette.text.secondary },
    },
    grid: { left: 52, right: 18, top: 42, bottom: 58 },
    xAxis: {
      type: 'category',
      name: 'Commit date / commit',
      nameLocation: 'middle',
      nameGap: 43,
      data: viewModel.labels,
      axisLabel: { color: theme.palette.text.secondary, fontSize: 10, lineHeight: 14, hideOverlap: true },
      nameTextStyle: { color: theme.palette.text.secondary, fontSize: 11 },
      axisLine: { lineStyle: { color: theme.palette.divider } },
    },
    yAxis: {
      type: 'value',
      name: 'Seconds',
      ...durationAxis,
      axisLabel: { color: theme.palette.text.secondary },
      splitLine: { lineStyle: { color: theme.palette.divider, type: 'dashed' } },
    },
    dataZoom: [{ type: 'inside', disabled: !scrollZoomEnabled, ...displayZoom }],
    series: viewModel.series.map((series) => ({
        name: series.name,
        type: 'line',
        data: series.points,
        smooth: 0.18,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: compact ? 4 : 6,
        connectNulls: false,
        lineStyle: chartLineStyle(series.color, 2.7),
        itemStyle: chartPointStyle(series.color, theme.palette.background.paper),
        areaStyle: { color: chartAreaGradient(series.color, 0.13), opacity: 1 },
        emphasis: { focus: 'series', scale: 1.6, lineStyle: { width: 3.3 } },
      })).concat(viewModel.series.map((series) => ({
      name: `${series.name} point details`,
      type: 'scatter',
      data: series.points,
      symbolSize: compact ? 18 : 14,
      itemStyle: { color: 'rgba(0, 0, 0, 0.001)' },
      emphasis: { scale: false },
      tooltip: { show: showDetailsOnClick },
      z: 10,
    }))).concat(viewModel.series.map((series) => ({
      name: `${series.name} selected points`,
      type: 'scatter',
      data: series.points.map((point) => (
        point?.record && selectedRunIdSet.has(point.record.run.runId) ? point : null
      )),
      symbol: 'circle',
      symbolSize: compact ? 9 : 12,
      clip: false,
      itemStyle: { ...chartPointStyle(series.color, theme.palette.background.paper), borderWidth: 3 },
      emphasis: { scale: 1.25 },
      tooltip: { show: false },
      z: 12,
    }))).concat(unavailableMarkerData.length > 0 ? [{
      name: 'Selected runs unavailable',
      type: 'scatter',
      data: unavailableMarkerData,
      symbol: 'circle',
      symbolSize: compact ? 9 : 12,
      clip: false,
      itemStyle: { ...chartPointStyle(theme.palette.text.disabled, theme.palette.background.paper), borderWidth: 3 },
      emphasis: { scale: 1.25 },
      tooltip: { show: false },
      z: 12,
    }] : []),
  };
  const chartEvents = useMemo(() => ({
    click: (parameters) => {
      if (parameters.componentType === 'series' && parameters.data?.record) {
        setZoom((current) => zoomIncludingIndexes(
          current,
          viewModel.runs.length,
          selectedIndexes,
        ));
        onSelectRecord(parameters.data.record);
      } else if (parameters.componentType === 'series' && parameters.data?.run) {
        setZoom((current) => zoomIncludingIndexes(
          current,
          viewModel.runs.length,
          selectedIndexes,
        ));
        onSelectRun(parameters.data.run.runId);
      }
    },
    datazoom: (parameters) => {
      setZoom((current) => zoomIncludingIndexes(
        zoomFromEvent(parameters, current),
        viewModel.runs.length,
        selectedIndexes,
      ));
    },
  }), [onSelectRecord, onSelectRun, selectedIndexes, viewModel.runs.length]);

  return (
    <Chart
      option={option}
      height={height}
      ariaLabel={`${benchmark.name} duration history`}
      onEvents={chartEvents}
    />
  );
}
