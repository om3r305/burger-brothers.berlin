# Burger Studio V2 — Freestyle Stack

## Customer flow

- Freestyle is the primary flow: no existing burger must be selected.
- Customer chooses exactly one Bun, then one or more proteins, cheeses, toppings and sauces.
- Existing burger templates remain optional inspiration/start points.
- Ingredients float as separated visual layers while editing.
- `Fertig` assembles all chosen layers with a staggered drop/snap animation.
- Cart is disabled until the burger has exactly one Bun, at least one protein, is within the configured ingredient limit, and has been assembled.

## Pricing / security

- Freestyle uses an internal canonical Product with SKU `BSTUDIO-SCRATCH-BASE`.
- This internal Product is filtered from normal public catalog surfaces and Schnellbestellung.
- The Product base price is the Admin-configured Freestyle base price.
- Every selected ingredient is represented by canonical `bstudio:add:<ingredient-id>` extras.
- The existing order pricing pipeline still recalculates the base and extras from the database.
- A server guard revalidates Studio enabled state, order mode, marker, ingredient activity, per-ingredient maximum, total maximum, exactly one Bun and at least one protein.
- Removal/replacement credits remain disabled.

## Admin

- Studio master toggle.
- Freestyle toggle.
- Pickup and delivery toggles.
- Freestyle base price.
- Ingredient names, group, add price, max quantity and active state.
- Bun choices are single-select in the customer flow.
- Existing menu-product templates remain optional and are preserved during V1 → V2 migration.

## V1 migration

- Existing V1 ingredients and templates remain.
- The old `Brioche Bun` becomes `Classic Bun` on first V2 migration.
- `Smash Brioche Bun` and `Glutenfreies Bun` are added if missing.
- `Salat` becomes `Grüner Salat` on first V2 migration.
- V1 had Freestyle forcibly disabled by the Admin save path; V2 enables Freestyle on the first migration so the new flow can be configured/tested.
