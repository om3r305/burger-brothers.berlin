# Schnellbestellung V1.3 – TV Sound Typecheck Fix

## Fixed

- Added the required `dine_in` entry to `TV_SOUND_SOURCES`.
- Added the required `dine_in` source-index state in `useTvSound`.
- Corrected `getTvSoundKind()` so in-store orders are not misclassified as delivery orders.
- Added `Vor Ort` as the TV sound title for in-store orders.
- Included in-store orders in new-order sound dispatch.
- Added regression assertions so the missing `dine_in` sound support cannot silently return.

## Current sound behavior

Until a dedicated salon audio file is supplied, in-store orders intentionally reuse the existing pickup sound. The architecture now supports replacing that source later without another hook refactor.
