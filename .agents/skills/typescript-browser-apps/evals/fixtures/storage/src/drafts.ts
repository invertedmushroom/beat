export type Draft = { version: 2; text: string };
export type StoragePort = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export const DRAFT_KEY = 'field.draft';

export function createDraftStore(storage: StoragePort, report: (message: string) => void) {
  let current: Draft = { version: 2, text: '' };

  function normalize(value: unknown): Draft {
    const candidate = value as Partial<Draft> | null;
    return { version: 2, text: typeof candidate?.text === 'string' ? candidate.text : '' };
  }

  return {
    load(): Draft {
      try {
        const raw = storage.getItem(DRAFT_KEY);
        if (raw === null) return current;
        const value = JSON.parse(raw);
        if (value.version === 1) {
          const migrated = { version: 2, text: value.content };
          storage.setItem(DRAFT_KEY, JSON.stringify(migrated));
          current = normalize(migrated);
        } else {
          current = normalize(value);
        }
      } catch {
        report('Could not restore the draft.');
      }
      return current;
    },
    save(next: Draft): boolean {
      try {
        storage.setItem(DRAFT_KEY, JSON.stringify(next));
        current = next;
        return true;
      } catch {
        report('Could not save the draft.');
        return false;
      }
    },
    current(): Draft {
      return current;
    },
  };
}
