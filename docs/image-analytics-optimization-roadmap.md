# Image Analytics Optimization Roadmap

This document defines the next optimization direction for Recho image generation. The goal is to collect only the data that helps improve the product, while keeping sensitive data behind the gateway and out of public API responses.

## Current Baseline

The current image data model already supports first-stage analysis:

- `image_generations` stores successful generated works, prompts, model metadata, image dimensions, storage byte sizes, user id, request metadata, and generation options.
- `image_generation_attempts` stores per-request success and failure telemetry, including status, latency, provider/model, error type, HTTP status, IP, and user agent.
- The gateway remains the only public access path. Frontend views receive cropped response payloads, not raw database rows.

This is enough to analyze speed, failure rate, storage size, model usage, user generation preferences, and basic traffic pressure.

## Direction 1: Product Operation Optimization

Use a user behavior event stream to understand which generated images and UI operations are actually valuable.

### Purpose

This direction answers questions like:

- Which generated images are opened, zoomed, downloaded, or reused?
- Do users often continue generation from old works?
- Which gallery actions create meaningful follow-up work?
- Which flows are used but currently too slow or hidden?
- Which features can be simplified because users rarely touch them?

### Proposed Table

Create a lightweight event table later, tentatively named `image_events`.

Recommended fields:

```text
id
image_id
user_id
event_type
source
created_at
session_id
metadata
```

Recommended `event_type` values:

```text
view_detail
zoom
download
continue_generate
send_to_chat
copy_prompt
use_as_reference
delete
```

Recommended `source` values:

```text
works
history
canvas
viewer
chat
```

### Implementation Rule

Track only user actions that show intent. Avoid noisy events like mouse move, hover, node drag, minimap movement, or scroll.

The event endpoint should be gateway-only:

```text
POST /api/image/events
```

Frontend sends minimal fields. Backend attaches `user_id`, IP, user agent, and server timestamp.

### Product Decisions This Enables

- Prioritize high-value actions such as download, continue generation, and reference reuse.
- Identify whether works gallery cards need stronger prompts, faster preview, or clearer actions.
- Detect if users generate many images but rarely open/download them.
- Compare public gallery behavior against personal history behavior.

## Direction 2: Canvas Flow Optimization

Use canvas workflow context to understand how users build image generation chains and where the node editor becomes inefficient.

### Purpose

This direction answers questions like:

- Are users generating from simple prompts or multi-node workflows?
- Do connected prompt nodes improve generation reuse?
- How often are reference images connected by edge versus mentioned with `@`?
- Do large canvases cause slower generation or higher failure rates?
- Which node types are frequently copied, deleted, renamed, or connected?

### Proposed Data

For each generation request, record a compact canvas snapshot summary, not the full canvas by default.

Recommended fields on `image_generations` or a separate `image_generation_contexts` table:

```text
generation_id
canvas_id
node_count
connection_count
image_node_count
text_node_count
generation_node_count
reference_count
mentioned_reference_count
connected_reference_count
prompt_char_count
has_connected_prompt
canvas_version
created_at
```

Use a separate table if the context grows beyond a compact summary.

### Implementation Rule

Do not store full canvas state in the analytics context row. Store only counts and flags needed for analysis.

Full canvas state belongs to import/export files or optional saved projects, not request telemetry.

### Flow Decisions This Enables

- Decide whether connection handles, `@` image references, or context menus need simplification.
- Detect whether users rely more on copied nodes or fresh node creation.
- Find workflows that frequently fail due to too many reference images or overly long prompts.
- Compare generation quality and speed between simple and complex canvases.

## Canvas Export And Import

Canvas export/import should be treated as a product feature and a workflow analysis foundation.

### Goals

- Let users back up or share a canvas workflow.
- Let users resume a node graph without depending only on browser local state.
- Preserve enough structure for future project-level saving.
- Provide stable `canvas_id` and `canvas_version` values for analytics.

### Export Format

Use a versioned JSON file.

Recommended shape:

```json
{
  "schema": "recho.canvas",
  "version": 1,
  "exportedAt": "2026-06-06T00:00:00.000Z",
  "canvas": {
    "id": "canvas_xxx",
    "title": "Untitled canvas",
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    },
    "nodes": [],
    "connections": []
  },
  "assets": {
    "mode": "urls",
    "images": []
  }
}
```

### Asset Strategy

Prefer URL references for images already stored in Supabase:

```text
mode = urls
```

Only use embedded base64 for local unsaved pasted images:

```text
mode = mixed
```

This keeps export files small and avoids duplicating Storage traffic.

### Import Rules

Import should:

- Validate `schema` and `version`.
- Reject unknown future major versions.
- Preserve node positions, sizes, titles, prompts, model options, and connections.
- Keep Supabase image URLs as URLs.
- Create local image nodes from embedded images only when necessary.
- Regenerate local node IDs if imported IDs collide with the current canvas.

### UI Entry Points

Recommended controls:

- Export canvas: canvas toolbar or file menu.
- Import canvas: canvas toolbar or empty-canvas state.
- Import conflict handling: replace current canvas or append to current canvas.

Default behavior should be append, because it is less destructive.

## Recommended Rollout Order

1. Add canvas export JSON.
2. Add canvas import JSON with schema validation.
3. Add compact canvas context fields to image generation requests.
4. Add `image_events` table and `POST /api/image/events`.
5. Track high-intent events only: detail view, zoom, download, continue generation, send to chat.
6. Build simple SQL reports for weekly review.

## First Reports To Build

Product operation reports:

```sql
-- Most valuable actions by day
select
  date_trunc('day', created_at) as day,
  event_type,
  count(*) as events
from image_events
group by 1, 2
order by 1 desc, 3 desc;
```

Canvas flow reports:

```sql
-- Generation complexity versus latency
select
  case
    when reference_count = 0 then 'no_reference'
    when reference_count <= 2 then 'light_reference'
    else 'heavy_reference'
  end as reference_bucket,
  count(*) as generations,
  avg(latency_ms) as avg_latency_ms
from image_generation_contexts
join image_generations on image_generations.id = image_generation_contexts.generation_id
group by 1
order by 2 desc;
```

## Guardrails

- Do not expose analytics tables directly to frontend clients.
- Keep RLS enabled and use service-role access through the gateway.
- Do not track hover, mouse movement, raw canvas pan, or keystroke-level data.
- Do not store full prompts in event metadata. Prompts already belong in `image_generations`.
- Do not store full canvas JSON in analytics rows.
- Keep event metadata small and structured.

## Success Criteria

This direction is working when the project can answer:

- Which actions make generated images valuable?
- Which generation settings cost the most storage and time?
- Which canvas workflows lead to more reuse?
- Which flows cause failures or slow generation?
- Which UI actions should be made easier, hidden, or removed?
