import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, loadContribution } from '../src/github/client.ts';
import { ciState, humanReviewState } from '../src/domain/summarize.ts';
import { parseReviews } from '../src/github/parse.ts';
import {
  check,
  contribution,
  HEAD,
  NEW_HEAD,
  ok,
  rawPull,
  rawReview,
  rawWorkflow,
  ref,
} from './fixtures.ts';

function api(overrides: (url: URL) => Response | undefined = () => undefined) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const override = overrides(url);
    if (override) return override;
    if (url.pathname.endsWith('/reviews')) return Response.json([]);
    if (url.pathname.endsWith('/check-runs'))
      return Response.json({ check_runs: [] });
    if (url.pathname.endsWith('/status'))
      return Response.json({ statuses: [] });
    if (url.pathname.endsWith('/actions/runs'))
      return Response.json({ workflow_runs: [] });
    return Response.json(rawPull);
  });
}

describe('GitHub client', () => {
  it('reads review pagination before deciding whether a change request remains', async () => {
    const fetcher = api((url) => {
      if (!url.pathname.endsWith('/reviews')) return undefined;
      return url.searchParams.get('page') === '2'
        ? Response.json([
            rawReview('APPROVED', 'maintainer', '2026-10-08T00:00:00Z'),
          ])
        : Response.json([rawReview('CHANGES_REQUESTED')], {
            headers: {
              link: '<https://api.github.com/repos/axios/axios/pulls/11294/reviews?per_page=100&page=2>; rel="next"',
            },
          });
    });
    const result = await loadContribution(new GitHubClient({ fetcher }), ref);
    expect(humanReviewState(result.reviews)).toBe('approved');
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('rejects cross-origin pagination without sending the token there', async () => {
    const fetcher = api(() =>
      Response.json([], {
        headers: { link: '<https://example.org/steal>; rel="next"' },
      }),
    );
    await expect(
      new GitHubClient({ fetcher, token: 'test-token' }).pages(
        '/repos/axios/axios/pulls/11294/reviews',
        parseReviews,
      ),
    ).rejects.toThrow('URL');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not make further requests after a rate-limit response', async () => {
    const fetcher = api(
      () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    );
    const client = new GitHubClient({ fetcher });
    const result = await loadContribution(client, ref, contribution());
    expect(result.pull.status).toBe('error');
    expect(result.pull.data?.title).toBe('Fix a bug');
    expect(ciState(result)).toBe('unavailable');
    await loadContribution(client, { ...ref, number: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not request CI for an unverified cached head after a pull request fetch fails', async () => {
    const fetcher = api(() => new Response('{}', { status: 500 }));
    await loadContribution(new GitHubClient({ fetcher }), ref, contribution());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('drops cached CI for an old head when fetching the new CI fails', async () => {
    const fetcher = api((url) =>
      url.pathname.endsWith('/pulls/11294')
        ? Response.json({ ...rawPull, head: { sha: NEW_HEAD } })
        : new Response('{}', { status: 500 }),
    );
    const previous = contribution({ checks: ok([check()]) });
    const result = await loadContribution(
      new GitHubClient({ fetcher }),
      ref,
      previous,
    );
    expect(result.pull.data?.headSha).toBe(NEW_HEAD);
    expect(result.checks.data).toBeNull();
    expect(ciState(result)).toBe('unavailable');
  });
  it('ignores workflow runs for a different head', async () => {
    const fetcher = api((url) =>
      url.pathname.endsWith('/actions/runs')
        ? Response.json({
            workflow_runs: [{ ...rawWorkflow('failure'), head_sha: NEW_HEAD }],
          })
        : undefined,
    );
    const result = await loadContribution(new GitHubClient({ fetcher }), ref);
    expect(result.workflows.data).toEqual([]);
  });
  it('uses the latest attempt of the same workflow', async () => {
    const fetcher = api((url) =>
      url.pathname.endsWith('/actions/runs')
        ? Response.json({
            workflow_runs: [rawWorkflow('success'), rawWorkflow('failure')],
          })
        : undefined,
    );
    expect(
      ciState(await loadContribution(new GitHubClient({ fetcher }), ref)),
    ).toBe('passed');
  });
  it('keeps different workflows with the same display name', async () => {
    const fetcher = api((url) =>
      url.pathname.endsWith('/actions/runs')
        ? Response.json({
            workflow_runs: [
              rawWorkflow('success', 1),
              rawWorkflow('failure', 2),
            ],
          })
        : undefined,
    );
    expect(
      ciState(await loadContribution(new GitHubClient({ fetcher }), ref)),
    ).toBe('failed');
  });
  it('uses the PR’s current head in all CI requests', async () => {
    const fetcher = api();
    await loadContribution(new GitHubClient({ fetcher }), ref);
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(
      urls
        .filter((url) => url.includes('/commits/'))
        .every((url) => url.includes(HEAD)),
    ).toBe(true);
    expect(urls.find((url) => url.includes('/actions/runs'))).toContain(
      `head_sha=${HEAD}`,
    );
  });
});
