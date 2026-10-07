export type Language = 'TypeScript' | 'JavaScript' | 'Python';

export interface ContributionRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly language: Language;
  readonly focus: string;
}

export type PullState =
  | { readonly kind: 'open' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'merged'; readonly mergedAt: string };

export interface PullRequest {
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly state: PullState;
  readonly headSha: string;
  readonly updatedAt: string;
}

export type ReviewDecision =
  'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

export interface Review {
  readonly author: string;
  readonly isBot: boolean;
  readonly decision: ReviewDecision;
  readonly submittedAt: string;
}

export interface Check {
  readonly key: string;
  readonly name: string;
  readonly status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'waiting'
    | 'pending'
    | 'requested';
  readonly conclusion: string | null;
  readonly url: string | null;
  readonly headSha: string;
}

export interface CommitStatus {
  readonly name: string;
  readonly state: 'error' | 'failure' | 'pending' | 'success';
  readonly url: string | null;
}

export type Remote<T> =
  | { readonly status: 'ok'; readonly data: T; readonly fetchedAt: string }
  | {
      readonly status: 'error';
      readonly data: T | null;
      readonly fetchedAt: string | null;
      readonly message: string;
    };

export interface Contribution {
  readonly ref: ContributionRef;
  readonly pull: Remote<PullRequest>;
  readonly reviews: Remote<readonly Review[]>;
  readonly checks: Remote<readonly Check[]>;
  readonly statuses: Remote<readonly CommitStatus[]>;
  readonly workflows: Remote<readonly Check[]>;
}

export interface Snapshot {
  readonly version: 1;
  readonly username: string;
  readonly capturedAt: string;
  readonly contributions: readonly Contribution[];
}

export type CiState =
  | 'passed'
  | 'failed'
  | 'action-required'
  | 'running'
  | 'not-run'
  | 'unavailable';
export type HumanReviewState =
  'approved' | 'changes-requested' | 'commented' | 'waiting' | 'unavailable';

export function assertNever(value: never): never {
  throw new Error(`Unhandled domain state: ${String(value)}`);
}
