import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Chip,
  Container,
  CssBaseline,
  Paper,
  Stack,
  Tab,
  Tabs,
  ThemeProvider,
  Typography,
} from '@mui/material';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import DashboardHeader from './components/layout/DashboardHeader';
import FiltersBar from './components/layout/FiltersBar';
import OverviewView from './components/overview/OverviewView';
import BenchmarksView from './components/views/BenchmarksView';
import CompareRunsView from './components/views/CompareRunsView';
import FailuresView from './components/views/FailuresView';
import { loadDashboardData } from './data/dashboardData';
import { selectFailures, selectOverview } from './data/selectors';
import { useDashboardState } from './hooks/useDashboardState';
import { createDashboardTheme } from './theme/theme';
import { formatFullDate, shortSha } from './utils/formatters';

let dashboardData = null;
let dashboardError = null;
try {
  dashboardData = loadDashboardData();
  if (!dashboardData.latestRun) throw new Error('data.js does not contain any benchmark runs');
  if (!dashboardData.latestCompletedRun) throw new Error('data.js does not contain a completed official run');
} catch (error) {
  dashboardError = error;
}

function EmptyDataState() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Alert severity="error" variant="outlined">
        <Typography fontWeight={700}>Dashboard data unavailable</Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>{dashboardError?.message}</Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>Make sure <code>data.js</code> loads before the React application and defines <code>window.ROCJITSU_BENCHMARK_DATA</code>.</Typography>
      </Alert>
    </Container>
  );
}

function Dashboard() {
  const data = dashboardData;
  const state = useDashboardState(data);
  const overview = useMemo(
    () => selectOverview(data, state.filters, state.historyRange),
    [data, state.filters, state.historyRange],
  );
  const failureCount = useMemo(() => selectFailures(data, state.filters).length, [data, state.filters]);
  const openRunComparison = (runIds) => {
    const selectedRuns = runIds
      .map((runId) => data.runs.find((run) => run.runId === runId))
      .filter(Boolean);
    if (selectedRuns.length !== 2) return;
    state.setComparisonCandidateId(selectedRuns[0].runId);
    state.setComparisonBaselineId(selectedRuns[1].runId);
    state.setTab('compare');
  };
  const openRunInExplorer = (runId) => {
    state.setExplorerRunIds([runId]);
    state.setTab('benchmarks');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };
  const selectExplorerRun = (runId) => {
    state.setExplorerRunIds((current) => (
      current.includes(runId)
        ? current.filter((candidateId) => candidateId !== runId)
        : [...current, runId]
    ));
  };

  return (
    <>
      <Box component="main" sx={{ minHeight: 'calc(100vh - 140px)' }}>
        <Container maxWidth={false} sx={{ maxWidth: 1600, px: { xs: 2, sm: 3, xl: 4 }, pt: { xs: 2.5, md: 3.5 }, pb: 6 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'flex-end' }, gap: 2, mb: 2.5 }}>
            <Box>
              <Typography component="h1" variant="h1">RocJitsu Performance Health</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.7, maxWidth: 760 }}>
                Track benchmark performance, regressions, and run coverage across selected GFX targets.
              </Typography>
            </Box>
            <Paper data-testid="latest-commit-run" variant="outlined" sx={{ py: 1.1, px: 1.5, borderRadius: 2.5, bgcolor: 'action.hover' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <AccessTimeRoundedIcon color="primary" sx={{ fontSize: 18 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Latest commit run</Typography>
                  <Stack direction="row" sx={{ gap: 0.8, alignItems: 'center' }}>
                    <Typography variant="caption" fontWeight={700}>{formatFullDate(data.latestCommitRun.timestamp)}</Typography>
                    <Chip label={shortSha(data.latestCommitRun)} size="small" sx={{ height: 20, fontFamily: 'monospace', fontSize: 10 }} />
                  </Stack>
                </Box>
              </Stack>
            </Paper>
          </Stack>

          <FiltersBar data={data} state={state} />

          <Paper data-testid="dashboard-navigation" variant="outlined" sx={{ mt: 1.75, mb: 1.75, borderRadius: 3, overflow: 'hidden' }}>
            <Tabs
              value={state.tab}
              onChange={(_, value) => {
                if (value === 'benchmarks') state.setExplorerRunIds([]);
                state.setTab(value);
              }}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Dashboard views"
              sx={{ px: { xs: 0.5, sm: 1.25 }, minHeight: 50 }}
            >
              <Tab value="overview" label="Overview" />
              <Tab value="benchmarks" label="Benchmarks" />
              <Tab value="compare" label="Run Comparison" />
              <Tab
                value="failures"
                sx={{ minWidth: 112, px: 2.75 }}
                label={<Badge badgeContent={failureCount} color="error" max={99} sx={{ '& .MuiBadge-badge': { right: -13, top: 7 } }}>Failures</Badge>}
              />
            </Tabs>
          </Paper>

          {state.tab === 'overview' && (
            <OverviewView
              viewModel={overview}
              data={data}
              state={state}
              onCompareRun={openRunComparison}
              onExploreRun={openRunInExplorer}
            />
          )}
          {state.tab === 'benchmarks' && (
            <BenchmarksView
              data={data}
              filters={state.filters}
              selectedRunIds={state.explorerRunIds}
              onSelectRun={selectExplorerRun}
              onClearSelectedRuns={() => state.setExplorerRunIds([])}
            />
          )}
          {state.tab === 'compare' && (
            <CompareRunsView
              data={data}
              filters={state.filters}
              selectedBaselineId={state.comparisonBaselineId}
              selectedCandidateId={state.comparisonCandidateId}
              onBaselineChange={state.setComparisonBaselineId}
              onCandidateChange={state.setComparisonCandidateId}
            />
          )}
          {state.tab === 'failures' && <FailuresView data={data} filters={state.filters} />}
        </Container>
      </Box>
      <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth={false} sx={{ maxWidth: 1600, px: { xs: 2, sm: 3, xl: 4 }, py: 2.25 }}>
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Typography variant="caption" color="text.secondary">Data schema v{data.schemaVersion}</Typography>
          </Stack>
        </Container>
      </Box>
    </>
  );
}

export default function App() {
  const preferredMode = window.localStorage.getItem('rocjitsu-color-mode')
    ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [mode, setMode] = useState(preferredMode);
  const theme = useMemo(() => createDashboardTheme(mode), [mode]);

  const toggleMode = () => {
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('rocjitsu-color-mode', next);
      return next;
    });
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {dashboardError ? <EmptyDataState /> : (
        <>
          <DashboardHeader data={dashboardData} mode={mode} onToggleMode={toggleMode} />
          <Dashboard />
        </>
      )}
    </ThemeProvider>
  );
}
