import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { CONTRIBUTIONS, USERNAME } from '../src/config.ts';
import { hasErrors } from '../src/domain/summarize.ts';
import { GitHubClient, loadSnapshot } from '../src/github/client.ts';
import { parseSnapshot } from '../src/github/parse.ts';

const token =
  process.env['GH_TOKEN'] ??
  process.env['GITHUB_TOKEN'] ??
  (process.argv.includes('--github-cli')
    ? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
    : undefined);
const client = new GitHubClient(token ? { token } : {});
const snapshot = parseSnapshot(
  await loadSnapshot(
    client,
    USERNAME,
    CONTRIBUTIONS,
    undefined,
    (done, total) => console.log(`Fetched ${done}/${total} contributions`),
  ),
);
await writeFile(
  new URL('../public/snapshot.json', import.meta.url),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
const incomplete = snapshot.contributions.filter(hasErrors);
if (incomplete.length > 0) {
  for (const item of incomplete) {
    console.error(
      `Incomplete: ${item.ref.owner}/${item.ref.repo}#${item.ref.number}`,
    );
    for (const source of [
      item.pull,
      item.reviews,
      item.checks,
      item.statuses,
      item.workflows,
    ])
      if (source.status === 'error') console.error(source.message);
  }
  process.exitCode = 1;
} else
  console.log(
    `Saved ${snapshot.contributions.length} verified records at ${snapshot.capturedAt}`,
  );
