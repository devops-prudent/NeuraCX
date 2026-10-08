package com.omni.obd.examples;

import com.omni.obd.OBDApiException;
import com.omni.obd.OBDClient;
import com.omni.obd.model.CallEvents;
import com.omni.obd.model.CallRequest;
import com.omni.obd.model.CallResponse;
import com.omni.obd.model.StreamConfig;
import io.github.cdimascio.dotenv.Dotenv;

import java.util.Map;

/**
 * Set these environment variables before running this example:
 *   OBD_API_BASE_URL, OBD_CLIENT_ID, OBD_API_KEY
 */


public class BasicUsage {

    public static void main(String[] args) {

        OBDClient client = new OBDClient.Builder()
                .baseUrl("BASE_URL")
                .clientId("CLIENT_ID")
                .apiKey("API_KEY")
                .build();

        CallRequest request = new CallRequest.Builder()
                .fromNumber("+91XXXXXXXXXX")
                .toNumber("+91XXXXXXXXXX")
                .dialRequestExpiry(30)
                .refId("XXXXXX")
                .timeout(30)
                .nextActionByApi(false)
                .nextActionUrl("http://your-ivr-server.example.com/ivr/webhook")
                .stream(new StreamConfig.Builder()
                        .enabled(true)
                        .record(true)
                        .streamUrl("ws://192.X.X.X:3031")
                        .duration(10)
                        .chunkSize(1600)
                        .startPhase("answered")
                        .customParam(Map.of("customer_id", "CUST10001", "order_id", "ORD89231"))
                        .build())
                .callEventsWebhook("http://X.Y.Z.70/ApiTester/api/postdata")
                .callEvents(CallEvents.all())
                .build();

        try {
            CallResponse response = client.initiateCall(request);
            System.out.println("Call initiated: " + response);
        } catch (OBDApiException e) {
            System.err.println("OBD API error (status " + e.getStatusCode() + "): " + e.getMessage());
            System.err.println(e.getResponseBody());
        }
    }
}
