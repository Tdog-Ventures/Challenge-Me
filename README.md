# Challenge-Me

Stop the moving image in the target zone.

## Live URL format

```
https://challenge-me-2ddx.vercel.app/?image=duck&zone=80&speed=6&outline=%2300FF88
```

`image` accepts a short name (`duck`, `ironman`, `tradie`, plus the original
`duck1`/`duck2`/`duck3`/`hardhat`/`plumber`/`sparky`/`hulk`/`spiderman`) or a
full `http(s)` image URL.

## Structure

```
app/page.jsx                        game UI (posRef + requestAnimationFrame + translate3d)
app/layout.js                       root layout (no globals.css import)
app/api/cron/facebook/route.js      Vercel Cron -> Facebook Page post
app/api/webhooks/dodo/route.js      Dodo Payments webhook (raw body + signature verify)
lib/entitlements.js                 webhook idempotency + entitlement store
supabase/schema.sql                 optional durable tables
scripts/test-webhook.mjs            signed local webhook smoke test
vercel.json                         framework nextjs + cron schedule
```

## Cron

`vercel.json` runs `/api/cron/facebook` at `30 23,3,8 * * *` UTC, which is
09:30 / 13:30 / 18:30 Australia/Adelaide. It rotates 9 challenges (duck, iron
man, tradie x3) and posts to
`https://graph.facebook.com/{FB_PAGE_ID}/feed` with the message
`Can you stop it in the zone? TAP TO STOP! {url}`.

Useful query params: `?slot=0..8` forces a rotation slot, `?dryRun=1` returns
the post that would be made without calling Facebook.

Required env: `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `NEXT_PUBLIC_BASE_URL`.

## Dodo Payments webhook

`POST /api/webhooks/dodo` — see `.env.example`. Raw body via `req.text()`,
signature verified with `standardwebhooks` against
`DODO_PAYMENTS_WEBHOOK_KEY`, idempotent on the `webhook-id` header, and always
`200 {"received":true}` for verified events so the dashboard stops reporting
failed deliveries. Unknown event types are logged, not rejected.

Local test:

```bash
npm run build && npm start
node scripts/test-webhook.mjs http://127.0.0.1:3000 "$DODO_PAYMENTS_WEBHOOK_KEY"
```

## Env

Copy `.env.example` to `.env.local`. Real values belong in
Vercel Dashboard > Settings > Environment Variables.