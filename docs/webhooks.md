# Webhooks

Webhooks let Conductor push real-time event notifications to any HTTP endpoint. When something happens — an agent goes offline, a task changes status, a user logs in — Conductor sends a signed JSON payload to your URL within seconds.

Use webhooks to connect Conductor to Slack, PagerDuty, custom dashboards, CI/CD pipelines, or any system that accepts HTTP callbacks.

---

## Quick Start

1. Open the **Webhooks** panel from the left sidebar (under AUTOMATE)
2. Click **Create Webhook**
3. Enter a **name** (e.g., "Slack Alerts") and your **endpoint URL**
4. Select which **events** to subscribe to (or leave as `*` for all)
5. Click **Create** — your webhook secret is displayed **once**. Copy and save it immediately.
6. Click **Test** to send a `test.ping` event and verify connectivity

---

## Event Types

Subscribe to specific event types or use `*` to receive everything.

| Event | Fires When |
|-------|------------|
| `agent.status_change` | Agent goes online, offline, idle, or changes status |
| `agent.error` | Agent encounters an error |
| `activity.task_created` | A new task is created |
| `activity.task_updated` | A task's details are modified |
| `activity.task_deleted` | A task is deleted |
| `activity.task_status_changed` | A task moves between statuses (inbox, assigned, in_progress, review, quality_review, done) |
| `notification.mention` | A user or agent is @mentioned |
| `notification.assignment` | A task is assigned to someone |
| `security.login_failed` | A login attempt fails |
| `security.user_created` | A new user account is created |
| `security.user_deleted` | A user account is deleted |
| `security.password_change` | A user changes their password |
| `test.ping` | Manual test from the dashboard (not a real event) |
| `*` | Wildcard — matches all event types above |

---

## Payload Format

Every webhook delivery is an HTTP `POST` with a JSON body:

```json
{
  "event": "activity.task_status_changed",
  "timestamp": 1710456789,
  "data": {
    "task_id": 42,
    "title": "Fix login bug",
    "old_status": "in_progress",
    "new_status": "review",
    "actor": "agent:main"
  }
}
```

**Headers included with every delivery:**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `User-Agent` | `MissionControl-Webhook/1.0` |
| `X-MC-Event` | The event type (e.g., `activity.task_created`) |
| `X-MC-Signature` | HMAC-SHA256 signature (if a secret is configured) |

---

## Signature Verification

Every webhook is signed with your secret using **HMAC-SHA256**. Always verify signatures in production to ensure payloads actually came from Conductor.

### How It Works

1. Conductor computes `HMAC-SHA256(secret, raw_request_body)`
2. The result is sent as: `X-MC-Signature: sha256=<hex_digest>`
3. Your server should compute the same HMAC and compare

### Verification in Node.js

```javascript
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' +
    createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

  // Constant-time comparison prevents timing attacks
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// In your request handler:
const rawBody = await request.text(); // Read as string BEFORE parsing JSON
const signature = request.headers.get('X-MC-Signature');

if (!verifySignature(YOUR_SECRET, rawBody, signature)) {
  return new Response('Invalid signature', { status: 401 });
}

const payload = JSON.parse(rawBody);
// Process the event...
```

### Verification in Python

```python
import hmac
import hashlib

def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

### Important Notes

- Always read the **raw request body** first, then parse JSON. Parsing and re-serializing may alter whitespace and break the signature.
- Use **constant-time comparison** (`timingSafeEqual` in Node.js, `hmac.compare_digest` in Python) to prevent timing attacks.
- The secret is shown only once when creating or regenerating. Store it securely (e.g., in environment variables or a secrets manager).

---

## Retry & Reliability

Conductor uses exponential backoff with jitter to retry failed deliveries automatically.

### Retry Schedule

| Attempt | Delay | With Jitter (approx.) |
|---------|-------|-----------------------|
| 1st retry | 30 seconds | 24s – 36s |
| 2nd retry | 5 minutes | 4m – 6m |
| 3rd retry | 30 minutes | 24m – 36m |
| 4th retry | 2 hours | 1h 36m – 2h 24m |
| 5th retry | 8 hours | 6h 24m – 9h 36m |

- A delivery is considered **successful** if your endpoint returns HTTP 2xx
- Any non-2xx response or network timeout (10 seconds) triggers a retry
- Jitter of +/-20% is applied to each delay to prevent thundering herd

### Circuit Breaker

If a webhook fails on **all 5 retry attempts**, the circuit breaker trips:

- The webhook is **automatically disabled** (marked as `enabled = false`)
- No further deliveries are attempted until you fix the issue
- The Webhooks panel shows consecutive failure count

**To reset the circuit breaker:**
1. Fix your endpoint
2. Go to the webhook in the panel
3. Use the API to send `reset_circuit: true` (re-enables the webhook and clears the failure counter)
4. Click **Test** to verify it's working again

### Manual Retry

You can retry any individual failed delivery from the delivery history. Manual retries:
- Send the **exact same payload** to the current webhook URL
- Do **not** trigger further automatic retries if they fail
- Are tracked with a link back to the original delivery

---

## Delivery History

Every webhook delivery is logged with full details. View history by clicking a webhook in the panel.

**Tracked per delivery:**

| Field | Description |
|-------|-------------|
| Event type | Which event triggered this delivery |
| Status code | HTTP response code (or `0` for network errors) |
| Duration | Round-trip time in milliseconds |
| Response body | First 1,000 characters of the response |
| Error message | Network or timeout error details |
| Attempt number | Which retry attempt this was |
| Timestamp | When the delivery was sent |

Conductor retains the **last 200 deliveries** per webhook. Older deliveries are automatically pruned.

---

## API Reference

All webhook API endpoints require **admin** role. Mutations are rate-limited.

### List Webhooks

```
GET /api/webhooks
```

Returns all webhooks with delivery statistics. Secrets are masked (last 4 characters only).

### Create Webhook

```
POST /api/webhooks
Content-Type: application/json

{
  "name": "My Webhook",
  "url": "https://example.com/hooks/conductor",
  "events": ["agent.status_change", "activity.task_created"],
  "generate_secret": true
}
```

- `name` (required): Display name
- `url` (required): HTTPS endpoint URL
- `events` (optional): Array of event types. Defaults to `["*"]` (all events)
- `generate_secret` (optional): Generate a 256-bit HMAC secret. Defaults to `true`

**Response includes the full secret — save it immediately.** It will never be shown in full again.

### Update Webhook

```
PUT /api/webhooks
Content-Type: application/json

{
  "id": 1,
  "name": "Updated Name",
  "url": "https://new-endpoint.example.com/hook",
  "events": ["*"],
  "enabled": true,
  "regenerate_secret": false,
  "reset_circuit": false
}
```

All fields except `id` are optional. Set `regenerate_secret: true` to generate a new secret (returned once in the response). Set `reset_circuit: true` to clear failure count and re-enable.

### Delete Webhook

```
DELETE /api/webhooks
Content-Type: application/json

{ "id": 1 }
```

Deletes the webhook and all its delivery history.

### View Deliveries

```
GET /api/webhooks/deliveries?webhook_id=1&limit=50&offset=0
```

- `webhook_id` (optional): Filter to a specific webhook
- `limit` (optional): Max 200, default 50
- `offset` (optional): Pagination offset

### Test Webhook

```
POST /api/webhooks/test
Content-Type: application/json

{ "id": 1 }
```

Sends a `test.ping` event immediately. Does not trigger automatic retries on failure.

### Retry Delivery

```
POST /api/webhooks/retry
Content-Type: application/json

{ "delivery_id": 42 }
```

Re-sends a specific failed delivery. Does not trigger further automatic retries.

### Verification Documentation

```
GET /api/webhooks/verify-docs
```

Returns the signature verification algorithm, steps, and code examples as JSON. Available to all authenticated users (viewer+).

---

## Common Patterns

### Slack Notification

Point a webhook at a Slack Incoming Webhook URL. Slack expects a specific format, so use a small proxy (e.g., a Cloudflare Worker) to transform the payload:

```javascript
// Cloudflare Worker example
export default {
  async fetch(request) {
    const { event, data } = await request.json();
    const text = `*${event}*: ${JSON.stringify(data, null, 2)}`;
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return new Response('ok');
  }
};
```

### Task Status Alerts Only

Subscribe to just `activity.task_status_changed` to get notified when tasks move through the pipeline (inbox, assigned, in_progress, review, quality_review, done).

### Security Monitoring

Subscribe to `security.*` events to feed login failures and user management actions into your SIEM or audit system.

### Agent Down Alerts

Subscribe to `agent.status_change` and filter for `data.new_status === "offline"` in your handler to get paged when an agent drops.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Webhook shows "disabled" | Circuit breaker tripped after 5 consecutive failures | Fix your endpoint, then reset circuit via API |
| No deliveries appearing | Webhook may not be subscribed to the right events | Check event filter — use `*` to catch everything |
| Signature mismatch | Parsing body before reading raw bytes | Read raw body as text first, then parse JSON |
| Timeout errors | Endpoint takes >10s to respond | Return 200 immediately, process async |
| Missing events | Event type not in subscription list | Add the specific event type or use `*` |

---

*Last updated: 2026-03-10*
