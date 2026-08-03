'use strict';

/** Thrown when a request is built with missing/invalid parameters, before any network call is made. */
class OBDValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OBDValidationError';
  }
}

/** Thrown when the OBD API itself returns a non-2xx response, or the request fails on the network. */
class OBDApiError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode - HTTP status code, or 0 for network-level failures
   * @param {object|null} responseBody - parsed JSON body returned by the API, if any
   */
  constructor(message, statusCode, responseBody) {
    super(message);
    this.name = 'OBDApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

module.exports = { OBDValidationError, OBDApiError };
