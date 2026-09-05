import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareClip, validateRecordedDuration } from '../lib/audio.ts';

test('rejects a half-second recording after several seconds of capture', () => {
  assert.throws(
    () => validateRecordedDuration(0.5, 3.2),
    /Only 0.5s of your 3.2s/,
  );
  assert.throws(() => validateRecordedDuration(15, 30), /Only 15.0s/);
  for (const [actual, expected] of [
    [3.1, 3.2],
    [29.4, 30],
    [0.5, 0.5],
  ])
    assert.doesNotThrow(() => validateRecordedDuration(actual, expected));
});

test('decodes recordings offline and rejects truncation before creating a WAV', async () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'OfflineAudioContext',
  );
  let contexts = 0;
  class OfflineDecoder {
    constructor(channels: number, length: number, rate: number) {
      contexts++;
      assert.deepEqual([channels, length, rate], [1, 1, 16000]);
    }
    async decodeAudioData() {
      return { duration: 0.5 };
    }
  }
  Object.defineProperty(globalThis, 'OfflineAudioContext', {
    value: OfflineDecoder,
    configurable: true,
  });
  try {
    await assert.rejects(
      prepareClip(new Blob(['test']), 'take', 'recording', 3.2),
      /Only 0.5s/,
    );
    assert.equal(contexts, 1);
  } finally {
    if (original)
      Object.defineProperty(globalThis, 'OfflineAudioContext', original);
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
  }
});
