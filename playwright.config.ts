import { defineConfig, devices } from '@playwright/test';

/**
 * Porta dedicata agli e2e: non è la 5173 dello sviluppo di tutti i giorni.
 * `E2E_PORT` la sposta, se due copie del progetto provano insieme (con
 * `reuseExistingServer` si userebbe il server dell'altra copia).
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 5290);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Il gioco gira a 60 Hz. Il test del checkpoint, che percorre una tappa
  // intera (3256 segmenti, 1,5-2 min col suo autopilota), alza da sé la
  // propria soglia e parte con il tempo gonfiato dal gancio `#debug`.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e/out',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: E2E_BASE_URL,
    // Il gioco è 1280x720 logici: la finestra ha la stessa forma, così il
    // letterbox non scala niente e i riquadri letti dai test coincidono.
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
