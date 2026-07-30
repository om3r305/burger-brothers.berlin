# Burger Brothers - Final Security Closeout Delivery

This delivery addresses the remaining findings from the 18 July 2026 follow-up report while preserving customer checkout, Stripe, split payment, TV, driver, order, print and database flows.

## Included changes

- Correct middleware method access for payment profile, split-payment share and TV logout routes.
- Route-level token/origin/rate-limit protections remain active on those public-entry routes.
- Remove global public driver-list polling and restrict driver enumeration to admin sessions.
- Remove client-side scan PIN authentication and redirect legacy scan links to the signed driver session.
- Remove the fixed localhost TV fallback PIN. TV PIN now comes from the database or `TV_PIN` environment configuration.
- Add optional distributed Redis/Upstash rate limiting with bounded local fallback.
- Remove generic API asset-suffix bypass.
- Add nonce-based production CSP without `unsafe-eval` or script `unsafe-inline`.
- Replace coupon `Math.random()` generation with cryptographic randomness.
- Add middleware access-matrix tests, release secret-policy tests and secure release creation tooling.
- Delete `app/DriversSync.tsx` because global polling is no longer used.

## Validation performed in the sandbox

- `npm run security:test`: passed.
- `npm run typecheck`: passed against the full available project validation tree.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Next.js compilation and framework TypeScript validation reached page-data collection in the available environment. A completely clean `npm run build` could not be certified inside the sandbox because Prisma/Google font external downloads were intermittently unavailable. Both Windows scripts therefore require a clean Prisma generation and production build before installation or GitHub push is considered successful.

## File counts

- Changed existing files: 38
- Added files: 4
- Deleted files: 1
- Patch payload files: 42
