import type { AudioBus, Gear, SfxName } from '../types';

/**
 * AudioBus muto: usato nelle pagine di sviluppo prima che il binario B sia
 * collegato. `available` è vero di default (audio "silenzioso" ma
 * disponibile); si può forzare a falso per provare l'icona "NO AUDIO".
 */
export function createNullAudio(opts: { available?: boolean } = {}): AudioBus {
  const available = opts.available ?? true;
  let muted = false;
  return {
    unlock() {
      /* no-op */
    },
    playSong(_index: number) {
      /* no-op */
    },
    stopSong() {
      /* no-op */
    },
    sfx(_name: SfxName) {
      /* no-op */
    },
    setEngine(_speedPercent: number, _gear: Gear, _running: boolean) {
      /* no-op */
    },
    setSkid(_on: boolean) {
      /* no-op */
    },
    setRumble(_on: boolean) {
      /* no-op */
    },
    toggleMute() {
      if (!available) {
        return true;
      }
      muted = !muted;
      return muted;
    },
    get muted() {
      return !available || muted;
    },
    available,
  };
}
