# Omni OBD SDK — Python

Official Python client for the Omni Outbound Dial (OBD) API. Lets your application place outbound calls, optionally stream/record the audio in real time, and receive status callbacks.

Requires Python 3.7+.

## Install

If you're pulling this from GitHub directly:

```bash
pip install git+https://github.com/your-org/omni-obd-sdk.git#subdirectory=python
```

Or, from a local checkout:

```bash
cd python
pip install .
```

## Quick start

```python
import os
from obd_sdk import OBDClient

client = OBDClient(
    base_url=os.environ["OBD_API_BASE_URL"],   # e.g. "https://obd.yourdomain.com"
    client_id=os.environ["OBD_CLIENT_ID"],       # provided by your account team
    api_key=os.environ["OBD_API_KEY"],           # provided by your account team
)

response = client.initiate_call(
    from_number="+91xxxxxxxxxx",
    to_number="+91yyyyyyyyyy",
    ref_id=6565,
)

print(response)
# {'status': 'success', 'message': 'OBD initiation successful', 'request_id': 19419, 'timestamp': '...'}
```

Never hardcode `base_url`, `client_id`, or `api_key` in source code — load them from environment variables or a secrets manager. See `examples/basic_usage.py` for the full field set, including live streaming and status callbacks.

## Field reference

| Field | Type | Required | Meaning |
|---|---|---|---|
| `from_number` | str | yes | Caller ID shown to the destination, E.164 format (`+countrycode...`) |
| `to_number` | str | yes | Number to dial, E.164 format |
| `dial_request_expiry` | int | no | Seconds after which the *request itself* is abandoned if the call hasn't been placed yet |
| `ref_id` | int/str | no | Your own reference id, echoed back in callbacks so you can match them to this call |
| `timeout` | int | no | How long to let the destination ring (seconds) before giving up |
| `next_action_by_api` | bool | no | `True` if your server decides the next IVR step dynamically via `next_action_url`, rather than a pre-built flow |
| `next_action_url` | str | no | Webhook the platform calls mid-call to ask what should happen next |
| `stream` | dict | no | Live audio streaming / recording config — build with `build_stream_config()` |
| `pingback_url` | str | no | Webhook that receives call status callbacks |
| `call_events` | dict | no | Which lifecycle events should trigger a callback — build with `build_call_events()` |

### `build_stream_config()`

| Argument | Meaning |
|---|---|
| `stream_url` | Your WebSocket endpoint that receives the audio, e.g. `ws://media.example.com:3031` |
| `enabled` | Turn audio streaming on/off for this call |
| `record` | Also persist the audio as a recording, not just stream it live |
| `duration` | Max streaming duration in seconds |
| `chunk_size` | Size in bytes of each audio chunk sent over the WebSocket |
| `start_phase` | `"ringing"` or `"answered"` — when streaming should begin |
| `custom_param` | Free-form dict of metadata echoed back to your WebSocket server |

## Error handling

```python
from obd_sdk import OBDApiError, OBDValidationError

try:
    client.initiate_call(from_number="+91...", to_number="+91...")
except OBDValidationError:
    # request was malformed before it ever left your process
    ...
except OBDApiError as exc:
    # the API rejected the request, or a network failure occurred
    print(exc.status_code, exc.response_body)
```

## License

MIT
