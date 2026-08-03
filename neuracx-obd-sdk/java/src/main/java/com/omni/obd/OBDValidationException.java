package com.omni.obd;

/**
 * Thrown when a request is built with missing/invalid parameters, before any network call is made.
 */
public class OBDValidationException extends RuntimeException {
    public OBDValidationException(String message) {
        super(message);
    }
}
