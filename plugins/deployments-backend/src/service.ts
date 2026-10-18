import { AuthenticationError, NotAllowedError, NotFoundError, ServiceUnavailableError } from '@backstage/errors';
import { DeploymentApp, HistoryEntry, OperationSummary, ResourceNode } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Thin client of Argo CD's REST API. It never holds a credential of its own: every call carries the Dex ID token of the person who
 * asked, so Argo CD's RBAC decides what they may see. Read-only on purpose: syncing and rolling back are done in Argo CD or by a revert in Git.
 */
export class ArgoCdService {
  constructor(private readonly o: { baseUrl: string; fetch?: typeof fetch }) {}

  private async call(path: string, idToken: string): Promise<any> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.o.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
        headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' },
      });
    } catch (e) {
      throw new ServiceUnavailableError(`Argo CD is not reachable: ${(e as Error).message}`);
    }
    if (res.ok) return res.json();
    const detail = await res.text().catch(() => '');
    // Argo CD answers 403 (not 404) for an Application the person may not see, so the two cannot be told apart.
    if (res.status === 401) throw new AuthenticationError('Argo CD did not accept your sign-in token. Sign out and in again.');
    if (res.status === 403) throw new NotAllowedError('Argo CD does not know this application, or you may not see it.');
    if (res.status === 404) throw new NotFoundError('Argo CD does not know this application.');
    throw new ServiceUnavailableError(`Argo CD answered ${res.status}: ${detail.slice(0, 200)}`);
  }

  async application(name: string, idToken: string): Promise<DeploymentApp> {
    return normalizeApplication(await this.call(`/applications/${encodeURIComponent(name)}`, idToken));
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
