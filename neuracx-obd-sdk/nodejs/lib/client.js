'use strict';

const { OBDApiError, OBDValidationError } = require('./errors');

/**
 * @typedef {Object} StreamConfig
 * @property {boolean} enabled - turn live/recorded audio streaming on or off for this call
 * @property {boolean} [record] - also persist the audio as a recording, not just stream it live
 * @property {string} streamUrl - websocket endpoint that will receive the audio, e.g. "ws://media.example.com:3031"
 * @property {number} [duration] - max streaming duration in seconds
 * @property {number} [chunkSize] - size, in bytes, of each audio chunk sent over the websocket
 * @property {('ringing'|'answered')} [startPhase] - call phase at which streaming should begin
 * @property {Object.<string,string>} [customParam] - free-form key/value metadata echoed back to your websocket server
 */

/**
 * @typedef {Object} CallEvents
 * @property {boolean} [initiated] - notify when the call leg is created
 * @property {boolean} [ringing] - notify when the destination starts ringing
 * @property {boolean} [answered] - notify when the destination answers
 * @property {boolean} [completed] - notify when the call ends normally
 * @property {boolean} [failed] - notify when the call could not be connected
 * @property {boolean} [expired] - notify when the dial request expires before connecting
 */

/**
 * @typedef {Object} InitiateCallRequest
 * @property {string} fromNumber - caller id shown to the destination, E.164 format e.g. "+9104847189769"
 * @property {string} toNumber - destination number to dial, E.164 format
 * @property {number} [dialRequestExpiry] - seconds after which the dial *request* itself is abandoned if not yet placed
 * @property {(number|string)} [refId] - your own reference id, echoed back in callbacks so you can correlate them to this call
 * @property {number} [timeout] - how long to let the destination ring, in seconds, before giving up
 * @property {boolean} [nextActionByApi] - true if your server will decide the next IVR action via API, rather than a static flow
 * @property {string} [nextActionUrl] - webhook the platform calls to ask "what should happen next" during the call
 * @property {StreamConfig} [stream] - live audio streaming / recording configuration
 * @property {string} [pingbackUrl] - webhook that receives call status callbacks (see call_events below)
 * @property {CallEvents} [callEvents] - which lifecycle events should trigger a callback to pingbackUrl
 */

const TOP_LEVEL_FIELD_MAP = {
  fromNumber: 'from_number',
  toNumber: 'to_number',
  dialRequestExpiry: 'dial_request_expiry',
  refId: 'ref_id',
  timeout: 'timeout',
  nextActionByApi: 'next_action_by_api',
  nextActionUrl: 'next_action_url',
  pingbackUrl: 'pingback_url',
};

const STREAM_FIELD_MAP = {
  enabled: 'enabled',
  record: 'record',
  streamUrl: 'stream_url',
  duration: 'duration',
  chunkSize: 'chunk_size',
  startPhase: 'start_phase',
  customParam: 'custom_param',
};

class OBDClient {
  /**
   * @param {Object} config
   * @param {string} config.baseUrl - the base URL of your OBD API instance, e.g. "https://obd.yourdomain.com" (no trailing slash needed)
   * @param {string} config.clientId - your account's client id, sent as the `x-client-id` header
   * @param {string} config.apiKey - your account's API key, sent as the `x-api-key` header
   * @param {number} [config.requestTimeoutMs=15000] - abort the HTTP request if no response within this time
   */
  constructor({ baseUrl, clientId, apiKey, requestTimeoutMs = 15000 } = {}) {
    if (!baseUrl) throw new OBDValidationError('baseUrl is required');
    if (!clientId) throw new OBDValidationError('clientId is required');
    if (!apiKey) throw new OBDValidationError('apiKey is required');

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientId = clientId;
    this.apiKey = apiKey;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Initiate an outbound dial (OBD) call.
   *
   * @param {InitiateCallRequest} request
   * @returns {Promise<{status: string, message: string, request_id: number, timestamp: string}>}
   * @throws {OBDValidationError} if fromNumber/toNumber are missing
   * @throws {OBDApiError} if the API rejects the request or a network error occurs
   */
  async initiateCall(request) {
    if (!request || !request.fromNumber || !request.toNumber) {
      throw new OBDValidationError('fromNumber and toNumber are required');
    }

    const payload = this._buildPayload(request);
    return this._post('/api/obd/calls', payload);
  }

  _buildPayload(request) {
    const payload = {};

    for (const [camelKey, wireKey] of Object.entries(TOP_LEVEL_FIELD_MAP)) {
      if (request[camelKey] !== undefined) payload[wireKey] = request[camelKey];
    }

    if (request.stream) {
      const stream = {};
      for (const [camelKey, wireKey] of Object.entries(STREAM_FIELD_MAP)) {
        if (request.stream[camelKey] !== undefined) stream[wireKey] = request.stream[camelKey];
      }
      payload.stream = stream;
    }

    if (request.callEvents) {
      payload.call_events = { ...request.callEvents };
    }

    return payload;
  }

  async _post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.clientId,
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new OBDApiError(`Network error calling ${path}: ${err.message}`, 0, null);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      throw new OBDApiError(
        json.message || `OBD API request failed with status ${res.status}`,
        res.status,
        json
      );
    }

    return json;
  }
}

module.exports = { OBDClient };
