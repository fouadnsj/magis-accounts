// "Test as…" at the top of Administration (26 November 2026): the list of people one may open the program as is the same
// as the 👁 button's — active people only, never oneself, no Administrator or Director line unless one is the Administrator.
import { describe, expect, it } from 'vitest';
import { testAsChoices } from '../src/roles';

const access = [{ id: 1, kind: 'administrator' }, { id: 2, kind: 'director' }, { id: 3, kind: 'accountant' }, { id: 4, kind: 'reception' }, { id: 5, kind: null }];
const users = [
  { id: 10, active: 1, roles: [1] }, // Fouad, Administrator
  { id: 11, active: 1, roles: [2] }, // Nagham, Director
  { id: 12, active: 1, roles: [3] },
  { id: 13, active: 1, roles: [4, 5] },
  { id: 14, active: 0, roles: [4] }, // switched off
  { id: 15, active: 1, roles: [] as number[], access_id: 3 }, // an old person with one role only
];

describe('Test as…: who is in the list', () => {
  it('the Director sees neither Administrator nor Director lines, nor herself, nor switched-off people', () => {
    expect(testAsChoices(users, access, 11, false).map((u) => u.id)).toEqual([12, 13, 15]);
  });
  it('the Administrator sees every active person but himself', () => {
    expect(testAsChoices(users, access, 10, true).map((u) => u.id)).toEqual([11, 12, 13, 15]);
  });
  it('gives each person their roles', () => {
    const c = testAsChoices(users, access, 10, true);
    expect(c.find((u) => u.id === 13)!.roleRows.map((a) => a.id)).toEqual([4, 5]);
    expect(c.find((u) => u.id === 15)!.roleRows.map((a) => a.id)).toEqual([3]);
  });
});
