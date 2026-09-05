# Voxbench

Compare speech recognition models using the same recording, optional vocabulary hints, and a reference transcript. Try it at [voxbench.app](https://voxbench.app).

Record or upload audio, choose models, then compare their raw transcripts, timing, reported cost, and word errors. The browser converts every take to the same mono 16 kHz WAV and checks that each result corresponds to its audio hash. The latest 20 comparisons stay in the tab; export results you want to keep.

## Accounts and vocabulary

You can supply provider API keys or connect an OpenRouter account. Keys and vocabulary are saved in this browser’s local storage, which is not an encrypted vault. Audio and the selected key pass through the server to the provider when you compare.

A direct OpenAI key takes priority over OpenRouter for GPT Transcribe and enables vocabulary hints. GPT and Voxtral through OpenRouter do not receive custom vocabulary; MAI receives a phrase list. The model picker describes each connection’s support. Hints do not guarantee recognition.

The hosted free trial compares GPT, Voxtral and MAI using Voxbench’s OpenRouter balance: three comparisons per browser, microphone recordings up to 30 seconds, ten comparisons per network per UTC day, and 200 globally per UTC day. IPv6 networks are grouped by /64. Cookie removal or multiple networks can bypass individual allowances; the global limit and capped sponsored key bound exposure. Provider failures can still consume a trial and incur charges. The free UI does not offer uploads; a server cannot prove how client-provided WAV bytes were captured. Your own keys use a separate mode with recording/upload clips up to 60 seconds and ordinary request rate limits.

## Development

Use Node.js 22.13 or newer (Node.js 24 is recommended).

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run benchmark
```

Local own-key transcription uses real provider accounts and may incur charges. The free trial stays unavailable without all its secrets, database and verification configuration. Tests use fake provider responses, not live paid APIs. The benchmark reports indicative local timings; production CPU usage must be checked separately.

`lib/models.ts` contains the catalog; `lib/transcription.ts` contains provider adapters. `lib/api-transcription.ts` and `lib/api-demo.ts` contain the request handlers. UI code is in `app/` and `components/lab/`.

Lint intentionally permits ordinary links for full document navigation with fresh CSP nonces, and semantic elements with valid ARIA status roles. The two effect exceptions document synchronization with browser storage and the external verification widget.

## Deploy your own instance

The deployment target is Cloudflare Workers. Use Workers Paid for production: live 60-second synthetic requests measured 31–67 ms CPU after the decoder optimization, above the Free plan’s 10 ms allowance. The application can exceed Free limits even when occasional requests succeed. `wrangler.standalone.json` is the production configuration; `vite.config.ts` supplies local build bindings. There is no Sites deployment step.

1. Log in with `npx wrangler login`. Replace the account ID, Worker name, custom domain and D1 database ID in the configuration with your own values. Update local D1 settings in `vite.config.ts` too. Set `DEMO_ENABLED` to `false` for an instance without a funded trial.
2. Create a D1 database and apply `npx wrangler d1 migrations apply DEMO_DB --remote --config wrangler.standalone.json`. For local trial development, use `--local` instead.
3. To enable a trial, configure a managed Turnstile widget for your hostname. Add its public site key as `TURNSTILE_SITE_KEY`, and use `npx wrangler secret put NAME --config wrangler.standalone.json` for `TURNSTILE_SECRET`, `DEMO_COOKIE_SECRET` (a fresh random secret, independent of billing), and `VOXBENCH_DEMO_KEY` (a dedicated OpenRouter key capped at no more than $100 with no reset). Then set `DEMO_ENABLED` to `true`.
4. Replace or remove the Plausible script in `app/page.tsx`, adjust `lib/security-headers.ts` if its hostname changes, and update the privacy page/contact to describe your deployment.
5. Run the checks, then `npm run deploy`.

`TRANSCRIPTION_PAUSED=true` stops transcription. `DISABLED_PROVIDERS` accepts comma-separated connection IDs. Setting `DEMO_ENABLED=false` stops only sponsored comparisons. Never commit keys or local environment files.

Daily quota records and individual trial claim records become eligible for cleanup after seven days and are deleted during the next successful claim. Visitor totals remain to enforce the non-daily trial allowance. Rotating only the OpenRouter billing key does not reset signed visitor identity.

Cancellation aborts the upstream request when Cloudflare reports a client disconnect, but a provider may still process or bill audio already received. AssemblyAI polling stops after 40 checks. Cloudflare plan limits still apply; this app does not automatically purchase additional capacity.

## Privacy and security

See the hosted [privacy notice](https://voxbench.app/privacy). The app does not persist audio or transcripts on its server. Selected providers have their own retention policies. Error logging redacts credentials and omits request bodies. CSP limits script and connection origins, but allowed scripts still run with page privileges; CSP does not make browser-stored keys immune to compromise.

Report sensitive security issues privately to aliceisjustplaying@gmail.com. Do not include real API keys or private recordings in public issues.

## License

[MIT](LICENSE). Included third-party components retain their own licenses and notices.
