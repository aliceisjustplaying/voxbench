import { connections, type Keys } from './models.ts';

export const KEY_STORAGE = 'voice-lab-api-keys-backup-v1';
export function parseKeys(json: string): Keys {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Paste a valid JSON object exported from Voice Lab.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The backup must be a JSON object.');
  const allowed = new Set<string>(connections.map((c) => c.id));
  const entries = Object.entries(value);
  if (entries.some(([id, key]) => !allowed.has(id) || typeof key !== 'string'))
    throw new Error(
      'The backup contains an unknown provider or a value that is not text.',
    );
  return Object.fromEntries(
    entries.map(([id, key]) => [id, (key as string).trim()]),
  );
}
export function saveKeys(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  keys: Keys,
) {
  const json = JSON.stringify(keys, null, 2);
  storage.setItem(KEY_STORAGE, json);
  if (storage.getItem(KEY_STORAGE) !== json)
    throw new Error('Storage verification failed.');
}
