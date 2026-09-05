import { connections, type Keys } from './models.ts';

export const KEY_STORAGE = 'voice-lab-api-keys-backup-v1';
export function parseKeys(json: string): Keys {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Paste a valid JSON object exported from Voxbench.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The backup must be a JSON object.');
  const allowed = new Set<string>(connections.map((c) => c.id));
  const entries = Object.entries(value);
  if (
    entries.some(
      ([id, key]) =>
        (!allowed.has(id) && id !== 'mistral') || typeof key !== 'string',
    )
  )
    throw new Error(
      'The backup contains an unknown provider or a value that is not text.',
    );
  return Object.fromEntries(
    entries
      .filter(([id]) => allowed.has(id))
      .map(([id, key]) => [id, (key as string).trim()]),
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

export function mergeSavedKeys(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  patch: Keys,
  replace = false,
): Keys {
  const existing = replace
    ? {}
    : parseKeys(storage.getItem(KEY_STORAGE) ?? '{}');
  const next = { ...existing, ...patch };
  saveKeys(storage, next);
  return next;
}
export const VOCABULARY_STORAGE = 'voice-lab-vocabulary-v1';
export function saveVocabulary(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  value: string,
) {
  storage.setItem(VOCABULARY_STORAGE, value);
  if (storage.getItem(VOCABULARY_STORAGE) !== value)
    throw new Error('Storage verification failed.');
}
export const SETTINGS_STORAGE = 'voxbench-settings-v1';
export type Settings = {
  selected?: string[];
  english?: boolean;
  useVocabulary?: boolean;
};
export function readSettings(storage: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = JSON.parse(storage.getItem(SETTINGS_STORAGE) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    return {
      ...(Array.isArray(r.selected) &&
      r.selected.every((x) => typeof x === 'string')
        ? { selected: r.selected as string[] }
        : {}),
      ...(typeof r.english === 'boolean' ? { english: r.english } : {}),
      ...(typeof r.useVocabulary === 'boolean'
        ? { useVocabulary: r.useVocabulary }
        : {}),
    };
  } catch {
    return {};
  }
}
export function writeSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: Settings,
) {
  try {
    storage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
  } catch {
    /* Settings are a convenience; losing them is harmless. */
  }
}
