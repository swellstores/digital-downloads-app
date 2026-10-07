# Developing Digital Downloads

## Layout

| Path | What's there |
|---|---|
| `models/` | `products.json` and `orders.json` extend the standard models under `$app.digital_downloads`. `grants` (one buyer's access to one order item), `license-keys`, `download-events` (the download log) and `notify-jobs` (queued update emails) are the app's own collections. |
| `content/` | The product and order **Digital delivery** tabs, their actions, and the list pages. |
| `settings/` | Delivery defaults, license key warning level, and file storage. |
| `notifications/` | Downloads ready (orders), Download updated (grants) and License keys running low (products, admins). Each is sent only by the app with `$notify`; `conditions: {id: null}` stops automatic sends. |
| `functions/` | Event handlers, the public downloads page and license API, admin actions and the update-email sweep. Shared code is in `functions/lib/`. |
| `frontend/` | The uploader: a Hono worker shown in the dashboard. The browser uploads straight to the merchant's bucket with presigned multipart URLs. |
| `test/` | Vitest unit tests, run in workerd against an in-memory fake of the Swell API (`test/helpers/fake-swell.ts`). |
| `docs/app-guide.md` | Draft of the developers.swell.is app guide. |
| `design/listing/` | Sources for the App Store icon, cover and gallery images. `sh design/listing/render.sh` rebuilds them into `assets/` with headless Chrome. |

## Running and deploying

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
swell app push
```

- `--legacy-peer-deps` works around an npm resolver bug with Vitest's optional peer dependencies.
- `overrides` in package.json moves sharp and undici, which miniflare pins, to versions with security fixes. Remove them once miniflare depends on those versions.
- Deploying the uploader needs `wrangler login` and `CLOUDFLARE_ACCOUNT_ID`.
- Deploy the uploader with a full `swell app push`, adding `--force` if only frontend files changed. The dashboard routes to the deployment the CLI records, so `wrangler deploy` on its own, or `swell app push frontend`, leaves it serving the old version.
- After changing only files in `functions/lib/`, push with `swell app push functions --force`. The CLI only notices changes to top-level function files.
- The CLI's local JSON schema validation predates JSON Schema 2020-12. Validate manifests against `schema-api-server/app-schemas/schema` instead.

## Platform behavior the code depends on

- **Email links can't send an API key.** Without one, the storefront gateway finds a function only by the installed app's ObjectId, not its slug, so links use `/functions/<app ObjectId>/downloads`. The id comes from `GET /settings/digital_downloads`. Requests without a key reach only the live environment; to open a test-environment link, send `Swell-Env: test`.
- **Functions can't return file bytes.** Responses are decoded as UTF-8 and cut at 75 KB, so every download is a 303 redirect: to a presigned bucket URL valid for 5 minutes, or to the link.
- **Route caching.** Public GET routes are cached for 5 seconds by default; the downloads and account routes set `cache.timeout: 0`.
- **Query strings.** Function GET queries are sent as query strings, so `null` becomes the string `"null"` and matches nothing. Match missing fields with `$exists: false`, and leave optional ids out of writes instead of setting them to null. The test fake rejects null in queries.
- **`$inc` is the only safe claim.** `unique` is checked before insert, not enforced by an index. Pool keys are claimed by applying `$inc` to `claims`; only the caller that gets back 1 owns the key.
- **Order writes are expensive.** Each one runs the order's formulas and every installed app's `order.updated` handlers. A notification only goes out with a write that changes the record, so the downloads email is sent in the same write that stores the link, and update emails are sent from grants rather than orders.
- **Functions time out after 10 seconds**, and a Worker opens at most 6 connections at once. The order handler loads in parallel and grants items and keys side by side; the update-email sweep stops starting sends after 5 seconds and saves its place.
- **The uploader checks `Swell-Context`.** The dashboard proxy signs it as an ES256 JWT from `https://swell.store` (keys at `/.well-known/jwks.json`), and its `admin` claim is set only for a signed-in admin. The `_swell_admin_session` cookie that older docs describe can't be checked with an app's token, and the proxy marks it as temporary.
- **Installed apps start with empty settings.** Defaults in `settings/*.json` only show in the form, so the code applies them when a value is unset.

## Known platform issue

`before:`/`after:` hooks, including the key pool check in `license-guard.ts`, can stop running on some API processes after a deploy. In schema-api-server, hook functions are cached per process with no expiry, and a function change clears the cache only in the process that handled it (`server/model.js`, the `admin.functions` case, which sends no `Peers` update). Orders that slip past the check still get access, and admins are emailed about the missing keys.

## Dashboard quirks

- The Items and License keys tables on the order tab don't refresh after an action. Reload the page.
- Collection item dialogs ignore `readonly`, so deliverables don't expose their Type at all. The uploader sets it, and new deliverables default to links. A model rule refuses link deliverables without an `https://` URL.

## Verified on swell-apps (test environment), 2026-10-06

- A paid or free order gets its access, generated or pool keys and private link, and the email goes out in the same order write.
- The downloads page loads through the gateway without an API key. Button posts come back as 303 redirects; downloads are counted with `$inc`, logged with the client IP, and stopped at the limit.
- Canceling or fully refunding an order revokes access and keys.
- The license API validates, activates up to the limit, deactivates and refuses unknown keys.
- The key pool check stops orders a pool can't cover, and an order for the last key claims it.
- Every product and order action runs from the dashboard, and the menus show only the actions that apply.
- Update emails reach each order with active access once, skipping revoked, unpaid and other products' orders.
- The uploader opens from the product's Actions menu, and its API rejects requests without a signed-in admin.

Not yet checked live: an upload into a real bucket, subscription pause and resume, and the account route with a signed-in customer.
