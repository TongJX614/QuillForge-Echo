# Architecture

## Modules

- Echo owns the pixel RPG, scenes, dialogue, saves, system menu and in-game web container.
- An external narrative engine owns worldbook generation, review, sessions, GALGAME pages and generated mini-games. It is not part of this repository.
- `shared/contracts` owns the only cross-application environment and iframe message interfaces.

## Seam and adapters

Echo never imports engine modules; it opens the configured local URL in an iframe and consumes the shared message vocabulary. The engine never reads Echo game state; its browser adapter announces readiness, requests the Echo pause menu on Escape, and receives pause/resume notifications.

Echo stays runnable without an engine. `NARRATIVE_ENGINE_HOST` and `NARRATIVE_ENGINE_PORT` are optional: when the fusion launcher starts both sides it injects them, and when they are absent the generative entry points degrade to unavailable while handcrafted content keeps working.

## Experience sequence

`Echo VR researcher → iframe → engine worldbook review → GALGAME`
