import { createApiRef, DiscoveryApi, FetchApi } from '@backstage/frontend-plugin-api';
import { OpenIdConnectApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import { DeploymentApp, Permissions, ResourceNode } from './types';

/**
 * The portal's Dex sign-in. The portal (packages/app/src/modules/auth) registers it under this id; API refs are matched by id, so the
 * plugin asks for the same id instead of importing the portal. Its ID token is what Argo CD accepts as the person's identity.
 */
export const dexIdTokenApiRef = createApiRef<OpenIdConnectApi>({ id: 'internal.auth.dex' });

export interface DeploymentsApi {
  application(name: string): Promise<DeploymentApp>;
  resources(name: string): Promise<ResourceNode[]>;
  permissions(name: string): Promise<Permissions>;
  refresh(name: string, hard: boolean): Promise<DeploymentApp>;
  sync(name: string, o: { prune: boolean; dryRun: boolean }): Promise<DeploymentApp>;
  rollback(name: string, id: number, o: { prune: boolean; dryRun: boolean }): Promise<DeploymentApp>;
}
export const deploymentsApiRef = createApiRef<DeploymentsApi>({ id: 'plugin.deployments.service' });

export class DeploymentsClient implements DeploymentsApi {
  constructor(private readonly deps: { discoveryApi: DiscoveryApi; fetchApi: FetchApi; dex: OpenIdConnectApi }) {}

  private async send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const base = await this.deps.discoveryApi.getBaseUrl('deployments');
    const idToken = await this.deps.dex.getIdToken();
    const res = await this.deps.fetchApi.fetch(`${base}${path}`, {
      method,
      headers: { 'x-dex-id-token': idToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw await ResponseError.fromResponse(res);
    return res.json();
  }

  private app = (name: string) => `/applications/${encodeURIComponent(name)}`;

  application(name: string) {
    return this.send<DeploymentApp>('GET', this.app(name));
  }
  async resources(name: string) {
    return (await this.send<{ resources: ResourceNode[] }>('GET', `${this.app(name)}/resources`)).resources;
  }
  permissions(name: string) {
    return this.send<Permissions>('GET', `${this.app(name)}/permissions`);
  }
  refresh(name: string, hard: boolean) {
    return this.send<DeploymentApp>('POST', `${this.app(name)}/refresh`, { hard });
  }
  sync(name: string, o: { prune: boolean; dryRun: boolean }) {
    return this.send<DeploymentApp>('POST', `${this.app(name)}/sync`, o);
  }
  rollback(name: string, id: number, o: { prune: boolean; dryRun: boolean }) {
    return this.send<DeploymentApp>('POST', `${this.app(name)}/rollback`, { id, ...o });
  }
}
