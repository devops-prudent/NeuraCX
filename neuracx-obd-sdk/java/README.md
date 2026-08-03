# Omni OBD SDK — Java

Official Java client for the Omni Outbound Dial (OBD) API. Lets your application place outbound calls, optionally stream/record the audio in real time, and receive status callbacks.

Requires Java 11 or later. Depends only on `jackson-databind` for JSON; uses the built-in `java.net.http.HttpClient` for transport.

## Install

Add as a Maven module (from a local checkout or a git submodule):

```xml
<dependency>
    <groupId>com.omni.obd</groupId>
    <artifactId>omni-obd-sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

```bash
cd java
mvn install
```

## Quick start

```java
OBDClient client = new OBDClient.Builder()
        .baseUrl(System.getenv("OBD_API_BASE_URL"))   // e.g. "https://obd.yourdomain.com"
        .clientId(System.getenv("OBD_CLIENT_ID"))       // provided by your account team
        .apiKey(System.getenv("OBD_API_KEY"))           // provided by your account team
        .build();

CallRequest request = new CallRequest.Builder()
        .fromNumber("+91yyyyyyyyyy")
        .toNumber("+91xxxxxxxxxx")
        .refId(6565)
        .build();

CallResponse response = client.initiateCall(request);
System.out.println(response);
// CallResponse{status='success', message='OBD initiation successful', requestId=19419, timestamp='...'}
```

Never hardcode `baseUrl`, `clientId`, or `apiKey` in source code — load them from environment variables, a properties file outside version control, or a secrets manager. See `examples/BasicUsage.java` for the full field set, including live streaming and status callbacks.

## Field reference

| `CallRequest.Builder` method | Required | Meaning |
|---|---|---|
| `fromNumber` | yes | Caller ID shown to the destination, E.164 format (`+countrycode...`) |
| `toNumber` | yes | Number to dial, E.164 format |
| `dialRequestExpiry` | no | Seconds after which the *request itself* is abandoned if the call hasn't been placed yet |
| `refId` | no | Your own reference id, echoed back in callbacks so you can match them to this call |
| `timeout` | no | How long to let the destination ring (seconds) before giving up |
| `nextActionByApi` | no | `true` if your server decides the next IVR step dynamically via `nextActionUrl` |
| `nextActionUrl` | no | Webhook the platform calls mid-call to ask what should happen next |
| `stream` | no | `StreamConfig` — live audio streaming / recording config, see below |
| `pingbackUrl` | no | Webhook that receives call status callbacks |
| `callEvents` | no | `CallEvents` — which lifecycle events should trigger a callback |

### `StreamConfig.Builder`

| Method | Meaning |
|---|---|
| `enabled` | Turn audio streaming on/off for this call |
| `record` | Also persist the audio as a recording, not just stream it live |
| `streamUrl` | Your WebSocket endpoint that receives the audio, e.g. `ws://media.example.com:3031` |
| `duration` | Max streaming duration in seconds |
| `chunkSize` | Size in bytes of each audio chunk sent over the WebSocket |
| `startPhase` | `"ringing"` or `"answered"` — when streaming should begin |
| `customParam` | Free-form `Map<String,String>` echoed back to your WebSocket server |

## Error handling

```java
try {
    client.initiateCall(request);
} catch (OBDValidationException e) {
    // request was malformed before it ever left your process (unchecked)
} catch (OBDApiException e) {
    // the API rejected the request, or a network failure occurred
    System.err.println(e.getStatusCode() + ": " + e.getResponseBody());
}
```

## License

MIT
