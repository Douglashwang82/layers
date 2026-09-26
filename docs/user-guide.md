# TaiwanHub user guide and use-case catalog

Reviewed against repository commit `4d8ee68` on September 26, 2026. This guide describes implemented application workflows, including optional features and operator tools. Availability on a particular deployment depends on its configuration and data; this is a source review, not confirmation of a live deployment.

TaiwanHub helps people discover Taiwanese places, events, organizations, product sightings, and community tips. Houston is the supplied starting city. You can browse without an account; participating requires an admitted member account.

## Start here

1. Open the site's home page, `/`, and select your city in the header.
2. Use **繁中 / EN** to switch between Traditional Chinese and English.
3. Open **Layers**, choose a collection such as **Taiwanese food favorites** or **This weekend**, and select **Apply to map**.
4. Select a result or map pin to read its preview, then open its full detail page.
5. Use **List** if a map is unavailable. Sign in when you want to save, RSVP, contribute, or build a layer.

Paths in backticks are addresses relative to your TaiwanHub site. For example, append `/events` to the site's address. Replace placeholders such as `<slug>` with the address obtained by opening a real item.

**Demo content is practice data.** Demo dates, addresses, recommendations, sightings, and photos do not establish that a business, event, or stock report is real. A product sighting is a past observation, not a promise of current inventory. Check the organizer or business before making plans.

## Contents

- [Access and terminology](#access-and-terminology)
- [Discovery and planning: U01–U09](#discovery-and-planning)
- [Membership and account: U10–U14](#membership-and-account)
- [Participation and contributions: U15–U21](#participation-and-contributions)
- [Layers and groups: U22–U29](#layers-and-groups)
- [Optional business discovery and reviews: U30–U32](#optional-business-discovery-and-reviews)
- [Review and administration: U33–U38](#review-and-administration)
- [Operator capabilities without a complete web workflow](#operator-capabilities-without-a-complete-web-workflow)
- [Troubleshooting and practice checklist](#troubleshooting-and-practice-checklist)

## Access and terminology

| Person              | What they can do                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest               | Browse approved public content and public layers, search, use map/list views, copy public links.                                                                                       |
| Admitted member     | Save, recommend, RSVP, follow, report, submit content, create personal layers and groups, nominate prospective members. Some actions depend on feature availability or verified email. |
| Group viewer        | View and apply that group's layers. Membership also provides a group review scope when reviews are enabled.                                                                            |
| Group editor        | Also create and edit that group's layers and curate their contents.                                                                                                                    |
| Group owner         | Also invite/remove members, change member roles, and manage group-layer lifecycle. The last owner cannot leave without another owner.                                                  |
| Content moderator   | Review submissions, moderate content, edit catalog records, and review collected content. This does not automatically grant membership-reviewer privileges.                            |
| Membership reviewer | Approve other members' nominations or ask for more information. This is a separate capability; it does not grant content moderation.                                                   |
| Administrator       | Content moderation plus soft deletion, membership batches/direct invitations/reviewer grants, source-page management, and applicable operational recovery actions.                     |

| Term                    | Meaning                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer                   | A collection of places, events, and/or local posts. System layers select items automatically; personal and group layers are curated.                                            |
| Apply                   | Put a layer into your current map/list selection. Up to five layers can be applied.                                                                                             |
| Follow a layer          | Keep it in the **Following** library tab. Following and applying are separate actions.                                                                                          |
| Save                    | Bookmark an individual item privately. It does not add that item to a shared layer.                                                                                             |
| Add to layer            | Include an item in a collection you can edit. It does not replace your personal save.                                                                                           |
| My saves                | A private map view derived from your saves. It cannot be published or edited like an ordinary layer. Products remain available on the Saved page rather than becoming map pins. |
| Organization            | A catalog listing for a community organization, with follows and associated events. It is separate from a collaborative group.                                                  |
| Group                   | A membership-controlled space for sharing and editing layers. A group invitation does not create a TaiwanHub account.                                                           |
| Recommendation / review | A catalog place's Yes/No recommendation and short note are separate from the optional star/comment reviews scoped to a layer or group.                                          |

Map home, layer writes, products, organizations, submissions, and local posts can be disabled by the site operator. Google business discovery, external-place collection actions, and scoped review writes are implemented but disabled by default. Missing controls may reflect configuration or permissions.

## Discovery and planning

### U01 — Choose language and city

**Who:** Anyone. **Where:** Header on desktop or mobile.

1. Select an available city from the city selector.
2. Select **繁中** or **EN** to change interface language.
3. Read the city shown on the current page before searching or submitting.

**Result:** The interface refreshes in the chosen language/city. Missing Chinese entity translations fall back to English. An explicit city in a page link can take precedence over the remembered city. Only cities configured by the operator are available; the supplied reference data contains Houston.

### U02 — Explore the map and use the list fallback

**Who:** Anyone. **Where:** `/`.

1. Start with the default Discover layer or apply another layer from `/layers`.
2. Select a pin or result row; both lead to the same item's preview.
3. Open the full detail page for more information and actions.
4. Switch to **List** when preferred or when the map cannot load. On mobile, use the visible panel/view controls and bottom navigation.

**Result:** You can discover and open items even without a working map provider. Content without exact coordinates remains in results with a location label; it does not receive an invented pin. One item in multiple layers appears once, with its layer membership indicated.

### U03 — Plan around a date or kind of content

**Who:** Anyone. **Where:** Home map toolbar.

1. Choose **Upcoming**, **Today**, **This weekend**, or the custom date picker.
2. For a custom period, enter a start date and optionally an end date, then apply it.
3. Choose all types, places, events, or local content.

**Result:** Results and counts update for the selected layers and filters. Event date windows use the city's time zone; weekend means Saturday and Sunday. Places are not opening-hours availability results. Local posts may have a validity period.

### U04 — Search within layers or across the city

**Who:** Anyone. **Where:** Home search.

1. Enter an English or Chinese search term.
2. Choose the visible scope: current layers or all of the selected city.
3. Submit the search. Use the exit-search control to return to normal layer browsing.

**Result:** Layer search narrows the collections you applied. City search with a non-empty term can find approved map content outside them. This search covers places, events, and local posts; use U08 for catalog products and organizations.

### U05 — Search a map area and recover from an empty view

**Who:** Anyone with a working map. **Where:** Home map.

1. Move or zoom the map.
2. Select **Search this area** to commit the displayed area as a filter.
3. Use **Fit results** to frame the current results, or clear the area filter to broaden the search.
4. If results remain empty, clear the search/date/type filters and check that at least one layer is applied.

**Result:** Moving the camera alone does not continually change the committed results. Items without coordinates can remain in the list even with an area selected. Large result sets are bounded; narrow the query if the interface reports a limit.

### U06 — Find a place and inspect its details

**Who:** Anyone. **Where:** `/places` or `/explore`, then a place detail page.

1. Search by name or description and optionally select a category.
2. Open **More filters** for neighborhood and popularity/score sorting.
3. Submit the filters and page through results. The catalog map option shows the current page's places.
4. Open a place to inspect its address, available contact/hours information, recommendation summary, notes, and directions link.

**Result:** You have a place detail page you can share, save, recommend, report, or add to a layer. A recommendation percentage reflects community votes; an unrated place has no score. Neither score nor listing approval guarantees present-day business details.

### U07 — Find an event or an organization's events

**Who:** Anyone. **Where:** `/events` and `/organizations`.

1. On Events, choose upcoming/today/weekend/week and optionally filter by search, category, neighborhood, or organizer.
2. Open an event to inspect time, venue, organizer, capacity information, and event status.
3. Alternatively, open an organization to inspect its description, available social/website links, and related events.

**Result:** You can plan from the displayed event information and use U16 to RSVP. Full, cancelled, postponed, and ended events may block new RSVPs. There is no ticket purchase or payment flow.

### U08 — Search the whole catalog

**Who:** Anyone. **Where:** `/search`.

1. Enter a term, including a Chinese name or product alias when known.
2. Review results grouped into places, events, products, and organizations, subject to enabled features.
3. Open a result, or follow the group link to continue with its full filtered catalog.

**Result:** You can find catalog items that are not map item types. This page is distinct from map search and optional Google business search.

### U09 — Find a product and inspect sightings

**Who:** Anyone, if products are enabled. **Where:** `/products`, then a product detail page.

1. Search or filter products and open a product.
2. Review approved sightings, their store, observation date, and any supplied price/photo.
3. Follow the online link when one is supplied, or use **I found this** to report your own observation after signing in.

**Result:** You learn where someone previously reported seeing a product. Sightings are city-scoped historical reports; TaiwanHub does not track live inventory or complete purchases.

## Membership and account

### U10 — Join with a membership invitation

**Who:** A person invited to TaiwanHub. **Where:** The supplied invitation link, or `/join` with its invitation code.

1. Open the invitation link; if entering manually, paste the invitation code into the join form.
2. Check the invitation context and expiry, then accept the displayed community/terms notice and request an email code.
3. Retrieve the six-digit code sent to the invitation's email address and submit it.

**Result:** A successful redemption admits your account and signs you in. Invitations are email-bound and cannot be transferred by forwarding the link. There is no public self-registration. Invalid, revoked, or expired invitations need help from the inviter or administrator; admission also depends on the site's membership mode.

### U11 — Sign in again or sign out

**Who:** Existing admitted members. **Where:** `/sign-in`, or the sign-in prompt from a member action.

1. Use the email-code method with your member email.
2. Enter the newest six-digit code. Codes last five minutes, allow three attempts, and a resend invalidates the older code. Observe the resend countdown.
3. Use password sign-in only if your existing account has a password. Google appears only when configured; it is not a replacement for invitation admission.
4. To sign out, open **Profile** and use **Sign out**.

**Result:** Successful sign-in returns you to the requested destination when supported. A generic code-request success does not prove an email is a member; only admitted members receive returning-member codes. The current UI does not provide public password registration or password recovery.

### U12 — Update your profile

**Who:** Members. **Where:** `/profile`.

1. Edit your name, biography, preferred language, and home city.
2. Save changes and inspect the result message.
3. Use the profile links to reach saves, layers, groups, contributions, and membership.

**Result:** Your allowed profile fields update. This form does not change your email, grant roles, or administer membership.

### U13 — Nominate someone for membership

**Who:** Members with verified email. **Where:** `/membership`.

1. Enter the prospective member's email and an optional short note.
2. Submit the nomination.
3. Track its state under your nominations: pending review, needs information, approved, joined, withdrawn, rejected, or closed.

**Result:** A reviewer can consider the nomination. Nomination alone grants no access; approval requires an available batch seat and enabled issuance. Duplicate or ineligible targets receive a generic error.

### U14 — Respond to or withdraw a nomination

**Who:** The nominating member. **Where:** `/membership`.

1. If a nomination needs information, edit its note and submit the response.
2. Use **Withdraw** on a pending/needs-information nomination if you no longer want it considered.
3. If another action has changed it, refresh before retrying.

**Result:** The nomination workflow advances or closes without creating duplicate nominations. Invitation reissue/revocation exist as authorized API operations; the current member page does not expose a complete invitation-management dashboard.

## Participation and contributions

### U15 — Save, reopen, and remove bookmarks

**Who:** Members. **Where:** Item details and `/saved`.

1. Select **Save** on a place, event, product, or local post; enabled external places also support saves.
2. Open **Saved** to browse your items by type.
3. Use **Show on map** for the private My saves layer, or open an individual item.
4. Select **Unsave** on the item to remove the bookmark.

**Result:** Saves remain private and are independent of RSVPs, follows, and layer contents. The Saved page's create-layer shortcut opens a new layer form; it does **not** automatically copy all bookmarks. Add desired items to the new layer yourself.

### U16 — RSVP to an event and cancel

**Who:** Members. **Where:** Event detail or supported map preview.

1. Check the event's time, venue, status, and available capacity.
2. Select **RSVP** and wait for the updated attendance state.
3. Return and select **Cancel RSVP** when you cannot attend.

**Result:** The server checks availability before accepting attendance. Repeated RSVP clicks do not create multiple seats. A concurrent last-seat request may fail; follow the returned message. RSVP is separate from saving the event and is not a paid ticket.

### U17 — Recommend a catalog place and leave a note

**Who:** Members. **Where:** Catalog place detail.

1. Optionally expand **Add a note** and enter up to 300 characters.
2. Choose **Yes** or **No** in the recommendation section.
3. To change your vote later, select the other answer.

**Result:** You have one vote per place, updated rather than duplicated. A new binary vote counts immediately; accompanying free text waits for moderation. Editing a moderated hidden vote does not bypass that decision. This is separate from U32's scoped star reviews.

### U18 — Follow an organization

**Who:** Members, if organizations are enabled. **Where:** Organization detail.

1. Open an organization and select **Follow**.
2. Return to the page to inspect its events or select **Unfollow**.

**Result:** Your organization preference is stored. The legacy home feed includes followed-organization events; the map home centers on layers. Following does not send an email notification or add you to a collaborative group.

### U19 — Submit a place, event, or product sighting

**Who:** Members, with submissions and the relevant feature enabled.

| Submission       | Entry                                                         | Information to prepare                                                                                                      |
| ---------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Place            | `/submit/place` or the catalog contribution link              | Name, optional Chinese name, description, category, city, neighborhood, street address, latitude, longitude.                |
| Event            | `/submit/event`                                               | Place-style details plus an existing organizer, venue, future start/end time, and optional capacity. End must follow start. |
| Product sighting | Product's **I found this** link or `/submit/product-sighting` | Existing product, approved grocery store, date observed, optional price and image. The date cannot be in the future.        |

1. Enter the facts you know and confirm the selected city/store/organizer.
2. For place/event coordinates, replace the form's default Houston coordinates with the actual location. The form does not geocode the address for you.
3. For event times, check the browser time zone displayed by the form.
4. Optionally provide an image URL or upload a JPEG, PNG, or WebP image up to 5 MB. Wait for upload success before submitting.
5. Submit and keep the pending-review confirmation. On failure, correct the fields and retry; the form retains your input.

**Result:** The contribution awaits moderation before public discovery. These forms do not create a new product or organization. Use U21 to inspect submission status.

### U20 — Share a local tip or announcement

**Who:** Members, with submissions and local content enabled. **Where:** `/submit/content` or the profile's share-tip link.

1. Enter a title and body, optionally a Chinese title, source link, and image URL.
2. Link one existing place or event, or choose an explicit location status: exact, approximate neighborhood, citywide, online, or unspecified.
3. Supply coordinates only for an unlinked exact location. Optionally enter a validity period.
4. Submit, then open the new post from the confirmation.

**Result:** An ordinary member's post is pending; the author can inspect it while public discovery waits for approval. Moderator/admin-authored posts are immediately approved. Linked posts use the linked item's location. Citywide, online, approximate, and unspecified posts do not get fabricated map coordinates. The form accepts an image URL but has no file-upload control of its own.

### U21 — Report a problem and review your contributions

**Who:** Members. **Where:** Detail-page report control; `/profile/contributions`.

1. Open the relevant detail page, select **Report**, and enter a specific reason.
2. Submit the report and wait for confirmation.
3. Open **Profile → Contributions** to inspect recent submission types, dates, and moderation statuses.

**Result:** The report enters moderation; it does not instantly hide the item. The contributions page is a recent status list, not a general editor for submitted records. Review-specific status is also shown in the scoped review editor.

## Layers and groups

### U22 — Find, apply, follow, and remove layers

**Who:** Anyone for public layers; members for personal/group views and following. **Where:** `/layers` and the map's active-layer panel.

1. Explore **Discover**, **Following**, **Mine**, and **Groups**; search by a layer's title/purpose.
2. Open a layer to inspect its audience, schedule, contents, and owner.
3. Choose **Apply to map** to add it to your current selection, or the layer-only/fit action to open it alone.
4. On the map, toggle layers off/on or use **Show only this**. Remove one before exceeding five applied layers.
5. Follow a useful layer to retain it in **Following**; unfollow from its detail page when no longer needed.

**Result:** The map/list displays the union of allowed layer items. A layer for another city or one you cannot access is identified as unavailable for the current view. Following does not itself apply a layer or grant access to private contents.

### U23 — Create a personal layer

**Who:** Members with layer writes enabled. **Where:** `/layers/new`.

1. Enter a title, optionally a Chinese title and purpose/description.
2. Choose an evergreen collection, a single day, or a date range.
3. Keep the private audience for a personal collection and create it.
4. In the editor, add items and use **Done** to finish the draft.

**Result:** An empty draft is saved as soon as creation succeeds. The layer belongs to you and is private until separately submitted and approved for publication.

### U24 — Curate and reorder layer contents

**Who:** The personal owner or a group owner/editor. **Where:** Item's **Add to layer** control or `/layers/<slug>/edit`.

1. From a place/event/post, select an editable layer or create one through the picker when offered.
2. In the layer editor, search for existing content and add matching items.
3. Use up/down controls to change order, remove an item, or undo the latest removal.
4. Save metadata changes; use **Done** to return to the layer.

**Result:** The collection refers to existing records rather than copying them. Adding the same item twice does not duplicate it. Permissions, publication status, city, and external-place city review may prevent additions. If another editor changed the layer, refresh and reconcile instead of repeatedly resubmitting stale changes.

### U25 — Share or publish a personal layer

**Who:** Anyone allowed to view a layer can copy its link; only the personal owner can request publication. **Where:** Layer detail.

1. Select **Copy link** and read the audience message.
2. For a personal collection you want everyone to discover, use the publication action.
3. Wait for moderation; public discovery requires approval and an active layer.
4. Use the make-private action to withdraw public access.

**Result:** Copying a private or group link does not grant access. Publishing a layer is a separate approval from its items; pending/hidden items do not become public just by inclusion. Existing scoped reviews can require moderation when a layer becomes public. Group-layer public publication is not available in this release.

### U26 — Archive, restore, or delete a layer

**Who:** Personal owner or group owner. **Where:** Layer detail owner controls.

1. Use **Archive** when the collection is no longer active.
2. Use **Restore** on an archived collection to reactivate it.
3. To delete, select **Delete layer**, read the confirmation, and confirm only if you intend to remove it.

**Result:** Archiving preserves a collection for later use. Deletion removes the layer and its associated scoped reviews/history; there is no user-facing undo for layer deletion. Neither action deletes the underlying catalog places/events/posts. My saves and system layers do not use these owner controls.

### U27 — Create a group and a shared layer

**Who:** Members with layer writes enabled. **Where:** **Layers → Groups**, then `/groups/new`.

1. Enter the group's name, optional Chinese name, and description; check the city.
2. Create the group; you become its owner.
3. Create a layer from the group page or choose the group audience in the layer form.
4. Add places, events, or posts for members to use together.

**Result:** Group members can discover the collection in their Groups library. Viewers read it; editors and owners curate it. Group identity and collaborative membership are separate from organization listings.

### U28 — Invite someone to a group and accept an invitation

**Who:** Owner sends; invited admitted member accepts. **Where:** Group members panel and `/groups/join/<token>`.

1. As owner, enter the person's account email and choose viewer or editor.
2. Create the invitation and copy the generated link to share yourself. The group UI does not automatically email it.
3. The recipient signs in using the invited email, opens the link, and selects **Accept invitation**.
4. If the person has no TaiwanHub membership, nominate them through `/membership` first; complete membership admission separately.

**Result:** The accepted account receives the invited group role. Wrong-email, expired, and revoked links cannot grant access. A shared layer URL alone cannot substitute for this invitation.

### U29 — Manage roles, revoke invitations, remove members, or leave

**Who:** Group owners manage others; any member may leave, subject to last-owner protection. **Where:** Group members panel.

1. An owner changes another member's role using the role selector.
2. Revoke a pending invitation or remove a member when access is no longer appropriate.
3. Use **Leave group** for your own membership. If you are the last owner, promote another member to owner first.

**Result:** Group-layer access follows current membership. Removing a member does not revoke their TaiwanHub membership, and revoking a pending link does not replace removal of an already joined member.

## Optional business discovery and reviews

These workflows require operator-enabled features. Google-supplied information and TaiwanHub community contributions are displayed separately.

### U30 — Find a business through Google discovery

**Who:** Anyone while discovery is enabled. **Where:** Home's business-search panel.

1. Open business search and use the provider's autocomplete, or enter and explicitly submit a category/text search.
2. Select a result to inspect provider details and any transient map pin.
3. If provider loading fails, retry or continue with TaiwanHub's own catalog/list.

**Result:** You can inspect provider information with its attribution. Panning does not automatically submit another business search. Browsing alone does not create a permanent TaiwanHub business listing or establish city approval.

### U31 — Save an external business and add it to a collection

**Who:** Members, with external-place collection writes enabled. **Where:** Selected business panel.

1. Select **Save** in the TaiwanHub community section.
2. Choose **Add to layer** and an editable collection when available.
3. If the site says city review is needed, keep the save and wait for operator curation before trying to add it again.
4. Reopen the entry from **Saved**, a layer, or its `/place-subjects/<id>` page. Existing saves can be removed even when new collection writes are disabled.

**Result:** TaiwanHub retains a provider reference and your contribution. Provider details are resolved when available; unresolved external entries are not assigned guessed pins.

### U32 — Write, edit, delete, or read scoped place reviews

**Who:** Members with access to the chosen scope; new writes require reviews enabled. **Where:** Business/place-subject community panel.

1. Choose a group or layer in the review scope selector. A layer review requires the place to be in that layer; group reviews require membership.
2. Select optional 1–5 stars and/or write a comment. At least stars or non-empty text is required.
3. Publish on TaiwanHub and inspect the review status.
4. Reopen the same scope to edit your review or delete it. Expand a scope's review list to read its approved reviews and aggregate.

**Result:** You have one review per place per scope. Public-layer reviews wait for moderation; private/group reviews normally appear immediately within their permitted audience. Moderation restrictions persist through edits. Each scope has its own aggregate; these are not Google ratings or a single global TaiwanHub rating. Reload on a revision conflict. A moderator-deleted review cannot be restored by its author.

## Review and administration

### U33 — Review community submissions and reports

**Who:** Content moderators and administrators. **Where:** `/admin`.

1. Read the pending item's preview, details, and report reason when supplied.
2. Check the underlying facts and choose approve, reject, or hide, with the appropriate reason.
3. Administrators can also soft-delete supported moderated content.
4. For a scoped review, act on the displayed revision; refresh if it changed.

**Result:** Visibility and submission status change with an audit record. Approval makes eligible content discoverable; hidden/rejected/deleted content is excluded from public queries. Content soft deletion is distinct from the layer owner's delete action in U26.

### U34 — Edit catalog records

**Who:** Content moderators and administrators. **Where:** `/admin/places`, `/admin/events`, `/admin/products`, `/admin/organizations`.

1. Open the relevant catalog tab and expand the item's edit form.
2. Correct the available common and type-specific fields, then save.
3. Apply a moderation decision separately when necessary.

**Result:** Corrections are audited. Coordinate changes update location data together; event capacity cannot be lowered below current attendance. These are editing/moderation screens, not general member-facing create-product or claim-business forms.

### U35 — Review collected content and recent revisions

**Who:** Moderators/admins review candidates; admins can revert supported revisions. **Where:** `/admin/ingestion`.

1. Follow source evidence and compare the current and proposed fields.
2. Inspect validation issues. Resolve bad upstream data before attempting approval of an invalid candidate.
3. Approve or reject the candidate using the controls.
4. Inspect recent changes; an admin may use a displayed revert action for an eligible prior update.

**Result:** Approved candidates become catalog content or controlled updates. Reverts can be rejected when the record has changed since; they are not unconditional undo. Extraction and collection are separate processes; this screen does not run a model on demand.

### U36 — Manage extraction source pages

**Who:** Administrators. **Where:** `/admin/extraction`.

1. Prepare the source URL, feed slug, supported kind (place or organization), label, permission note, and optional neighborhood fallback.
2. Add the page only when collecting and displaying its facts is permitted.
3. New pages start paused. Enable an approved page for subsequent extraction runs, pause it, or remove it using its controls.
4. Inspect the last-run time/status to identify failures.

**Result:** You change which pages the configured extraction worker can process. Enabling a page does not immediately publish a catalog item or automatically configure every downstream feed/source. The engineering guide covers the separate ingestion stage.

### U37 — Review membership nominations

**Who:** Granted membership reviewers or administrators. **Where:** `/membership/review`.

1. Inspect the nomination and its nominator's note.
2. Approve or request more information. Only administrators have the reject action.
3. If a revision conflict occurs, reload the latest nomination before deciding.

**Result:** Approval issues an invitation against an open batch when capacity and issuance policy allow it; the invitee still has to redeem it. Self-approval is forbidden. Being a content moderator alone does not confer this reviewer capability.

### U38 — Administer membership and invitation email

**Who:** Administrators. **Where:** `/admin/membership`.

1. Inspect batches and seat usage; open a batch with a name/capacity or close the current batch. Only one batch can be open.
2. Grant or revoke reviewer capability using an existing member's email.
3. Send a direct invitation using manual-link or email delivery against the available batch. Copy a manual link when revealed; it cannot be read back later.
4. Inspect invitation email by status: queued, provider accepted, failed, or superseded.
5. Use retry only for a job where the UI offers it. If reconciliation is required, the operator must check the provider outcome before recovery/reissue.

**Result:** Membership issuance and delivery are traceable. Queued mail needs the configured worker; provider accepted is not proof of inbox delivery. Closing issuance does not sign existing members out. A site-wide admission closure and an issuance pause are deployment settings, not these batch controls.

## Operator capabilities without a complete web workflow

These implemented actions require the documented API/CLI and appropriate privileges. They are included for completeness, not as instructions to find nonexistent buttons.

| Capability                                                           | Current entry point                                         | Boundary                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Revoke/reissue a membership invitation                               | `/api/v1/membership/invitations/<id>/revoke` and `/reissue` | Authorized nominator/admin; reissue invalidates older token/join context.           |
| Additional membership batch changes / invitation listing             | Membership admin API                                        | Admin only; the current web panel exposes a subset.                                 |
| Curate external-place city, status, catalog link, provider reference | `/api/v1/admin/place-subjects`                              | Moderator/admin API; no dedicated operator page currently implements this workflow. |
| Configure JSON ingestion sources and policies                        | `pnpm ingest`                                               | Operator CLI, separate from source-page extraction controls.                        |
| Bootstrap first member, grant admin, reconcile legacy admissions     | Membership/admin CLIs                                       | Environment-specific operator procedures, not public registration.                  |
| Run extraction, collection, or invitation mail dispatch              | Worker CLIs / configured workflows                          | Can incur provider calls, send email, and write data.                               |

For exact contracts and setup, use the [engineering onboarding guide](engineering-onboarding.md), [API reference](api.md), and [deployment guide](deployment.md).

## Troubleshooting and practice checklist

| What you see                     | What to do                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty results                    | Check city, applied layers, search scope, date/type filters, and selected map area. Try a catalog page.                                                                               |
| Map unavailable                  | Continue in List; results/details remain usable. An operator may need to configure the map token.                                                                                     |
| Shared layer unavailable         | Sign in with an authorized account; check group membership and city. A link does not grant access.                                                                                    |
| No email code                    | Check the invited/member email, spam folder, newest code, and cooldown. Ask the operator to check delivery configuration; a local test mail transport does not deliver to your inbox. |
| No sign-up or invalid invitation | Request a membership invitation or assistance from its issuer. A group link alone cannot create an account.                                                                           |
| Item still pending               | Wait for the relevant moderation decision. Check Contributions or the review editor; do not repeatedly submit duplicates.                                                             |
| Full event                       | Choose another event or retry only if capacity becomes available. No waitlist is implemented.                                                                                         |
| Save exists but no layer item    | Save and Add to layer are separate. External places may also need city review.                                                                                                        |
| Changed-since-loaded error       | Preserve any draft text, refresh, and reconcile the latest layer/review/nomination state.                                                                                             |
| No expected control              | Check your role, group membership, feature availability, and whether this guide labels the action API/CLI-only.                                                                       |
| Clipboard copy fails             | Copy the current address manually for ordinary public content. Keep invitation links private and use the generated link exactly.                                                      |

For a short hands-on review in a development environment:

- [ ] Browse a place in English and Traditional Chinese, then open it using List.
- [ ] Apply two layers, select an item, and change the date/search scope.
- [ ] Join with a test invitation, save an item, sign out/in, and reopen the save.
- [ ] RSVP and cancel; submit one contribution and inspect its pending status.
- [ ] Create a private layer, add/reorder/remove items, and copy its access-controlled link.
- [ ] With a second test member, exercise a group invitation and viewer/editor permissions.
- [ ] With the appropriate operator account, approve the test contribution and inspect its public visibility.
- [ ] If optional business features are enabled, save a business and write a scoped test review.

There is no implemented business-claim workflow, checkout, live stock tracking, member chat, native mobile app, or general notification center. Invitation/sign-in email delivery is implemented separately from those future product features.

### Implementation evidence

The route and action inventory was checked against [application pages](../apps/web/src/app), [navigation](../apps/web/src/components/navigation.tsx), [catalog actions](../apps/web/src/components/actions.tsx), [map components](../apps/web/src/components/map), [layer components](../apps/web/src/components/layers), [group controls](../apps/web/src/components/groups/group-management.tsx), [membership components](../apps/web/src/components/membership), [place components](../apps/web/src/components/places), [feature services](../apps/web/src/features), and [feature flags](../apps/web/src/lib/config.ts). [Browser-test scenarios](../tests/e2e) provide executable examples; this documentation review did not rerun them.
