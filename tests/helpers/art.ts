import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the illustrated sprites are not in this checkout. The public
 * repository ships the code without the art (the art is not MIT), so the
 * tests that measure the PNGs skip themselves and the game draws everything
 * with the procedural fallbacks.
 */
export const NO_ART = !existsSync(fileURLToPath(new URL('../../public/sprites/player_straight.png', import.meta.url)));
