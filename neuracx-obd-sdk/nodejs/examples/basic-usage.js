'use strict';

// Set these in your environment before running this example:
//   OBD_API_BASE_URL, OBD_CLIENT_ID, OBD_API_KEY
const { OBDClient, OBDApiError } = require('omni-obd-sdk');

const client = new OBDClient({
  baseUrl: process.env.OBD_API_BASE_URL,
  clientId: process.env.OBD_CLIENT_ID,
  apiKey: process.env.OBD_API_KEY,
});

async function main() {
  try {
    const response = await client.initiateCall({
      fromNumber: '+9104847189769',
      toNumber: '+916238330634',
      dialRequestExpiry: 10,
      refId: 6565,
      timeout: 30,
      nextActionByApi: false,
      nextActionUrl: 'http://your-ivr-server.example.com/ivr/webhook',
      stream: {
        enabled: true,
        record: true,
        streamUrl: 'ws://your-media-server.example.com:3031',
        duration: 10,
        chunkSize: 1600,
        startPhase: 'ringing',
        customParam: {
          customerId: 'CUST10001',
          orderId: 'ORD89231',
        },
      },
      pingbackUrl: 'http://your-server.example.com/api/postdata',
      callEvents: {
        initiated: true,
        ringing: true,
        answered: true,
        completed: true,
        failed: true,
        expired: true,
      },
    });

    console.log('Call initiated:', response);
  } catch (err) {
    if (err instanceof OBDApiError) {
      console.error(`OBD API error (status ${err.statusCode}):`, err.message, err.responseBody);
    } else {
      throw err;
    }
  }
}

main();
