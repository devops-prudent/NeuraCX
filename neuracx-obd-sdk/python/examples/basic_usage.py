import os

from obd_sdk import OBDApiError, OBDClient, build_call_events, build_stream_config

# Set these in your environment before running this example:
#   OBD_API_BASE_URL, OBD_CLIENT_ID, OBD_API_KEY
client = OBDClient(
    base_url=os.environ["OBD_API_BASE_URL"],
    client_id=os.environ["OBD_CLIENT_ID"],
    api_key=os.environ["OBD_API_KEY"],
)

try:
    response = client.initiate_call(
        from_number="+9104847189769",
        to_number="+916238330634",
        dial_request_expiry=10,
        ref_id=6565,
        timeout=30,
        next_action_by_api=False,
        next_action_url="http://your-ivr-server.example.com/ivr/webhook",
        stream=build_stream_config(
            stream_url="ws://your-media-server.example.com:3031",
            record=True,
            duration=10,
            chunk_size=1600,
            custom_param={"customer_id": "CUST10001", "order_id": "ORD89231"},
        ),
        pingback_url="http://your-server.example.com/api/postdata",
        call_events=build_call_events(),
    )
    print("Call initiated:", response)
except OBDApiError as exc:
    print(f"OBD API error (status {exc.status_code}): {exc}")
    print(exc.response_body)
