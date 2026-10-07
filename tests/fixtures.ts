import type {
  Check,
  Contribution,
  PullRequest,
  Remote,
  Review,
  Snapshot,
} from '../src/domain/types.ts';

export const NOW = '2026-10-07T01:00:00.000Z';
export const HEAD = 'a'.repeat(40);
export const NEW_HEAD = 'b'.repeat(40);
export const ref = {
  owner: 'axios',
  repo: 'axios',
  number: 11294,
  language: 'JavaScript',
  focus: 'Test contribution',
} as const;
export const rawPull = {
  title: 'Fix a bug',
  html_url: 'https://github.com/axios/axios/pull/11294',
  user: { login: 'kazuki-netizen' },
  state: 'open',
  draft: false,
  merged_at: null,
  head: { sha: HEAD },
  updated_at: NOW,
};
export const pull: PullRequest = {
  title: rawPull.title,
  url: rawPull.html_url,
  author: rawPull.user.login,
  state: { kind: 'open' },
  headSha: HEAD,
  updatedAt: NOW,
};
export function ok<T>(data: T): Remote<T> {
  return { status: 'ok', data, fetchedAt: NOW };
}
export function error<T>(data: T | null = null): Remote<T> {
  return {
    status: 'error',
    data,
    fetchedAt: data === null ? null : NOW,
    message: 'Test failure',
  };
}
export function review(
  decision: Review['decision'],
  overrides: Partial<Review> = {},
): Review {
  return {
    author: 'maintainer',
    isBot: false,
    decision,
    submittedAt: NOW,
    ...overrides,
  };
}
export function check(
  conclusion = 'success',
  overrides: Partial<Check> = {},
): Check {
  return {
    key: 'workflow:1',
    name: 'Tests',
    status: 'completed',
    conclusion,
    url: 'https://github.com/axios/axios/actions/runs/1',
    headSha: HEAD,
    ...overrides,
  };
}
export function contribution(
  overrides: Partial<Contribution> = {},
): Contribution {
  return {
    ref,
    pull: ok(pull),
    reviews: ok([]),
    checks: ok([]),
    statuses: ok([]),
    workflows: ok([]),
    ...overrides,
  };
}
export function snapshot(
  items: readonly Contribution[] = [contribution()],
): Snapshot {
  return {
    version: 1,
    username: 'kazuki-netizen',
    capturedAt: NOW,
    contributions: items,
  };
}
export function rawReview(state: string, author = 'maintainer', time = NOW) {
  return { user: { login: author, type: 'User' }, state, submitted_at: time };
}
export function rawWorkflow(conclusion: string, id = 1) {
  return {
    workflow_id: id,
    name: 'Tests',
    status: 'completed',
    conclusion,
    html_url: 'https://github.com/axios/axios/actions/runs/1',
    head_sha: HEAD,
  };
}
