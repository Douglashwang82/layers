# Local Instagram caption extraction

This operator-run CLI reads one public Instagram post using Playwright and asks
an installed Ollama model to extract restaurant names and addresses. It outputs
JSON only: it does not call Google, publish content, or write to the database.
The layer editor now also accepts an Instagram link through the worker below.

## Layer editor setup

1. On the worker machine, install repository dependencies, Chromium and Ollama.
   Set `INSTAGRAM_OLLAMA_MODEL` to an installed local model and
   `INSTAGRAM_WORKER_TOKEN` to a random secret of at least 32 characters.
2. Start `pnpm instagram:worker` from the repository root. It reads `.env` and
   listens only on `127.0.0.1:11435`. It needs no database or Google API key.
3. On the web server set the same `INSTAGRAM_WORKER_TOKEN` and set
   `INSTAGRAM_WORKER_URL=http://127.0.0.1:11435` when both run on the same host.
   The existing `FEATURE_LAYER_WRITES`, Google link resolver
   key and Places preview configuration still apply. Restart the web server.
4. In the layer editor's **Google Maps or Instagram links** field, paste one
   Instagram `/p/` or `/reel/` link, then choose **Check links**. Inspect the
   extracted restaurant/address and Google preview or Maps link. Check the
   confirmation box for each desired restaurant and choose **Add**.

The web server sends only the canonical post URL to the authenticated worker.
The worker reads the caption and uses Ollama, returning candidates (not the full
caption). The web server makes at most five Google IDs-only Text Search requests
using names and addresses. Missing names/addresses are not guessed. Each user can
check five Instagram posts per ten minutes; the worker handles one request at a
time, responding busy rather than accumulating a queue. Mixed Google/Instagram
batches keep Google results but ask the user to check Instagram separately.

Confirmed imports reuse the existing transactional, authorized layer import.
The source URL is stored in the new item's `note`; an existing item's note is not
overwritten on duplicate import. This preserves one initial source, not a history
of every post about the place. Source names remain scoped to the layer. No new
database migration is required. Public publication rules remain unchanged.

For Vercel or another remote web host, its loopback address does **not** reach
your computer. Run the worker on a reachable machine and put an authenticated
HTTPS reverse proxy in front of its loopback listener; configure the HTTPS origin
as `INSTAGRAM_WORKER_URL`. Do not expose Ollama itself. This repository does not
create a tunnel, publish the worker, or change production configuration. Missing
configuration fails visibly and Google Maps imports continue to work. The web
route requests a 240-second platform budget; the host and reverse proxy must
support that timeout. Google search may incur provider fees; inference is local.

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
  64 KiB, and inference at two minutes. Browser launch is limited to ten seconds,
  browsing to 45 seconds, requests and CONNECT tunnels to 100. The temporary
  proxy closes all tunnels after 40 MB of encrypted transfer (with at most the
  final network chunk overshooting). Images, video, fonts and WebSockets are blocked.
- All Chromium HTTPS connections go through a temporary loopback CONNECT proxy
  that allowlists Instagram/CDN hosts, rejects non-public IPv4 DNS answers, and
  connects directly to the checked IP. Redirects cannot create a tunnel to another
  host without the same checks. TLS certificates remain checked by Chromium.
  IPv6 destinations are deliberately unsupported. Run the worker with ordinary
  unprivileged OS permissions and keep Chromium updated.
- Schema validation and exact caption-substring checks reject invented values,
  but do not prove correct restaurant/address pairing or defeat all prompt injection.
  Treat all results as candidates requiring human review. Do not infer missing
  addresses, coordinates, current inventory, or verification status.
- Use only posts you are permitted to process. No screenshots, videos, or images
  are analyzed. Google Place ID matching and saving to layers are separate steps.

References: [Ollama chat API](https://docs.ollama.com/api/chat) and
[Playwright request routing](https://playwright.dev/docs/network).
