# Omni OBD SDK — Node.js

Official Node.js client for the Omni Outbound Dial (OBD) API. Lets your application place outbound calls, optionally stream/record the audio in real time, and receive status callbacks — without hand-rolling HTTP requests.

Requires Node.js 18 or later (uses the built-in `fetch`).

## Install

If you're pulling this from GitHub directly:

```bash
npm install git+https://github.com/your-org/omni-obd-sdk.git#main --workspace=nodejs
```

Or, once published to npm:

```bash
npm install omni-obd-sdk
```

## Quick start

```js
const { OBDClient } = require('omni-obd-sdk');

const client = new OBDClient({
  baseUrl: process.env.OBD_API_BASE_URL,   // e.g. "https://obd.yourdomain.com"
  clientId: process.env.OBD_CLIENT_ID,     // provided by your account team
  apiKey: process.env.OBD_API_KEY,         // provided by your account team
});

const response = await client.initiateCall({
  fromNumber: '+9104847189769',
  toNumber: '+916238330634',
  refId: 6565,
});

console.log(response);
// { status: 'success', message: 'OBD initiation successful', request_id: 19419, timestamp: '...' }
```

Never hardcode `baseUrl`, `clientId`, or `apiKey` in source code — load them from environment variables or a secrets manager. See `examples/basic-usage.js` for the full field set, including live streaming and status callbacks.

## Field reference

| Field | Type | Required | Meaning |
|---|---|---|---|
| `fromNumber` | string | yes | Caller ID shown to the destination, E.164 format (`+countrycode...`) |
| `toNumber` | string | yes | Number to dial, E.164 format |
| `dialRequestExpiry` | number | no | Seconds after which the *request itself* is abandoned if the call hasn't been placed yet |
| `refId` | number/string | no | Your own reference id, echoed back in callbacks so you can match them to this call |
| `timeout` | number | no | How long to let the destination ring (seconds) before giving up |
| `nextActionByApi` | boolean | no | `true` if your server decides the next IVR step dynamically via `nextActionUrl`, rather than a pre-built flow |
| `nextActionUrl` | string | no | Webhook the platform calls mid-call to ask what should happen next |
| `stream` | object | no | Live audio streaming / recording config — see below |
| `pingbackUrl` | string | no | Webhook that receives call status callbacks |
| `callEvents` | object | no | Which lifecycle events (`initiated`, `ringing`, `answered`, `completed`, `failed`, `expired`) should trigger a callback to `pingbackUrl` |

### `stream` object

| Field | Type | Meaning |
|---|---|---|
| `enabled` | boolean | Turn audio streaming on/off for this call |
| `record` | boolean | Also persist the audio as a recording, not just stream it live |
| `streamUrl` | string | Your WebSocket endpoint that receives the audio, e.g. `ws://media.example.com:3031` |
| `duration` | number | Max streaming duration in seconds |
| `chunkSize` | number | Size in bytes of each audio chunk sent over the WebSocket |
| `startPhase` | string | `"ringing"` or `"answered"` — when streaming should begin |
| `customParam` | object | Free-form key/value metadata echoed back to your WebSocket server |

## Error handling

```js
const { OBDApiError, OBDValidationError } = require('omni-obd-sdk');

try {
  await client.initiateCall({ fromNumber: '+91...', toNumber: '+91...' });
} catch (err) {
  if (err instanceof OBDValidationError) {
    // request was malformed before it ever left your process
  } else if (err instanceof OBDApiError) {
    // the API rejected the request, or a network failure occurred
    console.error(err.statusCode, err.responseBody);
  }
}
```

## License

MIT
