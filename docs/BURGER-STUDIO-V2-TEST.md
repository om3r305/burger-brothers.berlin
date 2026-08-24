# Burger Studio V2 live test checklist

1. Admin → Burger Studio.
2. Confirm Freestyle is enabled and Bun/Protein lists exist.
3. Set desired ingredient prices and Freestyle base price.
4. Save once. This creates/updates the internal canonical Freestyle base.
5. Open `/burger-studio?preview=1` or the normal Studio entry once enabled.
6. Choose Classic, Smash Brioche or Glutenfreies Bun.
7. Add Beef/Crispy combinations, cheese, Bacon, Grüner Salat, Zwiebeln and sauces.
8. Confirm layers remain separated while editing.
9. Press `Fertig – alles fallen lassen`; confirm stack assembles and top bun closes last.
10. Change one ingredient; confirm stack returns to build mode.
11. Finish again and add to cart.
12. Confirm cart price equals Freestyle base + selected ingredient prices.
13. Complete a test order and verify TV/print displays `EIGENE KREATION` plus chosen extras/note.
14. Confirm normal Burger menu and Schnellbestellung do not show the internal `BSTUDIO-SCRATCH-BASE` or `bstudio:*` options.
