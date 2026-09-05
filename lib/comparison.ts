export type Edit = {
  kind: 'same' | 'insert' | 'delete' | 'replace';
  expected?: string;
  actual?: string;
};
export function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLocaleLowerCase('en')
      .replace(/[’‘]/g, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || []
  );
}
export function compareWords(reference: string, actual: string) {
  const a = words(reference),
    b = words(actual);
  if (!a.length) return null;
  if (a.length > 1500 || b.length > 1500) return null;
  const matrix = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
  const edits: Edit[] = [];
  let i = a.length,
    j = b.length;
  while (i || j) {
    if (
      i &&
      j &&
      matrix[i][j] === matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])
    ) {
      edits.push({
        kind: a[i - 1] === b[j - 1] ? 'same' : 'replace',
        expected: a[--i],
        actual: b[--j],
      });
    } else if (j && matrix[i][j] === matrix[i][j - 1] + 1) {
      edits.push({ kind: 'insert', actual: b[--j] });
    } else {
      edits.push({ kind: 'delete', expected: a[--i] });
    }
  }
  return {
    errors: matrix[a.length][b.length],
    referenceWords: a.length,
    rate: matrix[a.length][b.length] / a.length,
    edits: edits.reverse(),
  };
}
export function parseVocabulary(text: string) {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}
export function vocabularyHits(text: string, terms: string[]) {
  const normalized = ' ' + words(text).join(' ') + ' ';
  return terms.filter((t) =>
    normalized.includes(' ' + words(t).join(' ') + ' '),
  );
}
export function importVocabulary(contents: string): string[] {
  const value = contents.replace(/^\uFEFF/, '').trim();
  if (!value) return [];
  if (value.startsWith('{') || value.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(value);
    } catch {
      throw new Error('This dictionary is not valid JSON.');
    }
    const list = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? (data as { words?: unknown }).words
        : undefined;
    if (!Array.isArray(list))
      throw new Error(
        'Expected a word list or a Monologue dictionary with a words array.',
      );
    return list.map((item) => {
      const term =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? (item as { text?: unknown }).text
            : undefined;
      if (typeof term !== 'string' || !term.trim() || /[\r\n]/.test(term))
        throw new Error(
          'Each dictionary entry must contain one word or phrase.',
        );
      return term.trim();
    });
  }
  return value
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}
export type Ranking = {
  basis: 'reference' | 'consensus' | null;
  rank: Record<string, number>;
  /** Word error rate against the reference, or mean distance to the other transcripts. */
  score: Record<string, number>;
  order: string[];
};
/**
 * Rank transcripts by word errors against the reference, or, without one,
 * by how closely each agrees with the other transcripts (consensus).
 * Items without text keep their original order after ranked ones.
 */
export function rankTranscripts(
  items: { id: string; text?: string }[],
  reference: string,
): Ranking {
  const scored = items.filter(
    (x): x is { id: string; text: string } => typeof x.text === 'string',
  );
  const useReference = words(reference).length > 0;
  if (scored.length < (useReference ? 1 : 2))
    return { basis: null, rank: {}, score: {}, order: items.map((x) => x.id) };
  const distance = (a: string, b: string) => compareWords(a, b)?.rate ?? 1;
  const score = new Map(
    scored.map((x) => [
      x.id,
      useReference
        ? distance(reference, x.text)
        : scored
            .filter((o) => o.id !== x.id)
            .reduce(
              (sum, o) =>
                sum + (distance(o.text, x.text) + distance(x.text, o.text)) / 2,
              0,
            ) /
          (scored.length - 1),
    ]),
  );
  const ranked = [...scored].sort(
    (a, b) => score.get(a.id)! - score.get(b.id)!,
  );
  const rank: Record<string, number> = {};
  ranked.forEach((x, i) => {
    rank[x.id] = i + 1;
  });
  return {
    basis: useReference ? 'reference' : 'consensus',
    rank,
    score: Object.fromEntries(score),
    order: [
      ...ranked.map((x) => x.id),
      ...items.filter((x) => !score.has(x.id)).map((x) => x.id),
    ],
  };
}
