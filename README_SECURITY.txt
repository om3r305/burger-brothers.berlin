# Admin & Panel Security (Middleware + Cookie Auth)

- All routes under /admin, /dashboard, /tv, /print are protected by middleware.
- Public exceptions: /admin/login, /api/admin/login, /api/admin/logout, static assets.
- Login sets a HttpOnly cookie (secure in production).
- To enable HTTPS in dev, use `next dev --experimental-https` (Next 14+) or a local reverse proxy.

## Env
Copy `.env.example` to `.env` and edit:
- ADMIN_USER, ADMIN_PASS
- ADMIN_COOKIE_NAME (optional)

## Notes
- Middleware lives in `middleware.ts` at project root.
- API handlers for login/logout in `app/api/admin/...`.
