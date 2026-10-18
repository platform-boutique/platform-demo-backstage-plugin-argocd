import { AuthenticationError, InputError, NotAllowedError, NotFoundError, ServiceUnavailableError } from '@backstage/errors';
import { DeploymentApp, HistoryEntry, OperationSummary, Permissions, ResourceNode } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Thin client of Argo CD's REST API. It never holds a credential of its own: every call carries the Dex ID token of the person who
 * asked, so Argo CD's RBAC decides what they may see or do and its history records who did it.
 */
export class ArgoCdService {
  constructor(private readonly o: { baseUrl: string; fetch?: typeof fetch }) {}

  private async call(path: string, idToken: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<any> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.o.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          Accept: 'application/json',
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (e) {
      throw new ServiceUnavailableError(`Argo CD is not reachable: ${(e as Error).message}`);
    }
    if (res.ok) return res.json();
    const detail = await res.text().catch(() => '');
    // Argo CD answers 403 (not 404) for an Application the person may not see, so the two cannot be told apart.
    if (res.status === 401) throw new AuthenticationError('Argo CD did not accept your sign-in token. Sign out and in again.');
    if (res.status === 403) throw new NotAllowedError('Argo CD does not know this application, or you may not do this to it.');
    if (res.status === 404) throw new NotFoundError('Argo CD does not know this application.');
    // 400/409/412...: Argo CD explains itself (for example "rollback cannot be initiated when auto-sync is enabled")
    throw new InputError(`Argo CD refused: ${argoMessage(detail)}`);
  }

  async application(name: string, idToken: string): Promise<DeploymentApp> {
    return normalizeApplication(await this.call(`/applications/${encodeURIComponent(name)}`, idToken));
  }

  /** What this person may do to the Application, asked of Argo CD itself (its RBAC is the only authority). */
  async permissions(name: string, idToken: string): Promise<Permissions> {
    const app = await this.application(name, idToken);
    const can = async (action: string) =>
      (await this.call(`/account/can-i/${action}/applications/${encodeURIComponent(app.project)}/${encodeURIComponent(name)}`, idToken)).value === 'yes';
    return { sync: await can('sync') };
  }

  /** Ask Argo CD to compare Git with the cluster now ("hard" also drops its manifest cache). */
  async refresh(name: string, idToken: string, hard: boolean): Promise<DeploymentApp> {
    return normalizeApplication(await this.call(`/applications/${encodeURIComponent(name)}?refresh=${hard ? 'hard' : 'normal'}`, idToken));
  }

  /** Sync to the revision the Application follows. Argo CD records the person as the initiator. */
  async sync(name: string, idToken: string, o: { prune: boolean; dryRun: boolean }): Promise<DeploymentApp> {
    return normalizeApplication(
      await this.call(`/applications/${encodeURIComponent(name)}/sync`, idToken, { method: 'POST', body: { prune: o.prune, dryRun: o.dryRun } }),
    );
  }

  /** Redeploy a revision from the history. Argo CD refuses this while automatic sync is on (the next sync would undo it). */
  async rollback(name: string, idToken: string, o: { id: number; prune: boolean; dryRun: boolean }): Promise<DeploymentApp> {
    return normalizeApplication(
      await this.call(`/applications/${encodeURIComponent(name)}/rollback`, idToken, {
        method: 'POST',
        body: { name, id: o.id, prune: o.prune, dryRun: o.dryRun },
      }),
    );
  }

  async resources(name: string, idToken: string): Promise<ResourceNode[]> {
    return normalizeTree(await this.call(`/applications/${encodeURIComponent(name)}/resource-tree`, idToken));
  }
}

const statusOf = (h: any) => (h?.status as DeploymentApp['health']) ?? 'Unknown';

export function normalizeApplication(a: any): DeploymentApp {
  const spec = a.spec ?? {};
  const status = a.status ?? {};
  const source = spec.source ?? spec.sources?.[0] ?? {};
  const auto = spec.syncPolicy?.automated;
  const op = status.operationState;
  const history: HistoryEntry[] = (status.history ?? [])
    .map((h: any) => ({
      id: h.id,
      revision: h.revision ?? h.revisions?.[0] ?? '',
      deployedAt: h.deployedAt,
      initiatedBy: h.initiatedBy?.username,
      automated: Boolean(h.initiatedBy?.automated),
    }))
    .sort((x: HistoryEntry, y: HistoryEntry) => y.id - x.id);
  const operation: OperationSummary | undefined = op && {
    phase: op.phase,
    message: op.message,
    startedAt: op.startedAt,
    finishedAt: op.finishedAt,
    revision: op.syncResult?.revision ?? op.syncResult?.revisions?.[0],
    initiatedBy: op.operation?.initiatedBy?.username,
    automated: Boolean(op.operation?.initiatedBy?.automated),
  };
  return {
    name: a.metadata?.name,
    project: spec.project ?? 'default',
    destination: { cluster: spec.destination?.name ?? spec.destination?.server ?? '', namespace: spec.destination?.namespace ?? '' },
    health: statusOf(status.health),
    sync: (status.sync?.status as DeploymentApp['sync']) ?? 'Unknown',
    revision: status.sync?.revision ?? status.sync?.revisions?.[0],
    targetRevision: source.targetRevision,
    repoURL: source.repoURL,
    path: source.path,
    autoSync: { enabled: Boolean(auto), prune: Boolean(auto?.prune), selfHeal: Boolean(auto?.selfHeal) },
    operation,
    history,
    images: status.summary?.images ?? [],
    conditions: (status.conditions ?? []).map((c: any) => ({ type: c.type, message: c.message })),
    reconciledAt: status.reconciledAt,
  };
}

export function normalizeTree(t: any): ResourceNode[] {
  return (t.nodes ?? []).map((n: any) => {
    const owner = n.parentRefs?.[0];
    return {
      group: n.group ?? '',
      kind: n.kind,
      namespace: n.namespace,
      name: n.name,
      health: n.health ? statusOf(n.health) : undefined,
      message: n.health?.message,
      parent: owner ? `${owner.kind}/${owner.name}` : undefined,
      images: n.images ?? [],
    };
  });
}

function argoMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return String(j.message ?? j.error ?? body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}
