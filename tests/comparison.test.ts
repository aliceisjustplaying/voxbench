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
import { importVocabulary } from '../lib/comparison.ts';
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
