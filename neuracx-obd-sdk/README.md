# Omni OBD API — SDKs

Official client libraries for the Omni Outbound Dial (OBD) API — a single HTTP call to place an outbound phone call, optionally stream/record its audio in real time, and get status callbacks as the call progresses.

| Language | Folder | Package |
|---|---|---|
| Node.js | [`nodejs/`](nodejs/) | `omni-obd-sdk` (npm) |
| Python | [`python/`](python/) | `omni-obd-sdk` (pip) |
| Java | [`java/`](java/) | `com.omni.obd:omni-obd-sdk` (Maven) |

Each folder is self-contained with its own README, install instructions, and a runnable example under `examples/`.

## What this API does

A single endpoint, `POST /api/obd/calls`, tells the platform to dial a number. You give it a caller ID and a destination; the platform handles the actual telephony. Optionally, you can:

- **Stream the call's audio** to your own WebSocket server in real time (e.g. for a voicebot or live transcription), and/or record it.
- **Drive the IVR dynamically** — instead of a fixed flow, the platform asks your webhook what to do next at each step.
- **Get notified** at each stage of the call's life (ringing, answered, completed, failed, expired) via a webhook you control.

## Authentication

Every request is authenticated with two headers:

| Header | Meaning |
|---|---|
| `x-client-id` | Identifies your account |
| `x-api-key` | Your account's secret API key |

Both are issued by your Omni account team. **Treat the API key like a password** — never commit it to source control or client-side code. Each SDK takes these as constructor/builder arguments so you can load them from environment variables, a `.env` file (git-ignored), or a secrets manager.

## Request fields — plain-language glossary

| Field (wire format) | What it actually means |
|---|---|
| `from_number` | The caller ID the destination will see. Must be in E.164 format, e.g. `+91yyyyyyyyyy`. |
| `to_number` | The number to call, also E.164, e.g. `+91xxxxxxxxxx`. |
| `dial_request_expiry` | A safety timer on the *request itself* — if the platform hasn't even started dialing within this many seconds (e.g. due to queuing), it gives up. Not the same as ring time. |
| `ref_id` | A number or string you make up, purely for your own bookkeeping. The platform echoes it back in every callback so you know which of *your* records the call belongs to. |
| `timeout` | Ordinary ring timeout, in seconds — how long the destination phone is allowed to ring before the platform gives up on that attempt. |
| `next_action_by_api` | If `true`, the call doesn't follow a pre-built static IVR flow — instead, at each step, the platform asks `next_action_url` "what do I do now?" Use this when the IVR logic needs to be dynamic (e.g. driven by data in your own database). |
| `next_action_url` | The webhook URL the platform calls to get that "what do I do now?" answer, when `next_action_by_api` is `true`. |
| `pingback_url` | A webhook URL that receives a POST every time something notable happens on the call (see `call_events` below). This is how your system finds out a call was answered, failed, etc. |
| `call_events` | A set of booleans (`initiated`, `ringing`, `answered`, `completed`, `failed`, `expired`) letting you choose exactly which of those moments trigger a POST to `pingback_url`. Turn off ones you don't care about to reduce webhook noise. |
| `stream` | Real-time audio streaming / recording settings, detailed below. Omit entirely if you don't need live audio. |

### `stream` object

| Field | Meaning |
|---|---|
| `enabled` | Master on/off switch for audio streaming on this call. |
| `record` | If `true`, the audio is also saved as a recording (in addition to being streamed live). If you only want a recording and no live stream, this SDK still requires `enabled: true` plus a `stream_url`, since streaming is how the platform captures the audio in the first place. |
| `stream_url` | Your WebSocket server's address, e.g. `ws://media.yourdomain.com:3031`. The platform connects to this and pushes audio frames. |
| `duration` | Safety cap, in seconds, on how long streaming continues even if the call itself runs longer. |
| `chunk_size` | How many bytes of audio are sent per WebSocket frame. Smaller = lower latency, more overhead; larger = the reverse. `1600` bytes is a reasonable default for 8kHz PCM. |
| `start_phase` | `"ringing"` starts streaming as soon as the phone starts ringing (useful for early-media/IVR use cases); `"answered"` waits until the call is actually picked up. |
| `custom_param` | Any key/value pairs you want attached to this stream session — the platform passes them through to your WebSocket server unchanged, so you can correlate the stream with your own records (order ID, customer ID, etc.) without needing a database round-trip on your media server. |

## Response

A successful call returns:

```json
{
  "status": "success",
  "message": "OBD initiation successful",
  "request_id": 19419,
  "timestamp": "2026-07-31T11:27:23.279Z"
}
```

`request_id` is the platform's own identifier for this dial request — useful for support queries, distinct from your own `ref_id`.

## Error handling

All three SDKs raise a dedicated exception type when the API responds with a non-2xx status (invalid credentials, malformed number, rate limiting, etc.), carrying the HTTP status code and the raw response body so you can log or retry appropriately. See each language's README for the exact exception names and handling patterns.

## Getting credentials / support

Contact your Omni account team to obtain your `client_id`, `api_key`, and the base URL for your environment (sandbox vs. production typically differ).
