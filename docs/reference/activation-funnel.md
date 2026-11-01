# Activation funnel

The invite-only map MVP measures one question: does an invited person become
a contributor whose group has a second contributor within a week? Every step
is derived from tables and server analytics events that already exist; no
client-side or personal-data tracking is involved.

## Stages

| #   | Stage                                 | Source                                                                                                                   |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Invited                               | `membership_invitation.created_at` (via `membership_nomination`)                                                         |
| 2   | Admitted                              | `membership_admission.admitted_at`; analytics `membership_joined`                                                        |
| 3   | First layer                           | analytics `layer_created` `{ owner, audience }` (also `layer.created_at`)                                                |
| 4   | First group share or invite           | analytics `group_created`, `group_invite_sent` `{ membership, role }`, `group_joined`, `shared_layer_viewed` `{ owner }` |
| 5   | Second distinct contributor in 7 days | analytics `layer_item_added` `{ owner, role }` by two distinct users on one group layer                                  |

Properties are coarse by design: no emails, tokens or layer slugs.
`layer_created` and `layer_item_added` also carry the existing `layerId`
(needed to group contributors; an internal uuid). `layer_item_added.role` is
the actor's role on the layer (`owner`, `editor` or `user`).
`group_invite_sent` and `shared_layer_viewed` are emitted by the group-invite
and read-only link features; until those ship their rows are simply absent.

## Queries

All queries read `analytics_event(user_id, name, properties, created_at)` and
the tables above. Replace the window as needed.

### Per-stage counts (people)

```sql
WITH invited AS (
  SELECT DISTINCT u.id AS user_id
  FROM membership_admission a
  JOIN "user" u ON u.id = a.user_id
  WHERE a.source = 'invitation'
),
first_layer AS (
  SELECT user_id, min(created_at) AS at
  FROM analytics_event
  WHERE name = 'layer_created' AND user_id IS NOT NULL
  GROUP BY user_id
),
first_share AS (
  SELECT user_id, min(created_at) AS at
  FROM analytics_event
  WHERE name IN ('group_created', 'group_invite_sent') AND user_id IS NOT NULL
  GROUP BY user_id
)
SELECT
  (SELECT count(*) FROM membership_invitation)                              AS invited,
  (SELECT count(*) FROM membership_admission WHERE source = 'invitation')   AS admitted,
  (SELECT count(*) FROM invited i JOIN first_layer f USING (user_id))       AS first_layer,
  (SELECT count(*) FROM invited i JOIN first_layer l USING (user_id)
                         JOIN first_share s USING (user_id))                AS first_share_or_invite;
```

### Second distinct contributor to a group layer within 7 days

A group layer is "activated" when two different users add items within 7 days
of the first add. `layerId` is read from the event properties.

```sql
WITH adds AS (
  SELECT
    (properties ->> 'layerId')::uuid AS layer_id,
    user_id,
    created_at
  FROM analytics_event
  WHERE name = 'layer_item_added'
    AND user_id IS NOT NULL
    AND properties ->> 'owner' = 'group'
),
first_add AS (
  SELECT layer_id, min(created_at) AS first_at FROM adds GROUP BY layer_id
)
SELECT f.layer_id, count(DISTINCT a.user_id) AS contributors
FROM first_add f
JOIN adds a
  ON a.layer_id = f.layer_id
 AND a.created_at < f.first_at + interval '7 days'
GROUP BY f.layer_id
HAVING count(DISTINCT a.user_id) >= 2;
```

### Time from admission to first layer

```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f.at - a.admitted_at) AS median_gap
FROM membership_admission a
JOIN (
  SELECT user_id, min(created_at) AS at
  FROM analytics_event WHERE name = 'layer_created' GROUP BY user_id
) f ON f.user_id = a.user_id
WHERE a.source = 'invitation';
```

## Notes

- Events written before `owner`/`role`/`audience` were added lack those
  properties; filter on `properties ? 'owner'` when mixing eras.
- A user deleted later has `user_id` set to null; those rows drop out of
  per-person counts but stay in totals.
- Daily Pick engagement is reported separately through the client events
  `daily_pick_shown`, `daily_pick_saved` and `daily_pick_added_to_layer`.
