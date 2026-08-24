# Burger Studio V2 safety invariants

- Normal menu ordering is not replaced by Burger Studio.
- Freestyle canonical base is internal and must not appear in public catalog or Schnell surfaces.
- Client-submitted prices remain non-authoritative.
- Exactly one Studio marker is required for Studio canonical extras.
- Freestyle requires exactly one Bun and at least one protein server-side.
- Per-ingredient and total ingredient limits are revalidated server-side.
- Removed ingredients do not reduce price in V2.
- Existing V1 templates/settings are migrated rather than deleted.
- Studio can still be disabled independently from Admin.
