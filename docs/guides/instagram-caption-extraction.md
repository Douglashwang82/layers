# Local Instagram caption extraction

This operator-run CLI reads one public Instagram post using Playwright and asks
an installed Ollama model to extract restaurant names and addresses. It outputs
JSON only: it does not call Google, publish content, or write to the database.

## Usage

Use Node 22 and the pinned pnpm version. Install repository dependencies and
Chromium (`pnpm exec playwright install chromium`). Start Ollama locally and use
`ollama list` to choose an installed local model. No models are downloaded by the CLI.

```sh
pnpm instagram:extract "https://www.instagram.com/p/DdQuDFDzcDR/" --model qwen2.5vl:7b
```

The model name above was available on the development machine; choose a model
installed on your own machine. `--headed` shows the temporary browser window.
The context is signed out and does not reuse personal browser cookies. There is
no login automation or CAPTCHA bypass. If Instagram blocks access, supply the
caption yourself in a UTF-8 file:

```sh
pnpm instagram:extract "https://www.instagram.com/p/DdQuDFDzcDR/" --model qwen2.5vl:7b --caption-file caption.txt
```

Output includes `sourceUrl`, `caption`, `captionSource`, `potentiallyTruncated`,
`restaurants: [{ name, address }]`, and `needsReview: true`. Missing fields are
null; no restaurant produces an empty array. A nonzero exit indicates failure.
Keep local output files out of commits if they contain personal content.

## Boundaries and limitations

- Only caption headings or quoted Open Graph descriptions are used; comments and
  the full page are not sent to the model. Metadata may be truncated and is marked
  accordingly. Instagram markup can change and extraction can fail.
- Ollama is contacted only at `127.0.0.1:11434`; configure it for local-only models.
  Names containing `cloud` are rejected, but custom aliases must also be local.
  There is no paid-model fallback. Local inference still uses tokens and hardware;
  it does not consume hosted LLM API tokens.
- Caption input is capped at 12,000 characters, model output at 1,500 tokens and
  64 KiB, and inference at two minutes. Browser lifetime is 45 seconds, with at
  most 100 intercepted requests. The context closes when completed response bodies
  exceed 40 MB total or 8 MB individually. Checks run after transfer and concurrent
  requests may overshoot; these are not hard network transfer limits.
- Only HTTPS Instagram/CDN hosts are permitted; DNS addresses are checked before
  intercepted requests. Redirects are checked on request events, which can occur
  after Chromium has started the redirected request. Browser networking resolves
  DNS independently, so this is not a hardened SSRF-safe or DNS-pinned service.
  Keep this a local operator tool, not a public URL-fetch endpoint.
- Schema validation and exact caption-substring checks reject invented values,
  but do not prove correct restaurant/address pairing or defeat all prompt injection.
  Treat all results as candidates requiring human review. Do not infer missing
  addresses, coordinates, current inventory, or verification status.
- Use only posts you are permitted to process. No screenshots, videos, or images
  are analyzed. Google Place ID matching and saving to layers are separate steps.

References: [Ollama chat API](https://docs.ollama.com/api/chat) and
[Playwright request routing](https://playwright.dev/docs/network).
