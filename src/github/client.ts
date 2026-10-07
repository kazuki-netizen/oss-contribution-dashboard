import { contributionId } from '../config.ts';
import type {
  Check,
  Contribution,
  ContributionRef,
  Remote,
  Snapshot,
} from '../domain/types.ts';
import {
  parseChecks,
  parsePull,
  parseReviews,
  parseStatuses,
  parseWorkflows,
} from './parse.ts';

export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface ClientOptions {
  readonly token?: string;
  readonly fetcher?: typeof fetch;
}

export class GitHubClient {
  private readonly fetcher: typeof fetch;
  private readonly token: string | undefined;
  private rateLimitError: GitHubError | null = null;
  constructor(options: ClientOptions = {}) {
    // Browser fetch requires the Window receiver; storing it as a method changes `this`.
    this.fetcher = (options.fetcher ?? fetch).bind(globalThis);
    this.token = options.token;
  }
  private async request(
    path: string,
  ): Promise<{ data: unknown; next: string | null }> {
    if (this.rateLimitError) throw this.rateLimitError;
    const url = new URL(path, 'https://api.github.com');
    if (
      url.origin !== 'https://api.github.com' ||
      !url.pathname.startsWith('/repos/')
    )
      throw new GitHubError('許可されていないAPIのURLです。', 0);
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await this.fetcher(url.href, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const limited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.has('retry-after')));
      const reset = response.headers.get('x-ratelimit-reset');
      const time =
        reset && Number.isFinite(Number(reset))
          ? ` ${new Date(Number(reset) * 1000).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）以降に再試行してください。`
          : ' 時間を置いて再試行してください。';
      const error = new GitHubError(
        limited
          ? `GitHub APIの利用上限に達しました。${time}`
          : `GitHubから取得できませんでした（HTTP ${response.status}）。`,
        response.status,
      );
      if (limited) this.rateLimitError = error;
      throw error;
    }
    const data: unknown = await response.json();
    const nextUrl = response.headers
      .get('link')
      ?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    let next: string | null = null;
    if (nextUrl) {
      const parsed = new URL(nextUrl);
      if (parsed.origin !== url.origin || parsed.pathname !== url.pathname)
        throw new GitHubError('ページ送りのURLを検証できませんでした。', 0);
      next = parsed.href;
    }
    return { data, next };
  }
  async get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
    return parse((await this.request(path)).data);
  }
  async pages<T>(
    path: string,
    parse: (value: unknown) => readonly T[],
  ): Promise<readonly T[]> {
    const values: T[] = [];
    let next: string | null = path;
    const visited = new Set<string>();
    while (next !== null) {
      const normalized = new URL(next, 'https://api.github.com').href;
      if (visited.size >= 10 || visited.has(normalized))
        throw new GitHubError('APIのページ送りを完了できませんでした。', 0);
      visited.add(normalized);
      const page = await this.request(next);
      values.push(...parse(page.data));
      next = page.next;
    }
    return values;
  }
}

function failed<T>(message: string, previous?: Remote<T>): Remote<T> {
  return {
    status: 'error',
    message,
    data: previous?.data ?? null,
    fetchedAt: previous?.fetchedAt ?? null,
  };
}
function message(error: unknown): string {
  if (error instanceof GitHubError) return error.message;
  if (error instanceof Error && error.name === 'ValidationError')
    return 'APIの応答形式を検証できませんでした。';
  return '通信に失敗しました。保存済みの情報を表示します。';
}
async function capture<T>(
  load: () => Promise<T>,
  previous?: Remote<T>,
): Promise<Remote<T>> {
  try {
    return {
      status: 'ok',
      data: await load(),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    return failed(message(error), previous);
  }
}
function latestChecks(runs: readonly Check[]): readonly Check[] {
  // GitHub returns newest runs first. An older failed attempt must not override a successful rerun.
  const names = new Map<string, Check>();
  for (const run of runs) if (!names.has(run.key)) names.set(run.key, run);
  return [...names.values()];
}

export async function loadContribution(
  client: GitHubClient,
  ref: ContributionRef,
  previous?: Contribution,
): Promise<Contribution> {
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const pull = await capture(
    () => client.get(`${base}/pulls/${ref.number}`, parsePull),
    previous?.pull,
  );
  if (pull.status === 'error')
    return {
      ref,
      pull,
      reviews: failed(
        'PRを取得できないため、レビューは更新していません。',
        previous?.reviews,
      ),
      checks: failed(
        '最新コミットを確認できないため、CIは更新していません。',
        previous?.checks,
      ),
      statuses: failed(
        '最新コミットを確認できないため、CIは更新していません。',
        previous?.statuses,
      ),
      workflows: failed(
        '最新コミットを確認できないため、CIは更新していません。',
        previous?.workflows,
      ),
    };
  const head = pull.data.headSha;
  const sameHead = previous?.pull.data?.headSha === head;
  const [reviews, checks, statuses, workflows] = await Promise.all([
    capture(
      () =>
        client.pages(
          `${base}/pulls/${ref.number}/reviews?per_page=100`,
          parseReviews,
        ),
      previous?.reviews,
    ),
    capture(
      async () =>
        (
          await client.pages(
            `${base}/commits/${head}/check-runs?filter=latest&per_page=100`,
            parseChecks,
          )
        ).filter((run) => run.headSha === head),
      sameHead ? previous?.checks : undefined,
    ),
    capture(
      async () => {
        const all = await client.pages(
          `${base}/commits/${head}/status?per_page=100`,
          parseStatuses,
        );
        return [
          ...new Map(
            [...all].reverse().map((status) => [status.name, status]),
          ).values(),
        ];
      },
      sameHead ? previous?.statuses : undefined,
    ),
    capture(
      async () =>
        latestChecks(
          (
            await client.pages(
              `${base}/actions/runs?head_sha=${head}&event=pull_request&per_page=100`,
              parseWorkflows,
            )
          ).filter((run) => run.headSha === head),
        ),
      sameHead ? previous?.workflows : undefined,
    ),
  ]);
  return { ref, pull, reviews, checks, statuses, workflows };
}

export async function loadSnapshot(
  client: GitHubClient,
  username: string,
  refs: readonly ContributionRef[],
  previous?: Snapshot,
  onProgress?: (completed: number, total: number) => void,
): Promise<Snapshot> {
  const contributions: Contribution[] = [];
  for (const ref of refs) {
    const old = previous?.contributions.find(
      (entry) => contributionId(entry.ref) === contributionId(ref),
    );
    const result = await loadContribution(client, ref, old);
    if (
      result.pull.status === 'ok' &&
      result.pull.data.author.toLowerCase() !== username.toLowerCase()
    )
      throw new GitHubError(
        '追跡するPRの著者が設定したユーザーと一致しません。',
        0,
      );
    contributions.push(result);
    onProgress?.(contributions.length, refs.length);
  }
  return {
    version: 1,
    username,
    capturedAt: new Date().toISOString(),
    contributions,
  };
}
