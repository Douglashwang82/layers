# ADR: Layer Suggestions send bounded layer content to an LLM

Status: **Accepted by the product owner (2026-11-04)** for local development behind `FEATURE_LAYER_SUGGESTIONS` (default off). Production use needs its own authorization: migrations through 0039, `ANTHROPIC_API_KEY` and `LAYER_SUGGESTIONS_LLM_MODEL` on the web runtime, one authorized live call with the exact adapter parameters (see Rollout), and turning the flag on.

## Context

The map panel gains a Suggestions section: a button sends a summary of the viewer's selected layers and folders to an LLM and shows up to three short tips. Two standing rules block this without a decision:

- `docs/reference/future-roadmap.md` bars AI and ML recommendations without a new product decision.
- `AGENTS.md` bars sending private user data to an LLM service.

## Decision

The owner approves a bounded exception. Generation is by LLM (`LAYER_SUGGESTIONS_LLM_MODEL`, set to `claude-haiku-5-5`; no code default), for selected layers and folders only, started by a button, with results cached per user.

**May be sent to Anthropic, including from private and group layers:**

- layer titles (locale-preferred, cut to 80 characters);
- place names (up to 20 per layer, cut to 80 characters);
- upcoming event titles (up to 5 per layer, cut to 80 characters) with their city-local dates;
- visible place counts, the layer's schedule and ownership kind, the viewer's role (owner, editor, viewer) and the layer's city-local date.

Layer titles, place names and event titles are unreviewed member content. Group members can write them, so they are treated as hostile data (see Controls).

**Everything else stays barred:** descriptions, notes and curator text (`MapItem.note`, `MapItem.excerpt`), reviews, addresses, neighborhoods, coordinates, organizer and author names, member names and emails, slugs, UUIDs, share tokens, item counts from `LayerRecord.itemCount`, demo records, system layers, My saves and archived layers. Google Places content is sent only as a count with no names, because its use is bound by the provider's terms.

## Controls

- One explicit serializer (`buildSuggestionPayload`, `packages/shared/src/layer-suggestions.ts`) builds the payload field by field; records are never passed through. Unit tests prove the barred fields do not serialize and integration tests prove non-members, hidden, expired, revoked and demo content never reach it.
- The system prompt states that every payload value is data and that nothing outside the supplied facts may be claimed. Prompt wording is not the security boundary: `sanitizeLayerSuggestions` is. It accepts only a known layer reference and fact IDs from that same layer, plain text within length limits, no URLs, domains, email addresses, markdown or HTML, and at most three entries. The model has no tools and cannot write a link; the layer action is built on the server from the validated reference.
- Refusals, truncation, invalid output, timeouts and fully dropped output become `502 SUGGESTIONS_FAILED` with fixed text and are not cached. An empty result is cached only when the model itself returned no entries.
- Logging records provider, operation, model and token counts only, never prompt or output text.
- Budget is spent on cache misses only: 10 per user per hour, then 500 site-wide per day. Responses are `Cache-Control: private, no-store`. Cached rows are per user, expire after 24 hours and are swept on write. Deleting a user deletes their rows.
- The server holds the key; nothing reaches `NEXT_PUBLIC_*`. Anonymous users and the flag-off state get no data and no model call.

## Rollout

Stays local with the flag off. Before the flag is turned on anywhere, the owner authorizes one live call with the exact adapter parameters (model, `output_config` JSON schema format, `effort: "low"`, `max_tokens: 4000`) to confirm the model accepts them and to measure cost and latency. No live call was made while building this feature; all tests use a mocked seam.

## Consequences

- `ANTHROPIC_API_KEY` is now needed by the web runtime when the flag is on, not only by the worker.
- Content members write into layers can reach a third party when another member presses the button. The panel discloses this, and the owner should revisit this ADR before widening the data allowlist or the audience.
- This supersedes the "no AI recommendations" line of the roadmap only for this feature.
