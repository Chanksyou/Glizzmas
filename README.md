# Glizzmas By Made to Order

Play at https://chanksyou.github.io/Glizzmas/.

The game is static HTML, JavaScript and assets. Pushes to `main` publish through GitHub Pages.

Each run lasts up to 100 real seconds, including time spent in a background tab. Crashing ends it earlier. The scrolling speed compounds by 20% every 10 seconds and resets on replay. The leaderboard's plausibility check uses the corresponding distance traveled, capped at 100 seconds.

## Shared scores

`leaderboard.js` shows the Top 10 and lets a player submit a nickname after a run. Each nickname gets one place, using its best score, with case-insensitive matching. Nicknames and submitted scores are public. Players do not need accounts.

The service runs at https://glizzmas-leaderboard.nycjfc.workers.dev and stores scores in Cloudflare D1. `leaderboard-config.js` connects the game to it. The Worker allows browser requests from `https://chanksyou.github.io` and its own origin. If the game moves to another domain, update `ALLOWED_ORIGIN` in `leaderboard/wrangler.jsonc` and redeploy the Worker.

Run these commands from `leaderboard/` with Node.js 22.13 or newer.

```sh
npm ci
npm test
npx wrangler login --scopes account:read user:read workers_scripts:write d1:write
npm run db:remote
npm run deploy
```

The existing database ID is tracked in `wrangler.jsonc`. Preserve it on later deployments to retain scores. Cloudflare login credentials stay in Wrangler's user configuration, outside this repository.

For local API development, run `npm run db:local` and `npm run dev`. Requests that write scores need an `Origin: https://chanksyou.github.io` header.

The API starts a run with `POST /runs`, reads the Top 10 with `GET /scores`, and saves `{runId, name, score}` with `POST /scores`. A repeated identical submission is safe. Conflicting submissions for the same run are rejected. Unsubmitted runs expire after four hours and are cleaned up when new runs begin.

This is a casual leaderboard. The Worker checks score bounds and elapsed server time, while gameplay runs in the browser. It does not replay a run to verify each delivery.
