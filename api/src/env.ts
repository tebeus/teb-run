/** I binding del Worker (wrangler.toml). */
export interface Env {
  DB: D1Database;
  POST_LIMIT: RateLimit;
  GET_LIMIT: RateLimit;
  /** Origini ammesse per POST /score e GET /top, separate da virgole. */
  ALLOWED_ORIGINS: string;
  /** Team di Cloudflare Access (`<team>.cloudflareaccess.com`). */
  ACCESS_TEAM: string;
  /** Tag AUD dell'applicazione Access di /admin (segreto). */
  ACCESS_AUD?: string;
}
