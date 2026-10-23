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

describe('read-only', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());

  it('has no route that changes anything in Argo CD', async () => {
    const { server } = await startTestBackend({
      features: [deploymentsPlugin, mockServices.rootConfig.factory({ data: { deployments: { argocdUrl: 'http://argo.test' } } })],
    });
    for (const path of ['sync', 'refresh', 'rollback', 'permissions']) {
      const res = await request(server).post(`/api/deployments/applications/dev-dex/${path}`).set('x-dex-id-token', 'P').send({ id: 1 });
      expect(res.status).toBe(404);
    }
    expect((await request(server).delete('/api/deployments/applications/dev-dex').set('x-dex-id-token', 'P')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
