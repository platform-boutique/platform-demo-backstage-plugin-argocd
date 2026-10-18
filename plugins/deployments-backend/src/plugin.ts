import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { ArgoCdService } from './service';

/**
 * Backend of the Deployments view. It has no Argo CD credential: it forwards the signed-in person's Dex ID token, so Argo CD's RBAC
 * decides what that person sees (and, in later stages, may change) and its history names them. Argo CD must list this portal's OIDC
 * client in `oidc.config.allowedAudiences`.
 *
 * @public
 */
export const deploymentsPlugin = createBackendPlugin({
  pluginId: 'deployments',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
      },
      async init({ config, httpAuth, httpRouter }) {
        const baseUrl = config.getOptionalString('deployments.argocdUrl') ?? 'http://argocd-server.argocd.svc.cluster.local';
        httpRouter.use(await createRouter({ httpAuth, service: new ArgoCdService({ baseUrl }) }));
      },
    });
  },
});
