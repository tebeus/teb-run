import { describe, expect, test } from 'vitest';
import {
  STARTUP_ERROR_PREFIX,
  showStartupError,
  startupErrorMessage,
  type ErrorHost,
} from '../../src/core/fatal';

describe('startupErrorMessage', () => {
  test('an Error contributes its message', () => {
    expect(startupErrorMessage(new Error('manifest 404'))).toBe(`${STARTUP_ERROR_PREFIX}: manifest 404`);
  });

  test('a thrown string is used as is', () => {
    expect(startupErrorMessage('no canvas')).toBe(`${STARTUP_ERROR_PREFIX}: no canvas`);
  });

  test('nothing useful still gives a sentence, never a dangling colon', () => {
    for (const reason of [undefined, null, '', '   ', new Error(''), {}]) {
      expect(startupErrorMessage(reason)).toBe(`${STARTUP_ERROR_PREFIX}: unknown error`);
    }
  });

  test('a number or a boolean is printed, not swallowed', () => {
    expect(startupErrorMessage(404)).toBe(`${STARTUP_ERROR_PREFIX}: 404`);
    expect(startupErrorMessage(false)).toBe(`${STARTUP_ERROR_PREFIX}: false`);
  });

  test('an object whose String() throws does not take the handler down with it', () => {
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };
    expect(() => startupErrorMessage(hostile)).not.toThrow();
    expect(startupErrorMessage(hostile)).toBe(`${STARTUP_ERROR_PREFIX}: unknown error`);
  });
});

describe('showStartupError', () => {
  const fakeBody = (): NonNullable<ErrorHost['body']> => ({
    textContent: 'old content',
    style: { background: '', color: '', font: '' },
  });

  test('writes the message into the body and makes it readable', () => {
    const body = fakeBody();
    showStartupError({ body }, 'TEB RUN could not start: boom');
    expect(body.textContent).toBe('TEB RUN could not start: boom');
    expect(body.style.background).toBe('#000000');
    expect(body.style.color).not.toBe('');
  });

  test('a page without a body does not throw', () => {
    expect(() => showStartupError({ body: null }, 'anything')).not.toThrow();
  });
});
