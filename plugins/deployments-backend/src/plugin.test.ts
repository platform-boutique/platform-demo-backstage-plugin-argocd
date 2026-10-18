import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import request from 'supertest';
import { deploymentsPlugin } from './plugin';
import { normalizeApplication, normalizeTree } from './service';

const APP = {
  metadata: { name: 'dev-dex' },
  spec: {
    project: 'platform',
    destination: { name: 'in-cluster', namespace: 'sso' },
    source: { repoURL: 'https://github.com/platform-boutique/platform-demo-helm', path: 'dex', targetRevision: 'main' },
    syncPolicy: { automated: { prune: true, selfHeal: true } },
  },
  status: {
    health: { status: 'Healthy' },
    sync: { status: 'Synced', revision: 'abcdef1234567890' },
    history: [
      { id: 1, revision: 'aaaa', deployedAt: '2026-10-17T10:00:00Z', initiatedBy: { automated: true } },
      { id: 2, revision: 'bbbb', deployedAt: '2026-10-18T10:00:00Z', initiatedBy: { username: 'someone' } },
    ],
    operationState: { phase: 'Succeeded', syncResult: { revision: 'bbbb' }, operation: { initiatedBy: { username: 'someone' } } },
    summary: { images: ['dex:v2'] },
  },
};
const TREE = {
  nodes: [
    { kind: 'Deployment', name: 'dex', namespace: 'sso', group: 'apps', health: { status: 'Healthy' } },
    { kind: 'Pod', name: 'dex-1', namespace: 'sso', health: { status: 'Degraded', message: 'crash' }, parentRefs: [{ kind: 'ReplicaSet', name: 'dex-abc' }] },
  ],
};

describe('normalize', () => {
  it('keeps what the tab shows and sorts the history newest first', () => {
    const a = normalizeApplication(APP);
    expect(a).toMatchObject({
      name: 'dev-dex',
      health: 'Healthy',
      sync: 'Synced',
      revision: 'abcdef1234567890',
      targetRevision: 'main',
      autoSync: { enabled: true, prune: true, selfHeal: true },
      images: ['dex:v2'],
    });
    expect(a.history.map(h => h.id)).toEqual([2, 1]);
    expect(a.history[1].automated).toBe(true);
    expect(a.operation).toMatchObject({ phase: 'Succeeded', revision: 'bbbb', initiatedBy: 'someone' });
  });
  it('reads a tree', () => {
    const [d, p] = normalizeTree(TREE);
    expect(d.parent).toBeUndefined();
    expect(p).toMatchObject({ health: 'Degraded', message: 'crash', parent: 'ReplicaSet/dex-abc' });
  });
});

describe('deployments backend', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());

  async function app() {
    const { server: s } = await startTestBackend({
      features: [deploymentsPlugin, mockServices.rootConfig.factory({ data: { deployments: { argocdUrl: 'http://argo.test' } } })],
    });
    return s;
  }

  it('forwards the person\'s Dex token to Argo CD, not a credential of its own', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(APP), { status: 200 }));
    const res = await request(await app()).get('/api/deployments/applications/dev-dex').set('x-dex-id-token', 'PERSON-TOKEN');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('dev-dex');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://argo.test/api/v1/applications/dev-dex');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer PERSON-TOKEN');
  });

  it('refuses a request without the Dex token', async () => {
    const res = await request(await app()).get('/api/deployments/applications/dev-dex');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses names that are not Kubernetes names (no path tricks towards Argo CD)', async () => {
    const res = await request(await app()).get('/api/deployments/applications/..%2Fsettings').set('x-dex-id-token', 't');
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows Argo CD\'s "no" as 403 and a lost token as 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    expect((await request(await app()).get('/api/deployments/applications/dev-dex').set('x-dex-id-token', 't')).status).toBe(403);
    fetchMock.mockResolvedValueOnce(new Response('expired', { status: 401 }));
    expect((await request(await app()).get('/api/deployments/applications/dev-dex/resources').set('x-dex-id-token', 't')).status).toBe(401);
  });
});

describe('actions', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());
  async function app() {
    const { server } = await startTestBackend({
      features: [deploymentsPlugin, mockServices.rootConfig.factory({ data: { deployments: { argocdUrl: 'http://argo.test' } } })],
    });
    return server;
  }
  const ok = () => new Response(JSON.stringify(APP), { status: 200 });

  it('syncs with the person\'s token and only the allowed options', async () => {
    fetchMock.mockResolvedValue(ok());
    const res = await request(await app()).post('/api/deployments/applications/dev-dex/sync').set('x-dex-id-token', 'P').send({ prune: true, dryRun: false, revision: 'evil' });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://argo.test/api/v1/applications/dev-dex/sync');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer P');
    expect(JSON.parse(init.body as string)).toEqual({ prune: true, dryRun: false });
  });

  it('refreshes softly or hard', async () => {
    fetchMock.mockResolvedValue(ok());
    await request(await app()).post('/api/deployments/applications/dev-dex/refresh').set('x-dex-id-token', 'P').send({ hard: true });
    expect(fetchMock.mock.calls[0][0]).toBe('http://argo.test/api/v1/applications/dev-dex?refresh=hard');
  });

  it('rolls back to a history id and rejects anything else', async () => {
    fetchMock.mockResolvedValue(ok());
    const s = await app();
    const good = await request(s).post('/api/deployments/applications/dev-dex/rollback').set('x-dex-id-token', 'P').send({ id: 3 });
    expect(good.status).toBe(200);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ name: 'dev-dex', id: 3, prune: false, dryRun: false });
    fetchMock.mockClear();
    for (const body of [{}, { id: '3' }, { id: -1 }, { id: 1.5 }]) {
      expect((await request(s).post('/api/deployments/applications/dev-dex/rollback').set('x-dex-id-token', 'P').send(body)).status).toBe(400);
    }
    expect((await request(s).post('/api/deployments/applications/dev-dex/sync').set('x-dex-id-token', 'P').send({ prune: 'yes' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes on Argo CD\'s own explanation when it refuses (rollback with auto-sync)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'rollback cannot be initiated when auto-sync is enabled' }), { status: 400 }));
    const res = await request(await app()).post('/api/deployments/applications/dev-dex/rollback').set('x-dex-id-token', 'P').send({ id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('auto-sync is enabled');
  });

  it('asks Argo CD what the person may do', async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response(JSON.stringify({ value: 'no' }), { status: 200 }));
    const res = await request(await app()).get('/api/deployments/applications/dev-dex/permissions').set('x-dex-id-token', 'P');
    expect(res.body).toEqual({ sync: false });
    expect(fetchMock.mock.calls[1][0]).toBe('http://argo.test/api/v1/account/can-i/sync/applications/platform/dev-dex');
  });
});
