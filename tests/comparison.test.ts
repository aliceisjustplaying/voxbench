import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareWords,
  parseVocabulary,
  vocabularyHits,
} from '../lib/comparison.ts';
test('scores insertion and substitution without rewarding polished paraphrases', () => {
  const score = compareWords('I like cats', 'I really like dogs')!;
  assert.equal(score.errors, 2);
  assert.equal(score.referenceWords, 3);
  assert.deepEqual(
    score.edits.map((x) => x.kind),
    ['same', 'insert', 'same', 'replace'],
  );
});
test('ignores case and punctuation, preserves spoken-word differences', () => {
  assert.equal(compareWords('Hello, WORLD!', 'hello world')?.errors, 0);
  assert.equal(compareWords('twenty six', '26')?.errors, 2);
  assert.equal(compareWords('', 'hello'), null);
  assert.equal(compareWords('a b c', '')?.errors, 3);
  assert.equal(compareWords('one', 'one two three')?.rate, 2);
});
test('vocabulary matches whole phrases rather than substrings', () => {
  assert.deepEqual(parseVocabulary('Sarah, Codex\nSarah\n\nNew York'), [
    'Sarah',
    'Codex',
    'New York',
  ]);
  assert.deepEqual(
    vocabularyHits('A codex and New York City', ['code', 'Codex', 'New York']),
    ['Codex', 'New York'],
  );
});
import { importVocabulary, rankTranscripts } from '../lib/comparison.ts';
test('imports Monologue words preserving multi-word terms, exact spelling and ordering', () => {
  assert.deepEqual(
    importVocabulary(
      JSON.stringify({
        words: [
          { id: '1', text: 'New York', type: 'manual' },
          { id: '2', text: 'CodeX', type: 'manual' },
        ],
      }),
    ),
    ['New York', 'CodeX'],
  );
  assert.deepEqual(importVocabulary('New York\nCodeX\n'), [
    'New York',
    'CodeX',
  ]);
  assert.throws(() => importVocabulary('{"words":[{"id":1}]}'));
  assert.throws(() => importVocabulary('{bad}'));
});
test('ranks only with a reference and preserves model order without one', () => {
  const items = [
    { id: 'a', text: 'hey alice order the sourdough starter' },
    { id: 'b', text: 'hey alex order the sour dough starter' },
    { id: 'c', text: 'hey alice order the sourdough starter' },
    { id: 'd' },
  ];
  for (const reference of ['', '   ', '...']) {
    const unranked = rankTranscripts(items, reference);
    assert.equal(unranked.basis, null);
    assert.deepEqual(unranked.order, ['a', 'b', 'c', 'd']);
    assert.deepEqual(unranked.rank, {});
    assert.deepEqual(unranked.score, {});
  }
  const scored = rankTranscripts(
    items,
    'hey alex order the sour dough starter',
  );
  assert.equal(scored.basis, 'reference');
  assert.equal(scored.order[0], 'b');
  assert.equal(scored.score.b, 0);
  assert.equal(scored.order.at(-1), 'd');
  assert.deepEqual(rankTranscripts(items, '').rank, {});
  assert.equal(rankTranscripts([items[0], items[3]], '').basis, null);
});

test('equal word errors share a rank and the selected reference leads its tie', () => {
  const items = [
    { id: 'a', text: 'Hello, world!' },
    { id: 'b', text: 'hello world' },
    { id: 'c', text: 'hello there' },
    { id: 'd' },
  ];
  for (const selected of ['a', 'b']) {
    const ranked = rankTranscripts(items, 'hello world', selected);
    assert.equal(ranked.order[0], selected);
    assert.deepEqual(ranked.rank, {
      [selected]: 1,
      [selected === 'a' ? 'b' : 'a']: 1,
      c: 3,
    });
    assert.equal(ranked.score[selected], 0);
    assert.equal(ranked.order.at(-1), 'd');
  }
  // Editing the reference must take precedence over the selected card.
  const edited = rankTranscripts(items, 'hello there', 'b');
  assert.equal(edited.order[0], 'c');
  assert.equal(edited.rank.c, 1);
  assert.equal(edited.rank.b, 2);
});
