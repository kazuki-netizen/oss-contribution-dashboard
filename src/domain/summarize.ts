import type {
  CiState,
  Contribution,
  HumanReviewState,
  Review,
  Snapshot,
} from './types.ts';

export function humanReviewState(
  reviews: Contribution['reviews'],
): HumanReviewState {
  if (reviews.status === 'error') return 'unavailable';
  const humans = reviews.data.filter((review) => !review.isBot);
  const latest = new Map<string, Review>();
  for (const review of [...humans].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  )) {
    // A later comment does not revoke an existing approval or change request.
    if (review.decision !== 'COMMENTED')
      latest.set(review.author.toLowerCase(), review);
  }
  const decisions = [...latest.values()];
  if (decisions.some((review) => review.decision === 'CHANGES_REQUESTED'))
    return 'changes-requested';
  if (decisions.some((review) => review.decision === 'APPROVED'))
    return 'approved';
  return humans.some((review) => review.decision === 'COMMENTED')
    ? 'commented'
    : 'waiting';
}

export function ciState(contribution: Contribution): CiState {
  const { checks, statuses, workflows } = contribution;
  if (
    checks.status === 'error' ||
    statuses.status === 'error' ||
    workflows.status === 'error'
  )
    return 'unavailable';
  const runs = [...checks.data, ...workflows.data];
  if (
    runs.some((run) =>
      ['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(
        run.conclusion ?? '',
      ),
    ) ||
    statuses.data.some((status) => ['failure', 'error'].includes(status.state))
  )
    return 'failed';
  // GitHub may report action_required without creating any CheckRun.
  if (runs.some((run) => run.conclusion === 'action_required'))
    return 'action-required';
  if (
    runs.some((run) => run.status !== 'completed') ||
    statuses.data.some((status) => status.state === 'pending')
  )
    return 'running';
  // Skipped/neutral checks alone do not prove that tests passed.
  if (
    runs.some((run) => run.conclusion === 'success') ||
    statuses.data.some((status) => status.state === 'success')
  ) {
    const unexpected = runs.some(
      (run) =>
        !['success', 'skipped', 'neutral'].includes(run.conclusion ?? ''),
    );
    return unexpected ? 'unavailable' : 'passed';
  }
  return runs.length > 0 &&
    runs.some((run) => !['skipped', 'neutral'].includes(run.conclusion ?? ''))
    ? 'unavailable'
    : 'not-run';
}

export function hasErrors(contribution: Contribution): boolean {
  return [
    contribution.pull,
    contribution.reviews,
    contribution.checks,
    contribution.statuses,
    contribution.workflows,
  ].some((source) => source.status === 'error');
}

export function statistics(snapshot: Snapshot) {
  const items = snapshot.contributions;
  return {
    total: items.length,
    merged: items.filter((item) => item.pull.data?.state.kind === 'merged')
      .length,
    open: items.filter((item) =>
      ['open', 'draft'].includes(item.pull.data?.state.kind ?? ''),
    ).length,
    typescript: items.filter((item) => item.ref.language === 'TypeScript')
      .length,
    projects: new Set(items.map((item) => `${item.ref.owner}/${item.ref.repo}`))
      .size,
  };
}
