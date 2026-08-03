package com.omni.obd;

/**
 * Thrown when the OBD API returns a non-2xx response, or the request fails on the network.
 */
public class OBDApiException extends Exception {

    private final int statusCode;
    private final String responseBody;

    public OBDApiException(String message, int statusCode, String responseBody) {
        super(message);
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }

    /** HTTP status code, or 0 for network-level failures. */
    public int getStatusCode() {
        return statusCode;
    }

    /** Raw response body returned by the API, if any. */
    public String getResponseBody() {
        return responseBody;
    }
}
