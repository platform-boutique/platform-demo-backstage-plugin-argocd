# How it works

```text
browser --(Backstage token, x-dex-id-token)--> portal backend /api/deployments --(Bearer <Dex ID token>)--> Argo CD /api/v1
```

| Route | Argo CD call | Result |
|---|---|---|
| `GET /applications/:name` | `GET /applications/{name}` | health, sync, revision, policy, last operation, history, images, conditions |
| `GET /applications/:name/resources` | `GET /applications/{name}/resource-tree` | owned objects with health and owner |

- Only these two reads exist; there is no route that changes anything (a test asserts that). There is no generic proxy: the application name must be a Kubernetes name, so a request cannot be steered
  to other Argo CD endpoints.
- The backend authenticates the Backstage user first (`httpAuth`, user credentials only) and refuses a request without the Dex token.
- Argo CD verifies the Dex token itself. Its `oidc.config` must list the portal's OIDC client in `allowedAudiences`
  (`[argocd, backstage]` in `gitops/argocd/values.yaml` of the Helm repository), because the token was issued to the portal.
