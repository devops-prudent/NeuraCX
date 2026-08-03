package com.omni.obd.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Controls which call lifecycle events trigger a callback to pingbackUrl. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class CallEvents {

    @JsonProperty("initiated")
    private Boolean initiated;

    @JsonProperty("ringing")
    private Boolean ringing;

    @JsonProperty("answered")
    private Boolean answered;

    @JsonProperty("completed")
    private Boolean completed;

    @JsonProperty("failed")
    private Boolean failed;

    @JsonProperty("expired")
    private Boolean expired;

    /** Convenience factory that enables every event. */
    public static CallEvents all() {
        return new Builder()
                .initiated(true)
                .ringing(true)
                .answered(true)
                .completed(true)
                .failed(true)
                .expired(true)
                .build();
    }

    public static class Builder {
        private final CallEvents events = new CallEvents();

        public Builder initiated(boolean value) {
            events.initiated = value;
            return this;
        }

        public Builder ringing(boolean value) {
            events.ringing = value;
            return this;
        }

        public Builder answered(boolean value) {
            events.answered = value;
            return this;
        }

        public Builder completed(boolean value) {
            events.completed = value;
            return this;
        }

        public Builder failed(boolean value) {
            events.failed = value;
            return this;
        }

        public Builder expired(boolean value) {
            events.expired = value;
            return this;
        }

        public CallEvents build() {
            return events;
        }
    }
}
