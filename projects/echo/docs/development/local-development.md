# Local development

Requirements: Node.js 24, pnpm 9 or newer.

```powershell
pnpm setup
Copy-Item .env.example .env
pnpm dev
```

Echo listens on `127.0.0.1:5000`. `pnpm dev` validates one absolute `GEWUZAOJING_ENV_FILE` before startup, reports a conflicting PID/command and never terminates an unknown listener.

Set `ECHO_LLM_SOURCE=shared` to reuse `SHARED_LLM_PROVIDER/API_KEY/BASE_URL`. Set it to `dedicated` and provide the complete provider/API-key/base-URL triplet to use a separate connection.

The narrative engine runs outside this repository. Set `NARRATIVE_ENGINE_HOST` and `NARRATIVE_ENGINE_PORT` to point Echo at an already running engine; leave them unset and the in-game generative entries stay disabled.

```powershell
pnpm test
```

Tests use safe temporary configuration and do not call real LLM, image or TTS providers.
