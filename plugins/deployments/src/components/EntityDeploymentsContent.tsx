import { useApi } from '@backstage/frontend-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, MissingAnnotationEmptyState, Progress, ResponseErrorPanel } from '@backstage/core-components';
import { Chip, Grid, Table, TableBody, TableCell, TableHead, TableRow, Typography, makeStyles } from '@material-ui/core';
import useAsync from 'react-use/esm/useAsync';
import { deploymentsApiRef } from '../api';
import { ResourceNode } from '../types';

const APP = 'argocd/app-name';

const useStyles = makeStyles(theme => ({
  stat: { padding: theme.spacing(1.5, 2), border: `1px solid ${theme.palette.divider}`, borderRadius: 12, height: '100%' },
  value: { fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word' },
  label: { fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 },
  sub: { fontSize: '0.8rem', opacity: 0.75, marginTop: 4 },
  chip: { fontWeight: 600, height: 22, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: '0.8rem' },
}));

const COLORS: Record<string, string> = {
  Healthy: '#2e7d32',
  Synced: '#2e7d32',
  Succeeded: '#2e7d32',
  Progressing: '#0277bd',
  Running: '#0277bd',
  Suspended: '#6d4c41',
  OutOfSync: '#ed6c02',
  Degraded: '#c62828',
  Failed: '#c62828',
  Error: '#c62828',
  Missing: '#c62828',
  Unknown: '#757575',
};

function Status({ value }: { value?: string }) {
  const c = useStyles();
  if (!value) return null;
  return <Chip size="small" className={c.chip} style={{ background: COLORS[value] ?? COLORS.Unknown }} label={value} />;
}

const short = (rev?: string) => (rev ? rev.slice(0, 8) : '-');
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '-');
const ORDER: Record<string, number> = { Degraded: 0, Missing: 0, Progressing: 1 };
const worst = (n: ResourceNode) => ORDER[n.health ?? ''] ?? 2;

export function EntityDeploymentsContent() {
  const c = useStyles();
  const { entity } = useEntity();
  const api = useApi(deploymentsApiRef);
  const name = entity.metadata.annotations?.[APP];
  const state = useAsync(async () => {
    if (!name) return undefined;
    const [app, resources] = await Promise.all([api.application(name), api.resources(name)]);
    return { app, resources };
  }, [name]);

  if (!name) return <MissingAnnotationEmptyState annotation={APP} />;
  if (state.loading) return <Progress />;
  if (state.error) return <ResponseErrorPanel error={state.error} />;
  const { app, resources } = state.value!;
  const mode = app.autoSync.enabled
    ? `automatic${app.autoSync.prune ? ', prune' : ''}${app.autoSync.selfHeal ? ', self-heal' : ''}`
    : 'manual';
  const rows = [...resources].sort((a, b) => worst(a) - worst(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return (
    <Grid container spacing={3}>
      <Grid item xs={6} md={3}>
        <div className={c.stat}>
          <div className={c.label}>Health</div>
          <div className={c.value}><Status value={app.health} /></div>
          <div className={c.sub}>{app.name} in {app.destination.namespace}</div>
        </div>
      </Grid>
      <Grid item xs={6} md={3}>
        <div className={c.stat}>
          <div className={c.label}>Sync</div>
          <div className={c.value}><Status value={app.sync} /></div>
          <div className={c.sub}>Git {app.targetRevision ?? '-'} {app.path ? `/ ${app.path}` : ''}</div>
        </div>
      </Grid>
      <Grid item xs={6} md={3}>
        <div className={c.stat}>
          <div className={c.label}>Live revision</div>
          <div className={`${c.value} ${c.mono}`}>{short(app.revision)}</div>
          <div className={c.sub}>reconciled {when(app.reconciledAt)}</div>
        </div>
      </Grid>
      <Grid item xs={6} md={3}>
        <div className={c.stat}>
          <div className={c.label}>Sync policy</div>
          <div className={c.value}>{mode}</div>
          <div className={c.sub}>project {app.project}</div>
        </div>
      </Grid>

      {app.conditions.length > 0 && (
        <Grid item xs={12}>
          <InfoCard title="Conditions">
            {app.conditions.map(x => (
              <Typography key={`${x.type}-${x.message}`}><b>{x.type}</b>: {x.message}</Typography>
            ))}
          </InfoCard>
        </Grid>
      )}

      {app.operation && (
        <Grid item xs={12}>
          <InfoCard title="Last operation">
            <Typography>
              <Status value={app.operation.phase} /> started {when(app.operation.startedAt)}, finished {when(app.operation.finishedAt)}
              {app.operation.initiatedBy ? ` by ${app.operation.automated ? 'automation' : app.operation.initiatedBy}` : ''}, revision{' '}
              <span className={c.mono}>{short(app.operation.revision)}</span>
            </Typography>
            {app.operation.message && <Typography variant="body2">{app.operation.message}</Typography>}
          </InfoCard>
        </Grid>
      )}

      <Grid item xs={12} md={7}>
        <InfoCard title="Resources" subheader={`${resources.length} objects owned by ${app.name}; unhealthy first`} noPadding>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Health</TableCell><TableCell>Object</TableCell><TableCell>Owner</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {rows.map(n => (
                <TableRow key={`${n.group}/${n.kind}/${n.namespace}/${n.name}`} hover>
                  <TableCell><Status value={n.health} /></TableCell>
                  <TableCell className={c.mono}>{n.kind}/{n.name}{n.message ? ` - ${n.message}` : ''}</TableCell>
                  <TableCell className={c.mono}>{n.parent ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      </Grid>

      <Grid item xs={12} md={5}>
        <InfoCard title="History" subheader="Deployments, newest first" noPadding>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>#</TableCell><TableCell>Revision</TableCell><TableCell>Deployed</TableCell><TableCell>By</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {app.history.map(h => (
                <TableRow key={h.id} hover>
                  <TableCell>{h.id}</TableCell>
                  <TableCell className={c.mono}>{short(h.revision)}</TableCell>
                  <TableCell>{when(h.deployedAt)}</TableCell>
                  <TableCell>{h.automated ? 'automation' : h.initiatedBy ?? '-'}</TableCell>
                </TableRow>
              ))}
              {app.history.length === 0 && <TableRow><TableCell colSpan={4}>No deployments recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </InfoCard>
      </Grid>

      {app.images.length > 0 && (
        <Grid item xs={12}>
          <InfoCard title="Images">
            {app.images.map(i => <Typography key={i} className={c.mono}>{i}</Typography>)}
          </InfoCard>
        </Grid>
      )}
    </Grid>
  );
}

