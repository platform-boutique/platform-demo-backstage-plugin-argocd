export type Health = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown';
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Unknown';

export interface HistoryEntry {
  id: number;
  revision: string;
  deployedAt?: string;
  initiatedBy?: string;
  automated: boolean;
}

export interface OperationSummary {
  phase: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  revision?: string;
  initiatedBy?: string;
  automated: boolean;
}

export interface DeploymentApp {
  name: string;
  project: string;
  destination: { cluster: string; namespace: string };
  health: Health;
  sync: SyncStatus;
  /** Revision that is live (the commit Argo CD last synced). */
  revision?: string;
  /** What the Application follows: a branch, tag or commit. */
  targetRevision?: string;
  repoURL?: string;
  path?: string;
  autoSync: { enabled: boolean; prune: boolean; selfHeal: boolean };
  operation?: OperationSummary;
  history: HistoryEntry[];
  images: string[];
  conditions: { type: string; message: string }[];
  reconciledAt?: string;
}

export interface ResourceNode {
  group: string;
  kind: string;
  namespace?: string;
  name: string;
  health?: Health;
  message?: string;
  /** "Kind/name" of the owner, when the object is owned by another object of the tree. */
  parent?: string;
  images: string[];
}
