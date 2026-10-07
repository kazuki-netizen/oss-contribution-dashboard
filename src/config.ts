import type { ContributionRef } from './domain/types.ts';

export const USERNAME = 'kazuki-netizen';
export const REPOSITORY_URL =
  'https://github.com/kazuki-netizen/oss-contribution-dashboard';

export const CONTRIBUTIONS = [
  {
    owner: 'axios',
    repo: 'axios',
    number: 11294,
    language: 'JavaScript',
    focus:
      'Base64データURLの読み取りを修正。回帰テストとメモリ確保の上限検証を追加。',
  },
  {
    owner: 'vuejs',
    repo: 'core',
    number: 15769,
    language: 'TypeScript',
    focus:
      'SSRで空文字・0・falseを正しく反映するように修正し、回帰テストを追加。',
  },
  {
    owner: 'supabase',
    repo: 'supabase-js',
    number: 2489,
    language: 'TypeScript',
    focus:
      'フィルター値のエスケープを修正。実際のPostgRESTを使う統合テストを追加。',
  },
  {
    owner: 'date-fns',
    repo: 'date-fns',
    number: 4352,
    language: 'TypeScript',
    focus: '日・月・年の範囲処理で、小数のステップによる不整合を修正。',
  },
  {
    owner: 'Kludex',
    repo: 'starlette',
    number: 3622,
    language: 'Python',
    focus: '型付きmemoryviewのレスポンスでContent-Lengthを正しく算出。',
  },
  {
    owner: 'Kludex',
    repo: 'starlette',
    number: 3623,
    language: 'Python',
    focus:
      'ファイルの分割ストリーミングと、切断時のリソース管理を文書・テストで改善。',
  },
  {
    owner: 'iamkun',
    repo: 'dayjs',
    number: 3245,
    language: 'JavaScript',
    focus:
      'UTCオフセットがある場合のタイムスタンプを修正。依存PRの採用待ちでDraft。',
  },
] as const satisfies readonly ContributionRef[];

export function contributionId(ref: ContributionRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
