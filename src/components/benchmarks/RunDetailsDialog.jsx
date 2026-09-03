import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import DetailItem from '../shared/DetailItem';
import { commitTimestampFor } from '../../data/runOrdering';
import { provenanceDetails } from '../../data/provenance';
import { formatDuration, formatFullDate, shortSha } from '../../utils/formatters';
import { hasDisplayValue } from '../../utils/values';

export default function RunDetailsDialog({ run, filters, repository, onClose }) {
  const selectedTests = (run?.tests ?? []).filter((test) => (
    filters.targets.includes(test.target) && filters.suites.includes(test.suite)
  ));
  const completedTests = selectedTests.filter((test) => (
    test.status === 'completed' && Number.isFinite(test.durationSeconds)
  ));
  const complete = selectedTests.length > 0 && completedTests.length === selectedTests.length;
  const duration = complete
    ? completedTests.reduce((total, test) => total + test.durationSeconds, 0)
    : null;
  const provenance = run?.provenance ?? {};
  const commitSha = provenance.rocjitsuCommitSha;

  return (
    <Dialog open={Boolean(run)} onClose={onClose} fullWidth maxWidth="sm">
      {run && (
        <>
          <DialogTitle component="div" sx={{ pr: 7 }}>
            <Typography variant="h2" sx={{ lineHeight: '24px' }}>Run details</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, lineHeight: '21px' }}>
              Commit {shortSha(run)} · {run.trigger === 'manual' ? 'Manual' : 'Auto'}
            </Typography>
            <IconButton onClick={onClose} aria-label="Close run details" sx={{ position: 'absolute', top: 11, right: 11 }}>
              <CloseRoundedIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <Typography component="div" variant="overline" color="text.secondary" sx={{ fontSize: '11px', lineHeight: '20px', mb: 1.25 }}>Selected scope</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2.2 }}>
              <DetailItem label="Coverage">{completedTests.length}/{selectedTests.length} completed</DetailItem>
              <DetailItem label="Total duration">{formatDuration(duration)}</DetailItem>
              <DetailItem label="Run time">{formatFullDate(run.timestamp)}</DetailItem>
              <DetailItem label="Commit time">{formatFullDate(commitTimestampFor(run))}</DetailItem>
            </Box>

            <Divider sx={{ my: 2.5 }} />
            <Typography component="div" variant="overline" color="text.secondary" sx={{ fontSize: '11px', lineHeight: '20px', mb: 1.25 }}>Run provenance</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2.2 }}>
              <DetailItem label="RocJitsu commit" wide>{commitSha}</DetailItem>
              {hasDisplayValue(provenance.commitMessage) && <DetailItem label="Commit message" wide>{provenance.commitMessage}</DetailItem>}
              {hasDisplayValue(run.machineId) && <DetailItem label="Machine">{run.machineId}</DetailItem>}
              {hasDisplayValue(run.branch) && <DetailItem label="Branch">{run.branch}</DetailItem>}
              {provenanceDetails(provenance).map((detail) => (
                <DetailItem key={detail.key} label={detail.label}>{detail.value}</DetailItem>
              ))}
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 1.5 }}>
            {repository && commitSha && (
              <Button
                component={Link}
                href={`${repository}/commit/${commitSha}`}
                target="_blank"
                rel="noreferrer"
                endIcon={<OpenInNewRoundedIcon />}
                sx={{ mr: 'auto' }}
              >
                Commit {shortSha(run)}
              </Button>
            )}
            <Button onClick={onClose} color="inherit">Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
