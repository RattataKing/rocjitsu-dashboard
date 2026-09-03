import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RunReliability from '../failures/RunReliability';
import StatusChip from '../shared/StatusChip';
import { selectFailures, selectRunReliability } from '../../data/selectors';
import { formatFullDate, shortSha } from '../../utils/formatters';

export default function FailuresView({ data, filters }) {
  const failures = selectFailures(data, filters);
  const reliability = selectRunReliability(data, filters);

  return (
    <Stack sx={{ gap: 1.75 }}>
      <RunReliability reliability={reliability} />
      {failures.length === 0 ? (
        <Alert severity="success">No failed or timed-out cases match the current filters.</Alert>
      ) : (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 2.25 }}>
            <ErrorOutlineRoundedIcon color="error" />
            <Box>
              <Typography variant="h2">Failed and Timed-Out Cases</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>Newest first · Current filters</Typography>
            </Box>
            <Chip label={failures.length} color="error" size="small" sx={{ ml: 'auto' }} />
          </Stack>
          <Stack sx={{ gap: 1 }}>
            {failures.map(({ run, test }) => (
              <Paper key={`${run.runId}:${test.testId}`} variant="outlined" sx={{ p: 1.75, bgcolor: 'action.hover' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5 }}>
                  <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.55 }}>
                      <Typography variant="body2" fontWeight={700}>{test.name}</Typography>
                      <StatusChip status={test.status} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{test.target} · {test.suite} · {test.error}</Typography>
                  </Box>
                  <Box sx={{ textAlign: { sm: 'right' }, flexShrink: 0 }}>
                    <Typography variant="caption" sx={{ display: 'block' }}>{formatFullDate(run.timestamp)}</Typography>
                    <Typography variant="caption" color="primary.main" component="code">{shortSha(run)}</Typography>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
