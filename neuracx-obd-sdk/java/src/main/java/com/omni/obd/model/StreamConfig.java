package com.omni.obd.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/** Live audio streaming / recording configuration for a call. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class StreamConfig {

    /** Turn audio streaming on/off for this call. */
    @JsonProperty("enabled")
    private Boolean enabled;

    /** Also persist the audio as a recording, not just stream it live. */
    @JsonProperty("record")
    private Boolean record;

    /** Your WebSocket endpoint that receives the audio, e.g. "ws://media.example.com:3031". */
    @JsonProperty("stream_url")
    private String streamUrl;

    /** Max streaming duration in seconds. */
    @JsonProperty("duration")
    private Integer duration;

    /** Size in bytes of each audio chunk sent over the WebSocket. */
    @JsonProperty("chunk_size")
    private Integer chunkSize;

    /** "ringing" or "answered" — when streaming should begin. */
    @JsonProperty("start_phase")
    private String startPhase;

    /** Free-form metadata echoed back to your WebSocket server. */
    @JsonProperty("custom_param")
    private Map<String, String> customParam;

    public static class Builder {
        private final StreamConfig config = new StreamConfig();

        public Builder enabled(boolean enabled) {
            config.enabled = enabled;
            return this;
        }

        public Builder record(boolean record) {
            config.record = record;
            return this;
        }

        public Builder streamUrl(String streamUrl) {
            config.streamUrl = streamUrl;
            return this;
        }

        public Builder duration(int duration) {
            config.duration = duration;
            return this;
        }

        public Builder chunkSize(int chunkSize) {
            config.chunkSize = chunkSize;
            return this;
        }

        public Builder startPhase(String startPhase) {
            config.startPhase = startPhase;
            return this;
        }

        public Builder customParam(Map<String, String> customParam) {
            config.customParam = customParam;
            return this;
        }

        public StreamConfig build() {
            return config;
        }
    }
}
