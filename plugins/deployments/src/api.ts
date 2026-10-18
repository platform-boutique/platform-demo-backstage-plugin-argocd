import { createApiRef, DiscoveryApi, FetchApi } from '@backstage/frontend-plugin-api';
import { OpenIdConnectApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import { DeploymentApp, ResourceNode } from './types';

/**
 * The portal's Dex sign-in. The portal (packages/app/src/modules/auth) registers it under this id; API refs are matched by id, so the
 * plugin asks for the same id instead of importing the portal. Its ID token is what Argo CD accepts as the person's identity.
 */
export const dexIdTokenApiRef = createApiRef<OpenIdConnectApi>({ id: 'internal.auth.dex' });

export interface DeploymentsApi {
  application(name: string): Promise<DeploymentApp>;
  resources(name: string): Promise<ResourceNode[]>;
}
export const deploymentsApiRef = createApiRef<DeploymentsApi>({ id: 'plugin.deployments.service' });

export class DeploymentsClient implements DeploymentsApi {
  constructor(private readonly deps: { discoveryApi: DiscoveryApi; fetchApi: FetchApi; dex: OpenIdConnectApi }) {}

  private async get<T>(path: string): Promise<T> {
    const base = await this.deps.discoveryApi.getBaseUrl('deployments');
    const idToken = await this.deps.dex.getIdToken();
    const res = await this.deps.fetchApi.fetch(`${base}${path}`, { headers: { 'x-dex-id-token': idToken } });
    if (!res.ok) throw await ResponseError.fromResponse(res);
    return res.json();
  }

  application(name: string) {
    return this.get<DeploymentApp>(`/applications/${encodeURIComponent(name)}`);
  }
  async resources(name: string) {
    return (await this.get<{ resources: ResourceNode[] }>(`/applications/${encodeURIComponent(name)}/resources`)).resources;
  }
}
