import requests

from .exceptions import OBDApiError, OBDValidationError


class OBDClient:
    """Client for the Omni Outbound Dial (OBD) API.

    Example:
        client = OBDClient(
            base_url=os.environ["OBD_API_BASE_URL"],
            client_id=os.environ["OBD_CLIENT_ID"],
            api_key=os.environ["OBD_API_KEY"],
        )
        response = client.initiate_call(
            from_number="+9104847189769",
            to_number="+916238330634",
            ref_id=6565,
        )
    """

    def __init__(self, base_url, client_id, api_key, request_timeout=15):
        """
        Args:
            base_url: base URL of your OBD API instance, e.g. "https://obd.yourdomain.com"
            client_id: your account's client id, sent as the `x-client-id` header
            api_key: your account's API key, sent as the `x-api-key` header
            request_timeout: seconds to wait for a response before giving up
        """
        if not base_url:
            raise OBDValidationError("base_url is required")
        if not client_id:
            raise OBDValidationError("client_id is required")
        if not api_key:
            raise OBDValidationError("api_key is required")

        self.base_url = base_url.rstrip("/")
        self.client_id = client_id
        self.api_key = api_key
        self.request_timeout = request_timeout

    def initiate_call(
        self,
        from_number,
        to_number,
        dial_request_expiry=None,
        ref_id=None,
        timeout=None,
        next_action_by_api=None,
        next_action_url=None,
        stream=None,
        pingback_url=None,
        call_events=None,
    ):
        """Initiate an outbound dial call.

        Args:
            from_number: caller id shown to the destination, E.164 format e.g. "+9104847189769"
            to_number: destination number to dial, E.164 format
            dial_request_expiry: seconds after which the request itself is abandoned if not yet placed
            ref_id: your own reference id, echoed back in callbacks so you can correlate them to this call
            timeout: how long to let the destination ring, in seconds, before giving up
            next_action_by_api: True if your server decides the next IVR step dynamically
            next_action_url: webhook the platform calls mid-call to ask what should happen next
            stream: dict describing live audio streaming/recording config — see build_stream_config()
            pingback_url: webhook that receives call status callbacks
            call_events: dict of event_name -> bool controlling which events trigger a callback —
                see build_call_events()

        Returns:
            dict: parsed JSON response, e.g.
                {"status": "success", "message": "...", "request_id": 123, "timestamp": "..."}

        Raises:
            OBDValidationError: if from_number/to_number are missing.
            OBDApiError: if the API rejects the request or a network error occurs.
        """
        if not from_number or not to_number:
            raise OBDValidationError("from_number and to_number are required")

        payload = {"from_number": from_number, "to_number": to_number}

        optional_fields = {
            "dial_request_expiry": dial_request_expiry,
            "ref_id": ref_id,
            "timeout": timeout,
            "next_action_by_api": next_action_by_api,
            "next_action_url": next_action_url,
            "stream": stream,
            "pingback_url": pingback_url,
            "call_events": call_events,
        }
        for key, value in optional_fields.items():
            if value is not None:
                payload[key] = value

        return self._post("/api/obd/calls", payload)

    def _post(self, path, payload):
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "x-client-id": self.client_id,
            "x-api-key": self.api_key,
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=self.request_timeout)
        except requests.RequestException as exc:
            raise OBDApiError(f"Network error calling {path}: {exc}") from exc

        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text}

        if not response.ok:
            raise OBDApiError(
                body.get("message", f"OBD API request failed with status {response.status_code}"),
                status_code=response.status_code,
                response_body=body,
            )

        return body


def build_stream_config(
    stream_url,
    enabled=True,
    record=False,
    duration=None,
    chunk_size=None,
    start_phase="ringing",
    custom_param=None,
):
    """Build the `stream` payload for initiate_call() with sane defaults.

    Args:
        stream_url: your WebSocket endpoint that receives the audio, e.g. "ws://media.example.com:3031"
        enabled: turn audio streaming on/off for this call
        record: also persist the audio as a recording, not just stream it live
        duration: max streaming duration in seconds
        chunk_size: size in bytes of each audio chunk sent over the WebSocket
        start_phase: "ringing" or "answered" — when streaming should begin
        custom_param: free-form dict of metadata echoed back to your WebSocket server
    """
    config = {"enabled": enabled, "stream_url": stream_url, "record": record, "start_phase": start_phase}
    if duration is not None:
        config["duration"] = duration
    if chunk_size is not None:
        config["chunk_size"] = chunk_size
    if custom_param is not None:
        config["custom_param"] = custom_param
    return config


def build_call_events(initiated=True, ringing=True, answered=True, completed=True, failed=True, expired=True):
    """Build the `call_events` payload for initiate_call() — controls which lifecycle events
    trigger a callback to pingback_url."""
    return {
        "initiated": initiated,
        "ringing": ringing,
        "answered": answered,
        "completed": completed,
        "failed": failed,
        "expired": expired,
    }
