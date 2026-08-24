# Burger Studio v1

Burger Studio is a separate customer menu path at `/burger-studio` and is disabled by default until enabled from `/admin/burger-studio`.

## Pricing rules

- Template mode starts from the currently linked menu product price.
- Added ingredient quantities use the configured `addPrice`.
- Removed template ingredient quantities use the configured `removeCredit`.
- Freestyle mode starts from `scratchBasePrice` and adds selected ingredient prices.
- The browser quote is informational; the order server recalculates the recipe from current settings and current linked menu-product pricing.
- Normal removals such as salad/onion can keep `removeCredit = 0` so removing them does not reduce the selling price.

## Operations

Custom burgers are emitted as `EIGENE KREATION` order items with a structured final ingredient list so the existing TV and print flows can display the kitchen instructions without creating a parallel order pipeline.

## Performance

The layered burger visual is CSS/DOM based and intentionally avoids WebGL or per-tap API calls. Builder configuration/catalog are loaded once; selection and visual updates are local.
