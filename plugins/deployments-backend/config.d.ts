export interface Config {
  /** Deployments plugin configuration */
  deployments?: {
    /**
     * Where the backend reaches Argo CD's API server.
     * @default http://argocd-server.argocd.svc.cluster.local
     */
    argocdUrl?: string;
  };
}
