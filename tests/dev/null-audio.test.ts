import { describe, expect, test } from 'vitest';
import { createNullAudio } from '../../src/dev/null-audio';

describe('createNullAudio', () => {
  test('starts unmuted and toggles', () => {
    const audio = createNullAudio();
    expect(audio.muted).toBe(false);
    expect(audio.toggleMute()).toBe(true);
    expect(audio.muted).toBe(true);
    expect(audio.toggleMute()).toBe(false);
    expect(audio.muted).toBe(false);
  });

  test('is available by default, and can be marked unavailable', () => {
    expect(createNullAudio().available).toBe(true);
    expect(createNullAudio({ available: false }).available).toBe(false);
  });

  test('every method is a safe no-op', () => {
    const audio = createNullAudio();
    expect(() => {
      audio.unlock();
      audio.playSong(0);
      audio.playSong(1);
      audio.playSong(2);
      audio.stopSong();
      audio.sfx('crash');
      audio.sfx('bump');
      audio.sfx('checkpoint');
      audio.sfx('fanfare');
      audio.sfx('blip');
      audio.setEngine(0.5, 'hi', true);
      audio.setSkid(true);
      audio.setSkid(false);
      audio.setRumble(true);
      audio.setRumble(false);
    }).not.toThrow();
  });

  test('when unavailable, muted is true and toggleMute does nothing', () => {
    const audio = createNullAudio({ available: false });
    expect(audio.muted).toBe(true);
    expect(audio.toggleMute()).toBe(true);
    expect(audio.muted).toBe(true);
    expect(audio.toggleMute()).toBe(true);
    expect(audio.muted).toBe(true);
  });
});
