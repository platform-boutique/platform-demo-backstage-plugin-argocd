import { useEffect, useState } from 'react';
import { alertApiRef, useApi } from '@backstage/frontend-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Link, MissingAnnotationEmptyState, Progress, ResponseErrorPanel } from '@backstage/core-components';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  makeStyles,
} from '@material-ui/core';
import useAsync from 'react-use/esm/useAsync';
import { deploymentsApiRef } from '../api';
import { DeploymentApp, HistoryEntry, ResourceNode } from '../types';

const APP = 'argocd/app-name';

const useStyles = makeStyles(theme => ({
  stat: { padding: theme.spacing(1.5, 2), border: `1px solid ${theme.palette.divider}`, borderRadius: 12, height: '100%' },
  value: { fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word' },
  label: { fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 },
  sub: { fontSize: '0.8rem', opacity: 0.75, marginTop: 4 },
  chip: { fontWeight: 600, height: 22, color: '#fff' },
  mono: { fontFamily: 'monospace', fontSize: '0.8rem' },
  bar: { display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap', alignItems: 'center' },
  nowrap: { whiteSpace: 'nowrap' },
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
/** A link to the commit when the repository is on GitHub (the only forge here), so a bad revision can be reverted in Git. */
const commitUrl = (app: DeploymentApp, rev: string) => {
  const m = app.repoURL?.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(\.git)?\/?$/);
  return m && rev ? `https://github.com/${m[1]}/commit/${rev}` : undefined;
};

type Pending = { kind: 'sync' } | { kind: 'rollback'; entry: HistoryEntry };

export function EntityDeploymentsContent() {
  const c = useStyles();
  const { entity } = useEntity();
  const api = useApi(deploymentsApiRef);
  const alerts = useApi(alertApiRef);
  const name = entity.metadata.annotations?.[APP];
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState<Pending>();
  const [prune, setPrune] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = useAsync(async () => {
    if (!name) return undefined;
    const [app, resources, permissions] = await Promise.all([api.application(name), api.resources(name), api.permissions(name)]);
    return { app, resources, permissions };
  }, [name, tick]);

  // While Argo CD is working on an operation, look again every few seconds (at most a couple of minutes).
  const running = state.value?.app.operation?.phase === 'Running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => setTick(x => x + 1), 3000);
    return () => clearTimeout(t);
  }, [running, tick]);

  if (!name) return <MissingAnnotationEmptyState annotation={APP} />;
  if (state.loading && !state.value) return <Progress />;
  if (state.error && !state.value) return <ResponseErrorPanel error={state.error} />;
  const { app, resources, permissions } = state.value!;
  const mode = app.autoSync.enabled
    ? `automatic${app.autoSync.prune ? ', prune' : ''}${app.autoSync.selfHeal ? ', self-heal' : ''}`
    : 'manual';
  const rows = [...resources].sort((a, b) => worst(a) - worst(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const noRights = 'Argo CD does not let you change this application (members of platform-boutique:maintainers can).';

  const run = async (what: string, action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      alerts.post({ message: `${what}: Argo CD accepted it.`, severity: 'success', display: 'transient' });
    } catch (e) {
      alerts.post({ message: `${what} failed: ${(e as Error).message}`, severity: 'error', display: 'permanent' });
    } finally {
      setBusy(false);
      setPending(undefined);
      setTick(x => x + 1);
    }
  };

  const confirm = () => {
    if (!pending) return;
    const o = { prune, dryRun };
    if (pending.kind === 'sync') run(dryRun ? 'Dry-run sync' : 'Sync', () => api.sync(name, o));
    else run(`${dryRun ? 'Dry-run rollback' : 'Rollback'} to #${pending.entry.id}`, () => api.rollback(name, pending.entry.id, o));
  };

  const open = (p: Pending) => {
    setPrune(false);
    setDryRun(false);
    setPending(p);
  };

  const rb = pending?.kind === 'rollback' ? pending.entry : undefined;
  const verb = rb ? 'Roll back' : 'Sync';
  const confirmLabel = dryRun ? 'Dry run' : verb;
  const dialogText = rb
    ? `Redeploys revision ${short(rb.revision)} (live now: ${short(app.revision)}). Argo CD records you as the one who did it.`
    : `Applies what ${app.targetRevision ?? 'Git'} declares (${app.path ?? ''}) to ${app.destination.namespace}. Argo CD records you as the one who did it.`;

  const rollbackBlock = (h: HistoryEntry) => {
    if (!permissions.sync) return noRights;
    if (app.autoSync.enabled)
      return 'Automatic sync is on: Argo CD refuses rollbacks and self-heal would put Git back. Revert the commit in Git instead.';
    if (h.revision === app.revision) return 'This is the revision that is live.';
    return undefined;
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <div className={c.bar}>
          <Button variant="outlined" size="small" disabled={busy} onClick={() => run('Refresh', () => api.refresh(name, false))}>
            Refresh
          </Button>
          <Button variant="outlined" size="small" disabled={busy} onClick={() => run('Hard refresh', () => api.refresh(name, true))}>
            Hard refresh
          </Button>
          <Tooltip title={permissions.sync ? '' : noRights}>
            <span>
              <Button variant="contained" color="primary" size="small" disabled={busy || !permissions.sync || running} onClick={() => open({ kind: 'sync' })}>
                Sync
              </Button>
            </span>
          </Tooltip>
          {running && <Typography variant="body2">An operation is running ...</Typography>}
          {state.loading && <Typography variant="body2">updating ...</Typography>}
        </div>
      </Grid>

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

      <Grid item xs={12}>
        <InfoCard title="History" subheader="Deployments, newest first. Rollback redeploys that revision; with automatic sync on, revert the commit in Git." noPadding>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell><TableCell>Revision</TableCell><TableCell>Deployed</TableCell><TableCell>By</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {app.history.map(h => {
                const url = commitUrl(app, h.revision);
                const block = rollbackBlock(h);
                return (
                  <TableRow key={h.id} hover>
                    <TableCell>{h.id}</TableCell>
                    <TableCell className={`${c.mono} ${c.nowrap}`}>
                      {url ? <Link to={url}>{short(h.revision)}</Link> : short(h.revision)}
                      {h.revision === app.revision && ' (live)'}
                    </TableCell>
                    <TableCell className={c.nowrap}>{when(h.deployedAt)}</TableCell>
                    <TableCell>{h.automated ? 'automation' : h.initiatedBy ?? '-'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={block ?? ''}>
                        <span>
                          <Button size="small" variant="outlined" disabled={busy || Boolean(block)} onClick={() => open({ kind: 'rollback', entry: h })}>
                            Rollback
                          </Button>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
              {app.history.length === 0 && <TableRow><TableCell colSpan={5}>No deployments recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </InfoCard>
      </Grid>

      <Grid item xs={12}>
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

      {app.images.length > 0 && (
        <Grid item xs={12}>
          <InfoCard title="Images">
            {app.images.map(i => <Typography key={i} className={c.mono}>{i}</Typography>)}
          </InfoCard>
        </Grid>
      )}

      <Dialog open={Boolean(pending)} onClose={() => !busy && setPending(undefined)}>
        <DialogTitle>{rb ? `Roll back ${app.name} to #${rb.id}?` : `Sync ${app.name}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>{dialogText}</DialogContentText>
          <FormControlLabel control={<Checkbox checked={prune} onChange={e => setPrune(e.target.checked)} />} label="Prune: delete objects that are no longer in Git" />
          <br />
          <FormControlLabel control={<Checkbox checked={dryRun} onChange={e => setDryRun(e.target.checked)} />} label="Dry run: check only, change nothing" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(undefined)} disabled={busy}>Cancel</Button>
          <Button color="primary" variant="contained" onClick={confirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
