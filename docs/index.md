# Deployments (Argo CD)

A **Deployments** tab on every entity with the annotation `argocd/app-name: <Application>`. It shows:

- **Health** and **sync** of the Application, the live revision and what Git it follows, the sync policy (automatic, prune, self-heal)
- the **last operation** (phase, who, which revision)
- the **resources** the Application owns with their health, unhealthy first
- the **history**: every deployment, newest first, and who triggered it (a person, or automation)

The goal is that the Argo CD web UI is not needed. Controls come in stages: read-only (this), then refresh and sync, then rollback.

## Whose identity is used

The plugin has **no Argo CD token**. Its frontend asks the portal's Dex sign-in for the person's ID token and sends it in the header
`x-dex-id-token`; the backend forwards it to Argo CD as `Authorization: Bearer`. Argo CD then applies its own RBAC to that person
(`platform-boutique:maintainers` administer, everyone else reads) and its history names them. Backstage's permission framework is not
involved, so there is one place that decides what a person may do.

If Argo CD answers *403*, the person may not see the Application, or it does not exist (Argo CD does not tell them apart).
If it answers *401*, the token is expired: sign out and in again.
