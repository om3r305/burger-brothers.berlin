# Burger Brothers Final Security and Release Closeout

This delivery addresses the remaining findings from the `burger6.zip` review while preserving the customer ordering, checkout, split payment, TV, driver, admin, Stripe, tracking and printing architecture.

## Application changes

- Replaced the legacy `/driver/[orderId]` client-password/cache page with a redirect to the signed `/driver` session flow.
- Ensured order status persistence failures are thrown to awaiting callers, while fire-and-forget legacy helpers handle their own rejection.
- Moved automatic coupon definition and issued-code generation to the authenticated server route using Node cryptographic randomness.
- Removed the hard-coded TV debug fallback PIN.
- Added rate limiting to payment-session result lookup.
- Changed unknown API route handling to fail closed and explicitly allowed the payment-session GET route.
- Rebuilt the maintenance overlay with DOM APIs and `textContent` instead of `innerHTML`.
- Set the environment template to fail closed when a configured persistent rate-limit service becomes unavailable.

## Release-chain changes

- Corrected `.gitignore` from broad `data/` to root-only `/data/` and explicitly preserved required `public/data` files.
- Rebuilt the secure release tool with a root-aware deny policy.
- Added `types/`, `global.d.ts`, `vercel.json`, public runtime data and Prisma schema to the release allowlist and required-file assertions.
- The staged release itself must pass dependency installation, Prisma generation, typecheck, security tests, audit and production build before ZIP creation.
- Generated `.next`, `node_modules` and TypeScript build cache are removed before the final secret scan and archive.
- Release tests now verify runtime completeness in addition to secret hygiene.

## File deletion

- `app/DriversSync.tsx` is removed if it still exists.

## Validation performed in the delivery environment

- Modified TypeScript/TSX files passed TypeScript parser/transpile syntax checks.
- Modified JavaScript/CJS/MJS test files passed `node --check`.
- Secure release policy tests passed.
- Release directory completeness and secret scan passed on the prepared source set.

The uploaded source package is a targeted subset rather than the complete repository, so a full application build was not claimed in this environment. Both included PowerShell scripts require the complete local project to pass `npm ci`, Prisma generation, typecheck, security tests, high/critical audit and production build before installation or GitHub push is considered successful.
