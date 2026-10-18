import { ApiBlueprint, createFrontendPlugin, discoveryApiRef, fetchApiRef } from '@backstage/frontend-plugin-api';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { deploymentsApiRef, DeploymentsClient, dexIdTokenApiRef } from './api';

const deploymentsApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: deploymentsApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef, dex: dexIdTokenApiRef },
      factory: deps => new DeploymentsClient(deps),
    }),
});

/** Tab "Deployments" on every entity that names an Argo CD Application (annotation argocd/app-name). */
const entityDeploymentsContent = EntityContentBlueprint.make({
  name: 'deployments',
  params: {
    path: '/deployments',
    title: 'Deployments',
    filter: entity => Boolean(entity.metadata.annotations?.['argocd/app-name']),
    loader: () => import('./components/EntityDeploymentsContent').then(m => <m.EntityDeploymentsContent />),
  },
});

export const deploymentsPlugin = createFrontendPlugin({
  pluginId: 'deployments',
  extensions: [deploymentsApi, entityDeploymentsContent],
});
