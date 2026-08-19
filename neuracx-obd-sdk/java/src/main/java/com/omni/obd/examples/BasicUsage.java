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
    static Dotenv dotenv = Dotenv.configure()
            .directory("./")
            .load();

    public static void main(String[] args) {

        OBDClient client = new OBDClient.Builder()
                .baseUrl(dotenv.get("OBD_API_BASE_URL"))
                .clientId(dotenv.get("OBD_CLIENT_ID"))
                .apiKey(dotenv.get("OBD_API_KEY"))
                .build();

        CallRequest request = new CallRequest.Builder()
                .fromNumber("+9104847189769")
                .toNumber("+916238330634")
                .dialRequestExpiry(10)
                .refId(6565)
                .timeout(30)
                .nextActionByApi(false)
                .nextActionUrl("http://your-ivr-server.example.com/ivr/webhook")
                .stream(new StreamConfig.Builder()
                        .enabled(true)
                        .record(true)
                        .streamUrl("ws://your-media-server.example.com:3031")
                        .duration(10)
                        .chunkSize(1600)
                        .startPhase("ringing")
                        .customParam(Map.of("customer_id", "CUST10001", "order_id", "ORD89231"))
                        .build())
                .pingbackUrl("http://your-server.example.com/api/postdata")
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
