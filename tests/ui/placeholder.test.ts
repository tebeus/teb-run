import { describe, expect, test } from 'vitest';
import { emptyActions } from '../../src/core/input';
import { makePlaceholder } from '../../src/ui/screens/placeholder';

describe('makePlaceholder', () => {
  test('goes to the next screen on confirm', () => {
    const s = makePlaceholder('TITLE', 'radio');
    s.enter();
    expect(s.update(1 / 60, { ...emptyActions(), confirm: true })).toEqual({ to: 'radio' });
  });

  test('stays without confirm', () => {
    const s = makePlaceholder('TITLE', 'radio');
    s.enter();
    expect(s.update(1 / 60, emptyActions())).toBeNull();
    expect(s.update(1 / 60, { ...emptyActions(), accelerate: true })).toBeNull();
  });
});
