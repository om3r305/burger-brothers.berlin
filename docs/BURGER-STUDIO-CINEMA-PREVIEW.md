# Burger Studio Cinema preview

Preview route: `/burger-studio/cinema`.

A separate entry experience asks mobile visitors to turn their phone sideways, then plays a 6.6-second flame and ingredient sequence after an explicit start gesture. A synthesized bass/fire sound and optional German browser speech accompany the intro. Visitors may start silently, remain in portrait, or skip directly to the existing Studio. The existing ordering component is loaded only on entry.

This is the first functional entry prototype. It reuses existing photographic ingredient layers and the existing flame video; it is not a new photorealistic 3D engine. Browser speech quality and voice availability vary. A professionally recorded voice and custom mastered audio can replace the prototype sound later. Full 3D modeling, cheese deformation and the final burger cinematics remain a separate production phase.

Main and the standard `/burger-studio` entry are unchanged. Code recovery point: `backup/burger-studio-before-cinema-20261008`, commit `42b7b24395b2bc18e0c2c5f811eded40d317c342`. This backup is repository code/assets, not a Supabase database or local uncommitted files backup.

Controls and lifecycle:
- Orientation is a recommendation, with an explicit portrait alternative.
- Audio only begins inside a user click; no audio/video on the gate.
- Intro sound stops on skip, completion, unmount or document hiding.
- Reduced motion enters Studio immediately without the film.
- Failed video retains a warm gradient, embers and product imagery.
- No recipe, pricing or checkout code is changed.

Validation recorded in the PR. Phone device playback and production voice quality still require a real-device review.
