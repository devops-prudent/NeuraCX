package com.omni.obd.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import com.omni.obd.OBDValidationException;

/** Request payload for {@code OBDClient.initiateCall}. Build with {@code CallRequest.Builder}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CallRequest {

    /** Caller ID shown to the destination, E.164 format e.g. "+9104847189769". Required. */
    @JsonProperty("from_number")
    private String fromNumber;

    /** Destination number to dial, E.164 format. Required. */
    @JsonProperty("to_number")
    private String toNumber;

    /** Seconds after which the request itself is abandoned if the call hasn't been placed yet. */
    @JsonProperty("dial_request_expiry")
    private Integer dialRequestExpiry;

    /** Your own reference id, echoed back in callbacks so you can correlate them to this call. */
    @JsonProperty("ref_id")
    private Long refId;

    /** How long to let the destination ring, in seconds, before giving up. */
    @JsonProperty("timeout")
    private Integer timeout;

    /** True if your server decides the next IVR step dynamically via nextActionUrl. */
    @JsonProperty("next_action_by_api")
    private Boolean nextActionByApi;

    /** Webhook the platform calls mid-call to ask what should happen next. */
    @JsonProperty("next_action_url")
    private String nextActionUrl;

    /** Live audio streaming / recording configuration. */
    @JsonProperty("stream")
    private StreamConfig stream;

    /** Webhook that receives call status callbacks. */
    @JsonProperty("pingback_url")
    private String pingbackUrl;

    /** Which lifecycle events should trigger a callback to pingbackUrl. */
    @JsonProperty("call_events")
    private CallEvents callEvents;

    public String getFromNumber() {
        return fromNumber;
    }

    public String getToNumber() {
        return toNumber;
    }

    public static class Builder {
        private final CallRequest request = new CallRequest();

        public Builder fromNumber(String fromNumber) {
            request.fromNumber = fromNumber;
            return this;
        }

        public Builder toNumber(String toNumber) {
            request.toNumber = toNumber;
            return this;
        }

        public Builder dialRequestExpiry(int seconds) {
            request.dialRequestExpiry = seconds;
            return this;
        }

        public Builder refId(long refId) {
            request.refId = refId;
            return this;
        }

        public Builder timeout(int seconds) {
            request.timeout = seconds;
            return this;
        }

        public Builder nextActionByApi(boolean value) {
            request.nextActionByApi = value;
            return this;
        }

        public Builder nextActionUrl(String url) {
            request.nextActionUrl = url;
            return this;
        }

        public Builder stream(StreamConfig stream) {
            request.stream = stream;
            return this;
        }

        public Builder pingbackUrl(String url) {
            request.pingbackUrl = url;
            return this;
        }

        public Builder callEvents(CallEvents callEvents) {
            request.callEvents = callEvents;
            return this;
        }

        public CallRequest build() {
            if (request.fromNumber == null || request.toNumber == null) {
                throw new OBDValidationException("fromNumber and toNumber are required");
            }
            return request;
        }
    }
}
