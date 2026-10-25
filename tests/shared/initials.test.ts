// Le iniziali della classifica mondiale: tre lettere A-Z e niente
// combinazioni offensive. La lista è una sola: il client la usa per un
// messaggio subito in `nameEntry`, il server per decidere.

import { describe, expect, test } from 'vitest';
import { BLOCKED_INITIALS, blockedInitials, initialsOk, validInitials } from '../../src/shared/initials';

describe('initials', () => {
  test('three capital letters A-Z, nothing else', () => {
    expect(validInitials('ABC')).toBe(true);
    expect(validInitials('TEB')).toBe(true);
    for (const bad of ['abc', 'AB', 'ABCD', 'A1C', '123', 'ÀBC', 'A C', '', 'ABC\n']) expect(validInitials(bad)).toBe(false);
    expect(validInitials(42 as unknown as string)).toBe(false);
  });

  test('the block list: three letters each, no duplicates, sorted', () => {
    for (const w of BLOCKED_INITIALS) expect(w).toMatch(/^[A-Z]{3}$/);
    expect(new Set(BLOCKED_INITIALS).size).toBe(BLOCKED_INITIALS.length);
    expect([...BLOCKED_INITIALS]).toEqual([...BLOCKED_INITIALS].sort());
  });

  test('blocked: offensive combinations in six languages; allowed: ordinary initials', () => {
    for (const w of ['FUK', 'FCK', 'KKK', 'NIG', 'CAZ', 'CUL', 'NTM', 'KUT', 'HUR', 'PTA']) expect(blockedInitials(w)).toBe(true);
    for (const w of ['TEB', 'ABC', 'AAA', 'ZZZ', 'JON', 'ANA', 'MAX']) expect(blockedInitials(w)).toBe(false);
  });

  test('initialsOk = valid and not blocked', () => {
    expect(initialsOk('TEB')).toBe(true);
    expect(initialsOk('FUK')).toBe(false);
    expect(initialsOk('fuk')).toBe(false);
  });

  test('no digits needed: the form rejects them before the list', () => {
    // 'F4K', 'N1G': `^[A-Z]{3}$` li rifiuta già, e nameEntry offre solo A-Z.
    expect(initialsOk('F4K')).toBe(false);
    expect(initialsOk('N1G')).toBe(false);
  });
});
