# TableCat

## Quick Start (Windows)
- Copy `app.config.sample.json` to `app.config.json` and fill in OpenAI API info.
- Create a role card JSON and point `role_card_path` to it.
- Edit `prompts.csv` if you want to tune the base prompts sent to the model.
- Optional: set `bubble_timeout_sec` for bubble auto-hide (default 3s).
- Optional: set `enable_perception_loop=true` to enable placeholder perception scheduler (default off).
- Install dependencies and run:
```bash
npm install
npm run dev
```

## Current Interaction
- Click the settings button to open settings (supports updating `role_card_path` and `bubble_timeout_sec`).
- Switching role card auto-triggers a new first greeting.
- Double-click the pet panel to open interactive chat; press Enter to send.
- `prompts.csv` is re-read on each request path, so prompt edits apply without rebuilding.

## Role Card Samples
See `docs/rolecards/README.md`.
