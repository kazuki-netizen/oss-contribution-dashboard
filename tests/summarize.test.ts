import { describe, expect, it } from 'vitest';
import {
  ciState,
  humanReviewState,
  statistics,
} from '../src/domain/summarize.ts';
import {
  check,
  contribution,
  error,
  ok,
  review,
  snapshot,
} from './fixtures.ts';

describe('human reviews', () => {
  it('does not turn an AI approval into human approval', () =>
    expect(humanReviewState(ok([review('APPROVED', { isBot: true })]))).toBe(
      'waiting',
    ));
  it('keeps an approval after a later comment', () =>
    expect(
      humanReviewState(
        ok([
          review('APPROVED'),
          review('COMMENTED', { submittedAt: '2026-10-08T00:00:00Z' }),
        ]),
      ),
    ).toBe('approved'));
  it('uses the latest decision per reviewer, regardless of input order', () =>
    expect(
      humanReviewState(
        ok([
          review('APPROVED', { submittedAt: '2026-10-08T00:00:00Z' }),
          review('CHANGES_REQUESTED'),
        ]),
      ),
    ).toBe('approved'));
  it('retains another reviewer’s unresolved change request', () =>
    expect(
      humanReviewState(
        ok([
          review('APPROVED'),
          review('CHANGES_REQUESTED', { author: 'second' }),
        ]),
      ),
    ).toBe('changes-requested'));
  it('does not count a dismissed approval', () =>
    expect(
      humanReviewState(
        ok([
          review('APPROVED'),
          review('DISMISSED', { submittedAt: '2026-10-08T00:00:00Z' }),
        ]),
      ),
    ).toBe('waiting'));
  it('does not treat a comment as approval', () =>
    expect(humanReviewState(ok([review('COMMENTED')]))).toBe('commented'));
  it('marks cached approvals as unavailable after a failed refresh', () =>
    expect(humanReviewState(error([review('APPROVED')]))).toBe('unavailable'));
});

describe('CI aggregation', () => {
  it('finds action_required in workflow runs even when all visible CheckRuns passed', () =>
    expect(
      ciState(
        contribution({
          checks: ok([check()]),
          workflows: ok([check('action_required')]),
        }),
      ),
    ).toBe('action-required'));
  it('reports failure ahead of approval waiting', () =>
    expect(
      ciState(
        contribution({
          checks: ok([check('failure')]),
          workflows: ok([check('action_required')]),
        }),
      ),
    ).toBe('failed'));
  it('keeps pending commit statuses distinct from success', () =>
    expect(
      ciState(
        contribution({
          checks: ok([check()]),
          statuses: ok([{ name: 'deploy', state: 'pending', url: null }]),
        }),
      ),
    ).toBe('running'));
  it('does not interpret skipped checks as passing tests', () =>
    expect(ciState(contribution({ checks: ok([check('skipped')]) }))).toBe(
      'not-run',
    ));
  it('treats a cancelled workflow as incomplete CI', () =>
    expect(ciState(contribution({ workflows: ok([check('cancelled')]) }))).toBe(
      'failed',
    ));
  it('does not claim success when an API source is unavailable', () =>
    expect(
      ciState(contribution({ checks: ok([check()]), workflows: error() })),
    ).toBe('unavailable'));
  it('does not silently accept an unknown future conclusion', () =>
    expect(
      ciState(contribution({ checks: ok([check('future_conclusion')]) })),
    ).toBe('unavailable'));
  it('accepts success alongside neutral and skipped checks', () =>
    expect(
      ciState(
        contribution({
          checks: ok([check(), check('neutral'), check('skipped')]),
        }),
      ),
    ).toBe('passed'));
  it('distinguishes no runs from running jobs', () =>
    expect(ciState(contribution())).toBe('not-run'));
});

describe('contribution counts', () => {
  it('counts merged PRs, draft PRs and unique repositories separately', () => {
    const items = [
      contribution({
        pull: ok({
          ...contribution().pull.data!,
          state: { kind: 'merged', mergedAt: '2026-10-07T00:00:00Z' },
        }),
      }),
      contribution({
        ref: { ...contribution().ref, number: 2, language: 'TypeScript' },
        pull: ok({ ...contribution().pull.data!, state: { kind: 'draft' } }),
      }),
    ];
    expect(statistics(snapshot(items))).toEqual({
      total: 2,
      merged: 1,
      open: 1,
      typescript: 1,
      projects: 1,
    });
  });
});
