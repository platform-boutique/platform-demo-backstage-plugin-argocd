# Install and configure

| Package | Role |
|---|---|
| `@platform-boutique/backstage-plugin-deployments` | Frontend plugin (new frontend system) |
| `@platform-boutique/backstage-plugin-deployments-backend` | Backend plugin |

```ts title="packages/backend/src/index.ts"
backend.add(import('@platform-boutique/backstage-plugin-deployments-backend'));
```

The frontend has a default export, so `app.packages: all` picks it up. The portal's Dex sign-in must be registered as the API
`internal.auth.dex` (OAuth2 with an ID token), as `packages/app/src/modules/auth` does.

```yaml title="app-config.yaml (optional)"
deployments:
  argocdUrl: http://argocd-server.argocd.svc.cluster.local   # default
```

## What Argo CD must allow

```yaml title="gitops/argocd/values.yaml"
configs:
  cm:
    oidc.config: |
      ...
      allowedAudiences: [argocd, backstage]
```

## Develop

```bash
yarn install && yarn tsc && yarn lint && yarn test && yarn build
for p in deployments deployments-backend; do (cd plugins/$p && yarn pack --out ../../dist-pack/$p.tgz); done
```

Copy the tarballs into the portal's `vendor/` folder and rebuild its image.
