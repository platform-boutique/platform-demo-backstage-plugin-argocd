# platform-demo-backstage-plugin-argocd

Backstage plugin for the platform-demo portal: a **Deployments** tab on every entity that names an Argo CD Application
(`argocd/app-name`): health, sync, live revision, sync policy, last operation, the objects the Application owns and its history
(with a link to each commit and one to the Application in Argo CD).

**It acts as the signed-in person.** The plugin holds no Argo CD credential. The browser sends the person's Dex ID token, the backend
forwards it to Argo CD's API and Argo CD's RBAC decides what that person sees.

| Package | Path |
|---|---|
| `@platform-boutique/backstage-plugin-deployments` (frontend) | `plugins/deployments` |
| `@platform-boutique/backstage-plugin-deployments-backend` | `plugins/deployments-backend` |

**Read-only on purpose.** Syncing and rolling back are done in Argo CD (the tab links to it) or, because automatic sync is on, by reverting the commit in Git. Documentation: `docs/` (rendered in the portal).
`yarn install && yarn tsc && yarn lint && yarn test` to develop.
