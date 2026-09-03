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
import StatusChip from '../shared/StatusChip';
import { commitTimestampFor } from '../../data/runOrdering';
import { configurationDetails } from '../../data/configuration';
import { provenanceDetails } from '../../data/provenance';
import { formatDuration, formatFullDate, shortSha } from '../../utils/formatters';
import { hasDisplayValue } from '../../utils/values';

function DetailGrid({ children }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2.2 }}>
      {children}
    </Box>
  );
}

function SectionHeading({ children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Box aria-hidden sx={{ width: 3, height: 20, flexShrink: 0, borderRadius: 2, bgcolor: 'primary.main' }} />
      <Typography component="h3" sx={{ fontSize: 14, lineHeight: '20px', fontWeight: 800, letterSpacing: '-.01em' }}>
        {children}
      </Typography>
    </Box>
  );
}

export default function BenchmarkResultDialog({ record, repository, onClose }) {
  const run = record?.run;
  const test = record?.test;
  const provenance = run?.provenance ?? {};
  const commitSha = provenance.rocjitsuCommitSha;
  const testConfiguration = configurationDetails(test);
  const environmentDetails = provenanceDetails(provenance);

  return (
    <Dialog open={Boolean(record)} onClose={onClose} fullWidth maxWidth="md">
      {record && (
        <>
          <DialogTitle component="div" sx={{ pr: 7 }}>
            <Typography variant="h2" sx={{ lineHeight: '24px' }}>{test.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, lineHeight: '21px' }}>{test.target} · {test.suite}</Typography>
            <IconButton onClick={onClose} aria-label="Close details" sx={{ position: 'absolute', top: 11, right: 11 }}><CloseRoundedIcon /></IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <SectionHeading>Result</SectionHeading>
            <DetailGrid>
              <DetailItem label="Status"><StatusChip status={test.status} /></DetailItem>
              <DetailItem label="Duration">{formatDuration(test.durationSeconds)}</DetailItem>
              {test.error && <Box sx={{ gridColumn: '1 / -1' }}><DetailItem label="Error">{test.error}</DetailItem></Box>}
            </DetailGrid>

            <Divider sx={{ my: 2.5 }} />
            <SectionHeading>Configuration</SectionHeading>
            {testConfiguration.length > 0 ? (
              <DetailGrid>
                {testConfiguration.map((detail) => (
                  <DetailItem key={detail.key} label={detail.label}>{detail.value}</DetailItem>
                ))}
              </DetailGrid>
            ) : (
              <Typography variant="body2" color="text.secondary">No configuration was provided for this result.</Typography>
            )}

            <Divider sx={{ my: 2.5 }} />
            <SectionHeading>Run provenance</SectionHeading>
            <DetailGrid>
              <DetailItem label="Run time">{formatFullDate(run.timestamp)}</DetailItem>
              <DetailItem label="Run type">{run.trigger === 'manual' ? 'Manual' : 'Auto'}</DetailItem>
              {hasDisplayValue(run.machineId) && <DetailItem label="Machine">{run.machineId}</DetailItem>}
              <Box sx={{ gridColumn: '1 / -1' }}><DetailItem label="RocJitsu commit">{commitSha}</DetailItem></Box>
              <DetailItem label="Commit time">{formatFullDate(commitTimestampFor(run))}</DetailItem>
              {Number.isFinite(run.commitOrder) && <DetailItem label="Commit order">{run.commitOrder}</DetailItem>}
              {hasDisplayValue(provenance.commitMessage) && <Box sx={{ gridColumn: '1 / -1' }}><DetailItem label="Commit message">{provenance.commitMessage}</DetailItem></Box>}
              {environmentDetails.map((detail) => (
                <DetailItem key={detail.key} label={detail.label}>{detail.value}</DetailItem>
              ))}
            </DetailGrid>

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
