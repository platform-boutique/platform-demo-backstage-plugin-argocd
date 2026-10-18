# platform-demo-backstage-plugin-argocd

Backstage plugin for the platform-demo portal: a **Deployments** tab on every entity that names an Argo CD Application
(`argocd/app-name`): health, sync, live revision, sync policy, last operation, the objects the Application owns and its history.
The portal needs no Argo CD web UI for this.

**It acts as the signed-in person.** The plugin holds no Argo CD credential. The browser sends the person's Dex ID token, the backend
forwards it to Argo CD's API and Argo CD's RBAC decides (and, in later stages, records who synced or rolled back).

| Package | Path |
|---|---|
| `@platform-boutique/backstage-plugin-deployments` (frontend) | `plugins/deployments` |
| `@platform-boutique/backstage-plugin-deployments-backend` | `plugins/deployments-backend` |

Stages: (1) read-only tab (this), (2) refresh and sync, (3) rollback. Documentation: `docs/` (rendered in the portal).
`yarn install && yarn tsc && yarn lint && yarn test` to develop.
