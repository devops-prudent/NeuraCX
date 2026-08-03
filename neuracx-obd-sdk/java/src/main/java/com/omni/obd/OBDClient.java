package com.omni.obd;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.omni.obd.model.CallRequest;
import com.omni.obd.model.CallResponse;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Client for the Omni Outbound Dial (OBD) API.
 *
 * <pre>{@code
 * OBDClient client = new OBDClient.Builder()
 *     .baseUrl(System.getenv("OBD_API_BASE_URL"))
 *     .clientId(System.getenv("OBD_CLIENT_ID"))
 *     .apiKey(System.getenv("OBD_API_KEY"))
 *     .build();
 *
 * CallResponse response = client.initiateCall(
 *     new CallRequest.Builder()
 *         .fromNumber("+9104847189769")
 *         .toNumber("+916238330634")
 *         .refId(6565)
 *         .build()
 * );
 * }</pre>
 */
public class OBDClient {

    private final String baseUrl;
    private final String clientId;
    private final String apiKey;
    private final Duration requestTimeout;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private OBDClient(Builder builder) {
        this.baseUrl = builder.baseUrl;
        this.clientId = builder.clientId;
        this.apiKey = builder.apiKey;
        this.requestTimeout = builder.requestTimeout;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(requestTimeout)
                .build();
    }

    /**
     * Initiate an outbound dial call.
     *
     * @param request the call parameters, built via {@code CallRequest.Builder}
     * @return the parsed API response
     * @throws OBDApiException if the API rejects the request or a network error occurs
     */
    public CallResponse initiateCall(CallRequest request) throws OBDApiException {
        if (request.getFromNumber() == null || request.getToNumber() == null) {
            throw new OBDValidationException("fromNumber and toNumber are required");
        }

        String body;
        try {
            body = objectMapper.writeValueAsString(request);
        } catch (IOException e) {
            throw new OBDApiException("Failed to serialize request: " + e.getMessage(), 0, null);
        }

        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/obd/calls"))
                .timeout(requestTimeout)
                .header("Content-Type", "application/json")
                .header("x-client-id", clientId)
                .header("x-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> httpResponse;
        try {
            httpResponse = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            throw new OBDApiException("Network error calling OBD API: " + e.getMessage(), 0, null);
        }

        int status = httpResponse.statusCode();
        String responseBody = httpResponse.body();

        if (status < 200 || status >= 300) {
            throw new OBDApiException("OBD API request failed with status " + status, status, responseBody);
        }

        try {
            return objectMapper.readValue(responseBody, CallResponse.class);
        } catch (IOException e) {
            throw new OBDApiException("Failed to parse OBD API response: " + e.getMessage(), status, responseBody);
        }
    }

    public static class Builder {
        private String baseUrl;
        private String clientId;
        private String apiKey;
        private Duration requestTimeout = Duration.ofSeconds(15);

        /** Base URL of your OBD API instance, e.g. "https://obd.yourdomain.com". */
        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        /** Your account's client id, sent as the x-client-id header. */
        public Builder clientId(String clientId) {
            this.clientId = clientId;
            return this;
        }

        /** Your account's API key, sent as the x-api-key header. */
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Builder requestTimeout(Duration timeout) {
            this.requestTimeout = timeout;
            return this;
        }

        public OBDClient build() {
            if (baseUrl == null || baseUrl.isEmpty()) {
                throw new OBDValidationException("baseUrl is required");
            }
            if (clientId == null || clientId.isEmpty()) {
                throw new OBDValidationException("clientId is required");
            }
            if (apiKey == null || apiKey.isEmpty()) {
                throw new OBDValidationException("apiKey is required");
            }
            this.baseUrl = this.baseUrl.replaceAll("/+$", "");
            return new OBDClient(this);
        }
    }
}
