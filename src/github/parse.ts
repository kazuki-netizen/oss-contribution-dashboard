import type {
  Check,
  CommitStatus,
  Contribution,
  ContributionRef,
  PullRequest,
  PullState,
  Remote,
  Review,
  Snapshot,
} from '../domain/types.ts';

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

function invalid(path: string): never {
  throw new ValidationError(`Invalid GitHub data: ${path}`);
}
export function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid(path);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(path);
  return value;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    invalid(path);
  return value;
}
function choice<const T extends readonly string[]>(
  value: unknown,
  options: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) invalid(path);
  return value;
}
export function timestamp(value: unknown, path: string): string {
  const result = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid(path);
  const canonical = new Date(result).toISOString();
  if (canonical.slice(0, 19) !== result.slice(0, 19)) invalid(path);
  return canonical;
}
function sha(value: unknown): string {
  const result = text(value, 'head sha');
  if (!/^[a-f0-9]{40}$/i.test(result)) invalid('head sha');
  return result;
}
export function safeUrl(value: unknown, path: string): string {
  const result = text(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    return invalid(path);
  }
  if (url.protocol !== 'https:' || url.username || url.password) invalid(path);
  return url.href;
}
function nullableUrl(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : safeUrl(value, path);
}
export function list<T>(
  value: unknown,
  parser: (entry: unknown) => T,
  path: string,
): T[] {
  if (!Array.isArray(value)) invalid(path);
  return value.map(parser);
}

export function parsePull(value: unknown): PullRequest {
  const item = object(value, 'pull request');
  const state = choice(item['state'], ['open', 'closed'], 'pull.state');
  const draft = bool(item['draft'], 'pull.draft');
  const mergedAt =
    item['merged_at'] === null
      ? null
      : timestamp(item['merged_at'], 'pull.merged_at');
  const kind: PullState =
    mergedAt !== null
      ? { kind: 'merged', mergedAt }
      : state === 'closed'
        ? { kind: 'closed' }
        : draft
          ? { kind: 'draft' }
          : { kind: 'open' };
  const url = safeUrl(item['html_url'], 'pull.url');
  if (new URL(url).hostname !== 'github.com') invalid('pull.url host');
  return {
    title: text(item['title'], 'pull.title'),
    url,
    author: text(object(item['user'], 'pull.user')['login'], 'pull.user.login'),
    state: kind,
    headSha: sha(object(item['head'], 'pull.head')['sha']),
    updatedAt: timestamp(item['updated_at'], 'pull.updated_at'),
  };
}

// Several review services use User accounts, so GitHub's Bot type alone is insufficient.
const KNOWN_REVIEW_BOTS = new Set([
  'coderabbitai',
  'cubic-dev-ai',
  'greptile-apps',
  'codspeed',
  'github-actions',
]);
export function parseReview(value: unknown): Review | null {
  const item = object(value, 'review');
  const decision = choice(
    item['state'],
    ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'],
    'review.state',
  );
  if (decision === 'PENDING') return null;
  // A deleted reviewer's identity is unknown; it must not become human approval evidence.
  if (item['user'] === null) return null;
  const user = object(item['user'], 'review.user');
  const userType = choice(user['type'], ['User', 'Bot'], 'review.user.type');
  const author = text(user['login'], 'review.user.login');
  return {
    author,
    decision,
    isBot:
      userType === 'Bot' ||
      author.toLowerCase().endsWith('[bot]') ||
      KNOWN_REVIEW_BOTS.has(author.toLowerCase()),
    submittedAt: timestamp(item['submitted_at'], 'review.submitted_at'),
  };
}
export function parseReviews(value: unknown): Review[] {
  return list(value, parseReview, 'reviews').filter(
    (review): review is Review => review !== null,
  );
}

const CHECK_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'pending',
  'requested',
] as const;
function conclusion(value: unknown): string | null {
  return value === null ? null : text(value, 'check.conclusion');
}
export function parseCheck(value: unknown): Check {
  const item = object(value, 'check');
  return {
    key: `check:${text(item['name'], 'check.name')}`,
    name: text(item['name'], 'check.name'),
    status: choice(item['status'], CHECK_STATUSES, 'check.status'),
    conclusion: conclusion(item['conclusion']),
    url: nullableUrl(item['details_url'] ?? item['html_url'], 'check.url'),
    headSha: sha(item['head_sha']),
  };
}
export function parseChecks(value: unknown): Check[] {
  return list(
    object(value, 'check runs')['check_runs'],
    parseCheck,
    'check_runs',
  );
}
export function parseWorkflows(value: unknown): Check[] {
  return list(
    object(value, 'workflow runs')['workflow_runs'],
    (entry) => {
      const item = object(entry, 'workflow run');
      return {
        ...parseCheck(item),
        key: `workflow:${integer(item['workflow_id'], 'workflow_id')}`,
      };
    },
    'workflow_runs',
  );
}
export function parseStatus(value: unknown): CommitStatus {
  const item = object(value, 'status');
  return {
    name: text(item['context'], 'status.context'),
    state: choice(
      item['state'],
      ['error', 'failure', 'pending', 'success'],
      'status.state',
    ),
    url: nullableUrl(item['target_url'], 'status.url'),
  };
}
export function parseStatuses(value: unknown): CommitStatus[] {
  return list(
    object(value, 'combined status')['statuses'],
    parseStatus,
    'statuses',
  );
}

function parseRef(value: unknown): ContributionRef {
  const item = object(value, 'reference');
  const owner = text(item['owner'], 'reference.owner');
  const repo = text(item['repo'], 'reference.repo');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo))
    invalid('reference repository');
  return {
    owner,
    repo,
    number: integer(item['number'], 'reference.number'),
    language: choice(
      item['language'],
      ['TypeScript', 'JavaScript', 'Python'],
      'reference.language',
    ),
    focus: text(item['focus'], 'reference.focus'),
  };
}
function parseStoredPull(value: unknown): PullRequest {
  const item = object(value, 'stored pull');
  const state = object(item['state'], 'stored state');
  const kind = choice(
    state['kind'],
    ['merged', 'open', 'closed', 'draft'],
    'stored state.kind',
  );
  return parsePull({
    title: item['title'],
    html_url: item['url'],
    user: { login: item['author'] },
    head: { sha: item['headSha'] },
    updated_at: item['updatedAt'],
    state: ['merged', 'closed'].includes(kind) ? 'closed' : 'open',
    draft: kind === 'draft',
    merged_at: kind === 'merged' ? state['mergedAt'] : null,
  });
}
function parseStoredReview(value: unknown): Review {
  const item = object(value, 'stored review');
  return {
    author: text(item['author'], 'stored review.author'),
    isBot: bool(item['isBot'], 'stored review.isBot'),
    decision: choice(
      item['decision'],
      ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'],
      'stored review.decision',
    ),
    submittedAt: timestamp(item['submittedAt'], 'stored review.submittedAt'),
  };
}
function parseStoredCheck(value: unknown): Check {
  const item = object(value, 'stored check');
  return {
    ...parseCheck({
      ...item,
      head_sha: item['headSha'],
      details_url: item['url'],
    }),
    key: text(item['key'], 'stored check.key'),
  };
}
function parseStoredStatus(value: unknown): CommitStatus {
  const item = object(value, 'stored status');
  return parseStatus({
    context: item['name'],
    state: item['state'],
    target_url: item['url'],
  });
}
function parseRemote<T>(
  value: unknown,
  parser: (data: unknown) => T,
): Remote<T> {
  const item = object(value, 'remote');
  const status = choice(item['status'], ['ok', 'error'], 'remote.status');
  if (status === 'ok')
    return {
      status,
      data: parser(item['data']),
      fetchedAt: timestamp(item['fetchedAt'], 'remote.fetchedAt'),
    };
  return {
    status,
    data: item['data'] === null ? null : parser(item['data']),
    fetchedAt:
      item['fetchedAt'] === null
        ? null
        : timestamp(item['fetchedAt'], 'remote.fetchedAt'),
    message: text(item['message'], 'remote.message'),
  };
}
function parseContribution(value: unknown): Contribution {
  const item = object(value, 'contribution');
  const ref = parseRef(item['ref']);
  const pull = parseRemote(item['pull'], parseStoredPull);
  if (
    pull.data !== null &&
    pull.data.url.toLowerCase() !==
      `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`.toLowerCase()
  )
    invalid('pull URL does not match reference');
  const result = {
    ref,
    pull,
    reviews: parseRemote(item['reviews'], (data) =>
      list(data, parseStoredReview, 'stored reviews'),
    ),
    checks: parseRemote(item['checks'], (data) =>
      list(data, parseStoredCheck, 'stored checks'),
    ),
    statuses: parseRemote(item['statuses'], (data) =>
      list(data, parseStoredStatus, 'stored statuses'),
    ),
    workflows: parseRemote(item['workflows'], (data) =>
      list(data, parseStoredCheck, 'stored workflows'),
    ),
  };
  if (pull.data)
    for (const source of [result.checks, result.workflows]) {
      if (
        source.status === 'ok' &&
        source.data.some((run) => run.headSha !== pull.data?.headSha)
      )
        invalid('CI commit does not match PR');
    }
  return result;
}
export function parseSnapshot(value: unknown): Snapshot {
  const item = object(value, 'snapshot');
  if (item['version'] !== 1) invalid('snapshot version');
  const username = text(item['username'], 'snapshot username');
  const contributions = list(
    item['contributions'],
    parseContribution,
    'contributions',
  );
  const ids = contributions.map((entry) =>
    `${entry.ref.owner}/${entry.ref.repo}#${entry.ref.number}`.toLowerCase(),
  );
  if (ids.length > 100 || new Set(ids).size !== ids.length)
    invalid('contribution count or duplicate reference');
  if (
    contributions.some(
      (entry) =>
        entry.pull.data &&
        entry.pull.data.author.toLowerCase() !== username.toLowerCase(),
    )
  )
    invalid('PR author does not match username');
  return {
    version: 1,
    username,
    capturedAt: timestamp(item['capturedAt'], 'snapshot.capturedAt'),
    contributions,
  };
}
