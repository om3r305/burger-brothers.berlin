# Brian Notes — Persist & Sync Fix

## What I changed
1. **Admin manual lock:** When products change, we now set:
   - `bb_products_manual = "1"`
   - `bb_products_v1_version = <timestamp>`
   This marks LocalStorage as *manually edited* so no automatic seed/sync can override it.

2. **ProductsSync guard:** The sync worker (`app/ProductsSync.tsx`) now **skips pulling from the server** when `bb_products_manual==="1"`. This prevents the server's older snapshot from overwriting your fresh Admin edits. Visibility-change pulls are also skipped while manual lock is active.

3. **Price input normalization:** Admin price input now converts `,` to `.` before parsing; avoids NaN and silent rollbacks.

## How it works
- Edit prices/names in Admin → LS updates → manual lock flips to `1` → ProductsSync pushes to server but **never pulls stale data over your edits**.
- On next reload you can clear the lock with `localStorage.removeItem("bb_products_manual")` if you need to force a server pull.

## Files touched
- `app/admin/page.tsx`
- `app/ProductsSync.tsx`

