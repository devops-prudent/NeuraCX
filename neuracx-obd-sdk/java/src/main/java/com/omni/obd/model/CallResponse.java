package com.omni.obd.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Response returned by {@code OBDClient.initiateCall} on success. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class CallResponse {

    @JsonProperty("status")
    private String status;

    @JsonProperty("message")
    private String message;

    @JsonProperty("request_id")
    private long requestId;

    @JsonProperty("timestamp")
    private String timestamp;

    public String getStatus() {
        return status;
    }

    public String getMessage() {
        return message;
    }

    public long getRequestId() {
        return requestId;
    }

    public String getTimestamp() {
        return timestamp;
    }

    @Override
    public String toString() {
        return "CallResponse{status='" + status + "', message='" + message
                + "', requestId=" + requestId + ", timestamp='" + timestamp + "'}";
    }
}
