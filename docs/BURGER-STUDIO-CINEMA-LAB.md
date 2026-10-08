# Burger Studio Cinema Lab

An isolated customer-accessible design test at `/burger-studio/cinema-lab`. Existing menu, `/burger-studio`, earlier `/burger-studio/cinema`, prices and order APIs are unchanged.

## Experience

- German, landscape recommended, portrait supported; no forced orientation APIs.
- Gesture-started original spatial sound design plus an optional CC0 fireplace recording; silent entry, mute, skip and replay. The recording is genuine fireplace crackle, not a grill recording.
- 8.5-second composed 2.5D image sequence with macro crop, slow pullback, subtle atmosphere and a persistent final hero. The artwork was generated for look development and converted to a 168 KB WebP.
- Real touch/mouse/keyboard-controlled 360-degree GLB view (optimized to 1.84 MB), lazy-loaded on request with local PMREM studio lighting and no remote HDR or decoder requirement.
- Licensed usp05/Sketchfab CC BY 4.0 model with visible credits. This is a fixed inspirational burger model; it does not reflect customer ingredient selections.
- Existing `BurgerStudioV2` mounts only when the customer chooses to create their burger. Existing configuration, catalog, pricing and cart code is reused unchanged.

This test does not include a finished CGI food film, actual flowing-cheddar simulation, modular 3D ingredient assets or recorded professional voiceover. The 2.5D opening and the GLB view use different illustrative burgers. Matching bespoke food assets are required before presenting this as the final branded configurator.

## Reliability and access

- Reduced-motion preference goes directly to the final still and disables model auto-rotation.
- Audio closes when leaving the experience, entering the builder, switching tabs or unmounting.
- Modal focus/Escape behavior uses a native dialog; touch orbit and explicit camera buttons are available.
- Image, model-load and WebGL failures retain a visible fallback and a working route into the builder.
- No external speech synthesis, automatic sound, checkout submission, credentials, database migration or new package dependency.

## Verification

TypeScript and existing pricing parity checks passed. The browser harness renders the real Lab, audio module and GLB viewer while stubbing only the already-existing builder boundary. It checks silent/gesture sound entry, skip and natural completion, reduced motion, portrait/landscape layout, actual model loading/rotation, modal closing and audio disposal. Visual screenshots were inspected. The public deployment must additionally be checked with the real builder/settings/catalog APIs before sharing.

Real iPhone/Android listening, touch and performance remain user acceptance checks; desktop device emulation does not prove native-device performance.
