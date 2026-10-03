// Pagina di prova dell'audio: /dev/audio.html con `npm run dev`.
// Non fa parte del gioco, main.ts non la importa.
// bus.unlock() è chiamata solo dai gestori di gesto (clic dei bottoni, change
// dei controlli, primo pointerdown e primo keydown): mai dal loop di frame,
// perché Safari pretende lo stack di chiamata del gesto (spec §10).

import { createAudioBus } from '../audio/bus';
import { engineFreq } from '../audio/sfx';
import { SONG_TITLES } from '../audio/songs';
import { createInput } from '../core/input';
import type { Gear, SfxName } from '../types';

const bus = createAudioBus();
const input = createInput();

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node as T;
}

let gear: Gear = 'lo';
let speed = 0;
let running = true;
let skidToggle = false;

const songsBox = el<HTMLDivElement>('songs');
SONG_TITLES.forEach((title, index) => {
  const button = document.createElement('button');
  button.textContent = `${index}: ${title}`;
  button.addEventListener('click', () => {
    bus.unlock();
    bus.playSong(index);
  });
  songsBox.appendChild(button);
});

el<HTMLButtonElement>('stop').addEventListener('click', () => {
  bus.unlock();
  bus.stopSong();
});

const SFX_NAMES: SfxName[] = ['crash', 'bump', 'checkpoint', 'fanfare', 'blip'];
const sfxBox = el<HTMLDivElement>('sfx');
for (const name of SFX_NAMES) {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => {
    bus.unlock();
    bus.sfx(name);
  });
  sfxBox.appendChild(button);
}

const speedInput = el<HTMLInputElement>('speed');
speedInput.addEventListener('input', () => {
  bus.unlock();
  speed = Number(speedInput.value) / 100;
});

const runningInput = el<HTMLInputElement>('running');
runningInput.addEventListener('change', () => {
  bus.unlock();
  running = runningInput.checked;
});

const gearButton = el<HTMLButtonElement>('gear');
function flipGear(): void {
  gear = gear === 'lo' ? 'hi' : 'lo';
  gearButton.textContent = gear;
}
gearButton.addEventListener('click', () => {
  bus.unlock();
  flipGear();
});

const skidInput = el<HTMLInputElement>('skid');
skidInput.addEventListener('change', () => {
  bus.unlock();
  skidToggle = skidInput.checked;
});

el<HTMLButtonElement>('mute').addEventListener('click', () => {
  bus.unlock();
  bus.toggleMute();
});

// Nessun { once: true }: unlock() è idempotente, e così ogni tasto e ogni clic
// è un nuovo tentativo anche per chi gioca solo da tastiera.
window.addEventListener('pointerdown', () => bus.unlock());
window.addEventListener('keydown', () => bus.unlock());

const status = el<HTMLDivElement>('status');
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const actions = input.poll();
  if (actions.gearToggle) flipGear();
  if (actions.mute) bus.toggleMute();
  if (actions.accelerate) {
    speed = Math.min(1, speed + dt * 0.4);
    speedInput.value = String(Math.round(speed * 100));
  } else if (actions.brake) {
    speed = Math.max(0, speed - dt * 0.8);
    speedInput.value = String(Math.round(speed * 100));
  }
  const keySkid = (actions.left || actions.right) && speed > 0.6;
  const skid = skidToggle || keySkid;
  // setEngine e setSkid qui girano a 60 chiamate al secondo, come in gara.
  bus.setEngine(speed, gear, running);
  bus.setSkid(skid);
  status.textContent = [
    `available=${String(bus.available)}`,
    `muted=${String(bus.muted)}`,
    `speed=${speed.toFixed(2)}`,
    `gear=${gear}`,
    `running=${String(running)}`,
    `skid=${String(skid)}`,
    `engineHz=${engineFreq(speed, gear).toFixed(1)}`,
  ].join('  ');
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
