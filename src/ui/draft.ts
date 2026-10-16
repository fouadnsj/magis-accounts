// The entry being typed, kept in memory (never on disk) so that a sign-out for
// inactivity does not lose it: the same person, signing in again on the same
// database, finds the form as he left it. Anyone else: it is forgotten.
import type { Session } from '../state';

interface Draft {
  key: string;
  start: unknown;
  form: unknown;
}

let draft: Draft | null = null;

export const draftKey = (s: Session) => `${s.mode}|${s.dbPath ?? s.organisation}|${s.profile.id}`;

export function keepDraft(key: string, start: unknown, form: unknown) {
  draft = { key, start, form };
}

export function dropDraft() {
  draft = null;
}

/** The draft of this person, if any; a draft of someone else is forgotten. */
export function draftFor(key: string): Draft | null {
  if (draft && draft.key !== key) draft = null;
  return draft;
}
