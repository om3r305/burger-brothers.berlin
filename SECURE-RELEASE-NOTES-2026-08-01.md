# Secure Release Notes — 1 August 2026

This source package preserves the existing ordering, payment, TV, driver, admin and printing flows while closing release-blocking findings.

## Configuration required before production deployment

- Rotate every token/PIN/private key that existed in an older ZIP.
- Set distinct `PAYMENT_FINALIZE_SECRET` and `PAYMENT_SHARE_SECRET`.
- Set distinct `PRINT_AGENT_TOKEN` and `PRINT_PROXY_TOKEN`.
- Keep `.env.local`, print runtime configs, databases and private keys outside Git/ZIP.
- Keep `NEXT_PUBLIC_BASE_URL=https://www.burger-brothers.berlin`.

Generate safe random values with `npm run secrets:generate`; store the output only in Vercel or the local machine's secret configuration.

## Functional behavior retained

- Canonical server-side order pricing and coupon checks
- Stripe normal, saved and split payment flows
- TV acceptance/status workflow and driver assignment
- Manual/agent printing through the same local print proxy
- Existing polling intervals and runtime data paths

No new recurring network request, database query, timer or client bundle dependency was added.
