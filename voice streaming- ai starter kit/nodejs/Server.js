import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { GoogleGenAI, Modality, Type } from "@google/genai";


function timestamp() {
  return new Date().toTimeString().slice(0, 8); // "HH:MM:SS"
}
const log = {
  info: (msg, ...args) => console.log(`${timestamp()} [INFO] main | ${format(msg, args)}`),
  debug: () => {}, // no-op — only INFO (and above) is printed
  warning: (msg, ...args) => console.warn(`${timestamp()} [WARNING] main | ${format(msg, args)}`),
  error: (msg, ...args) => console.error(`${timestamp()} [ERROR] main | ${format(msg, args)}`),
  critical: (msg, ...args) => console.error(`${timestamp()} [CRITICAL] main | ${format(msg, args)}`),
  exception: (msg, err) => console.error(`${timestamp()} [ERROR] main | ${msg}: ${err?.stack || err}`),
};
// Very small %s / %d substitution helper so call sites can stay close to the
// original `log.info("... %s ...", value)` style.
function format(msg, args) {
  let i = 0;
  return String(msg).replace(/%[sd]/g, () => (i < args.length ? args[i++] : ""));
}

// ── audio config ─────────────────────────────────────────────────────────────
const GEMINI_INPUT_RATE = parseInt(process.env.GEMINI_INPUT_RATE || "16000", 10);
const GEMINI_OUTPUT_RATE = parseInt(process.env.GEMINI_OUTPUT_RATE || "24000", 10);
const CLIENT_SEND_RATE = parseInt(process.env.CLIENT_SEND_RATE || "8000", 10);
const CLIENT_RECV_RATE = parseInt(process.env.CLIENT_RECV_RATE || "8000", 10);

// ── app config ───────────────────────────────────────────────────────────────
const API_KEY = "YOUR API KEY";
const MODEL_ID = "gemini-3.1-flash-live-preview";

if (!API_KEY) {
  log.critical("GEMINI_API_KEY is not set! Export it before starting the server.");
} else {
  log.info("GEMINI_API_KEY loaded (length=%d)", API_KEY.length);
}

log.info(
  "Model: %s | client_in=%dHz→gemini=%dHz | gemini_out=%dHz→client=%dHz",
  MODEL_ID, CLIENT_SEND_RATE, GEMINI_INPUT_RATE, GEMINI_OUTPUT_RATE, CLIENT_RECV_RATE
);

// ── timezone helper (Asia/Kolkata, no DST) ──────────────────────────────────
// Node's Intl/ICU build always knows fixed-offset zones like Asia/Kolkata,
// but we still fall back to a manual UTC+5:30 shift just in case, mirroring
// the Python try/except around zoneinfo.
function nowInIndia() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return {
      weekday: get("weekday"),
      day: get("day"),
      month: get("month"),
      year: get("year"),
    };
  } catch {
    // Fixed UTC+5:30 offset fallback — India doesn't observe DST.
    const utcMs = Date.now();
    const ist = new Date(utcMs + (5 * 60 + 30) * 60 * 1000);
    const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return {
      weekday: weekdayNames[ist.getUTCDay()],
      day: String(ist.getUTCDate()).padStart(2, "0"),
      month: monthNames[ist.getUTCMonth()],
      year: String(ist.getUTCFullYear()),
    };
  }
}

// ── resampling helpers ───────────────────────────────────────────────────────
/**
 * Resample raw signed-16-bit little-endian PCM from fromRate to toRate.
 * Linear interpolation — cheap and good enough for voice.
 * Takes and returns a Buffer in the same int16-LE format.
 */
function resamplePcm(pcmBuffer, fromRate, toRate) {
  if (fromRate === toRate) return pcmBuffer;

  const samples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.length / 2)
  );
  const oldLen = samples.length;
  const newLen = Math.round((oldLen * toRate) / fromRate);
  const out = new Int16Array(newLen);

  for (let i = 0; i < newLen; i++) {
    const oldIndex = newLen > 1 ? (i * (oldLen - 1)) / (newLen - 1) : 0;
    const idxFloor = Math.floor(oldIndex);
    const idxCeil = Math.min(idxFloor + 1, oldLen - 1);
    const frac = oldIndex - idxFloor;

    const interpolated = samples[idxFloor] + frac * (samples[idxCeil] - samples[idxFloor]);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(interpolated)));
  }

  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

// ── tool ─────────────────────────────────────────────────────────────────────
// NOTE: This is NOT a database lookup or availability check. It performs no
// external calls at all. Its only purpose is to let the model hand back the
// booking details it has already collected and verbally confirmed with the
// caller, in a clean structured form, so the server can emit the exit event.
const confirmBookingTool = {
  functionDeclarations: [
    {
      name: "confirm_booking",
      description:
        "Call this ONLY after you have collected and verbally confirmed " +
        "all booking details with the caller (patient name, doctor name, " +
        "day, date, time). This does not check availability or touch any " +
        "database — it simply finalizes the booking with the details you " +
        "already agreed on with the caller.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          patient_name: { type: Type.STRING, description: "Full name of the patient" },
          dr_name: { type: Type.STRING, description: "Name of the doctor" },
          day: { type: Type.STRING, description: "Day of the appointment (e.g., Monday)" },
          date: { type: Type.STRING, description: "Date of the appointment (e.g., 2025-07-15)" },
          time: { type: Type.STRING, description: "Time of the appointment (e.g., 10:30 AM)" },
        },
        required: ["patient_name", "dr_name", "day", "date", "time"],
      },
    },
  ],
};

function buildSystemPrompt() {
  const { weekday, day, month, year } = nowInIndia();
  const todayStr = `${weekday}, ${day} ${month} ${year}`; // e.g. "Tuesday, 04 August 2026"
  const todayDay = weekday; // e.g. "Tuesday"

  return `You are a professional, warm, and efficient hospital receptionist managing doctor appointments. You book appointments purely based on what the caller tells you — you do not check any external schedule or database. Assume any day, date, time, and doctor the caller requests is available unless it is obviously invalid (e.g., a past date or a nonsensical time).

TODAY'S DATE: Today is ${todayStr} (${todayDay}), current time in Kerala, India (Asia/Kolkata timezone). Use this as the ground truth for "today", "tomorrow", "day after tomorrow", "this Friday", "next week", and any other relative day or date the caller mentions. Always compute the correct calendar date from this reference point.

LANGUAGE:
Speak in English, but with a natural Indian English accent — the way an English-speaking receptionist in India would sound. Keep your wording, grammar, and vocabulary in standard English; only the accent and intonation should sound Indian. If the caller speaks to you in any language other than English, respond only with: "Sorry, I can't understand your language." Then wait for them to try again in English before continuing.

CALL OPENING:
The moment the call connects, before the caller says anything, greet them with exactly this line and nothing else: "Welcome to Prudent Appointment Management System. How can I help you today?"

DOCTOR ROSTER (this is the ONLY information you have about doctors — no database, always use these exact details):
1. Dr. Aisha Sharma — Cardiologist — Available Monday to Friday, 9:00 AM to 1:00 PM
2. Dr. Rohan Mehta — Dermatologist — Available Monday, Wednesday, Friday, 2:00 PM to 6:00 PM
3. Dr. Priya Nair — Pediatrician — Available Monday to Saturday, 10:00 AM to 2:00 PM
4. Dr. Karan Verma — Orthopedic Surgeon — Available Tuesday and Thursday, 11:00 AM to 4:00 PM
5. Dr. Sneha Kapoor — General Physician — Available Monday to Saturday, 9:00 AM to 5:00 PM

When a caller asks which doctors are available, or asks about a specific doctor's timing or specialty, answer directly from this roster in a smooth spoken summary — do not say you are checking a system or database, just tell them. When booking, only accept a day and time that falls within the chosen doctor's listed availability above; if the caller requests a day or time outside that doctor's availability, let them know that doctor isn't available then and offer their actual available days and times instead.

SCOPE — STAY ON TOPIC:
You handle ONLY booking appointments. If the caller asks about anything else — medical advice, symptoms, prices unrelated to booking, general chit-chat, or any topic outside appointment booking — do not attempt to answer it. Instead say, in your own natural words, something like: "I'm an appointment booking system, I don't have that information" or "I'm an appointment booking system, I can't help with that right now." Then gently steer back by asking if they'd like to book  an appointment.

CRITICAL VOICE & TEXT-TO-SPEECH (TTS) RULES:
1. STRICTLY NO MARKDOWN FORMATTING: Never use asterisks (**), hashtags (#), numbered lists (1., 2.), or bullet points. Output text must be pure, clean prose. Markdown symbols will break the text-to-speech audio engine.
2. BREVITY IS KEY: Keep responses strictly to 1 or 2 concise sentences. The only exception is when summarizing a final booking confirmation.
3. HUMAN CONVERSATIONAL FLOW: Speak naturally. Never say things like "let me call a function" or "checking the system" — you have no system to check, you're just noting down what the caller tells you.
4. SPEAK SLOWLY AND CLEARLY: Speak noticeably slower than normal conversational pace — imagine reading each sentence out loud to someone who is writing it down by hand. Pause briefly after every comma and fully stop after every sentence before continuing. Pronounce numbers, dates, and times digit by digit and word by word rather than rushing them together (e.g., say "ten thirty AM" clearly and deliberately, not quickly). Never rush, never run sentences together, and never speed up even when the response is short.

INFORMATION GATHERING & ONE-QUESTION-AT-A-TIME RULE:
1. STEP-BY-STEP COLLECTION: Ask for only ONE missing piece of information at a time: patient name, then doctor name, then day, then date, then time (or whatever order feels natural). Never ask multiple questions at once.
2. VERIFICATION: Before finalizing, read back all the details (patient name, doctor, day, date, time) and ask the caller to confirm they are correct.

FINALIZING A BOOKING:
1. Only once the caller has verbally confirmed all details are correct, call confirm_booking with the exact details agreed on.
2. Immediately after, warmly thank the caller by name for booking with us and let them know their appointment is confirmed. Keep it short and sincere.`;
}

function buildLiveConfig() {
  return {
    responseModalities: [Modality.AUDIO],
    // proactiveAudio / affective dialog left commented out to mirror the original
    systemInstruction: {
      parts: [{ text: buildSystemPrompt() }],
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    proactivity: {
      proactiveAudio: true,
    },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Kore",
        },
      },
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 20,
        silenceDurationMs: 200,
      },
    },
    tools: [confirmBookingTool],
  };
}

// ── app ──────────────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

log.info("=".repeat(60));
log.info("Doctor Booking Voice Assistant starting up");
log.info("Model          : %s", MODEL_ID);
log.info("Client → Server: %d Hz", CLIENT_SEND_RATE);
log.info("Server → Gemini: %d Hz", GEMINI_INPUT_RATE);
log.info("Gemini → Server: %d Hz", GEMINI_OUTPUT_RATE);
log.info("Server → Client: %d Hz", CLIENT_RECV_RATE);
log.info("API key set    : %s", Boolean(API_KEY));
log.info("=".repeat(60));

process.on("SIGINT", () => {
  log.info("Shutting down");
  process.exit(0);
});

app.get("/config", (req, res) => {
  // Returns audio rate config so the frontend can self-configure.
  res.json({
    client_send_rate: CLIENT_SEND_RATE,
    client_recv_rate: CLIENT_RECV_RATE,
    gemini_input_rate: GEMINI_INPUT_RATE,
    gemini_output_rate: GEMINI_OUTPUT_RATE,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", async (websocket, request) => {
  const clientIp = request.socket.remoteAddress || "unknown";

  // room_id can be passed as a query param, e.g. wss://.../ws?room_id=abc123
  const url = new URL(request.url, `http://${request.headers.host}`);
  const roomId = url.searchParams.get("room_id") || clientIp;

  log.info("Client connected from %s (room_id=%s)", clientIp, roomId);

  if (!API_KEY) {
    log.error("Cannot open Gemini session — GEMINI_API_KEY is empty");
    safeSend(websocket, { type: "error", message: "Server misconfiguration: GEMINI_API_KEY not set" });
    websocket.close();
    return;
  }

  log.debug("Creating Gemini client (model=%s)", MODEL_ID);

  let geminiClient;
  try {
    geminiClient = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: { apiVersion: "v1alpha" },
    });
    log.debug("Gemini client created successfully");
  } catch (e) {
    log.exception("Failed to create Gemini client", e);
    safeSend(websocket, { type: "error", message: `Gemini client error: ${e}` });
    websocket.close();
    return;
  }

  log.info("Opening Gemini Live session...");
  const sessionStart = process.hrtime.bigint();
  const liveConfig = buildLiveConfig();

  // Mutable state shared between the client->Gemini and Gemini->client sides,
  // equivalent to the `nonlocal` counters in the Python version.
  const state = {
    audioChunksSent: 0,
    audioChunksReceived: 0,
    textMessagesSent: 0,
    bookingConfirmed: false,
    pendingExitPayload: null, // set when confirm_booking fires; sent after the thank-you turn finishes
  };

  let session;
  let closed = false;

  const closeEverything = () => {
    if (closed) return;
    closed = true;
    try {
      session?.close();
    } catch {
      /* ignore */
    }
    try {
      websocket.close();
    } catch {
      /* ignore */
    }
  };

  try {
    session = await geminiClient.live.connect({
      model: MODEL_ID,
      config: liveConfig,
      callbacks: {
        onopen: () => {
          const elapsedS = Number(process.hrtime.bigint() - sessionStart) / 1e9;
          log.info("Gemini session opened in %ss", elapsedS.toFixed(2));
          // NOTE: the kickoff greeting is sent right after `connect()` resolves
          // below, not here — `session` isn't assigned yet at the moment this
          // fires, since onopen can run before the outer `await` returns.
        },

        onmessage: async (response) => {
          try {
            // ── booking confirmation (no DB, no availability check) ──
            if (response.toolCall) {
              for (const fc of response.toolCall.functionCalls || []) {
                if (fc.name === "confirm_booking") {
                  const exitPayload = { ...fc.args };
                  state.bookingConfirmed = true;

                  log.info("Booking confirmed via prompt: %s", JSON.stringify(exitPayload));

                  // Tell Gemini the call succeeded so it can proceed
                  // to thank the caller as instructed in the prompt.
                  session.sendToolResponse({
                    functionResponses: [
                      { id: fc.id, name: fc.name, response: { status: "success" } },
                    ],
                  });

                  // Don't emit the exit event yet — the model still
                  // needs to speak its thank-you message as part of
                  // this same turn. We send it once turnComplete
                  // fires below, so the thank-you audio plays first.
                  state.pendingExitPayload = exitPayload;
                } else {
                  log.warning("Unknown tool requested: %s", fc.name);
                  session.sendToolResponse({
                    functionResponses: [
                      { id: fc.id, name: fc.name, response: { status: "unknown_tool" } },
                    ],
                  });
                }
              }
            }

            // ── audio / transcript / turn ───────────────────
            const sc = response.serverContent;
            if (sc) {
              if (sc.interrupted) {
                log.info("Barge-in detected — generation interrupted");
                safeSend(websocket, { event: "clear", room_id: roomId });
              }

              if (sc.inputTranscription?.text) {
                safeSend(websocket, {
                  type: "transcript",
                  role: "user",
                  text: sc.inputTranscription.text,
                });
              }

              if (sc.outputTranscription?.text) {
                safeSend(websocket, {
                  type: "transcript",
                  role: "assistant",
                  text: sc.outputTranscription.text,
                });
              }

              if (sc.modelTurn) {
                for (const part of sc.modelTurn.parts || []) {
                  if (part.inlineData) {
                    const rawAudio = Buffer.from(part.inlineData.data, "base64");
                    const downsampled = resamplePcm(rawAudio, GEMINI_OUTPUT_RATE, CLIENT_RECV_RATE);
                    const audioB64 = downsampled.toString("base64");
                    state.audioChunksReceived += 1;

                    log.debug(
                      "Audio chunk #%d: %d bytes @ %dHz → %d bytes @ %dHz → client",
                      state.audioChunksReceived, rawAudio.length, GEMINI_OUTPUT_RATE,
                      downsampled.length, CLIENT_RECV_RATE
                    );
                    safeSend(websocket, { event: "media", media: { payload: audioB64 } });
                  }
                }
              }

              if (sc.turnComplete) {
                safeSend(websocket, { type: "turn_complete" });

                // The thank-you turn has now fully finished streaming
                // to the client — safe to send the exit event.
                if (state.pendingExitPayload !== null) {
                  safeSend(websocket, {
                    event: "exit",
                    room_id: roomId,
                    exit: { parameters: state.pendingExitPayload },
                  });
                  log.info("Exit event sent for room_id=%s: %s", roomId, JSON.stringify(state.pendingExitPayload));
                  state.pendingExitPayload = null;

                  // Booking is done and the caller has been thanked —
                  // end the call now instead of waiting indefinitely.
                  log.info("Booking complete — closing call for room_id=%s", roomId);
                  closeEverything();
                }
              }
            }
          } catch (e) {
            log.exception("Error handling Gemini message", e);
            safeSend(websocket, { type: "error", message: String(e) });
          }
        },

        onerror: (e) => {
          log.exception("Gemini session error", e);
          safeSend(websocket, { type: "error", message: `Gemini session error: ${e?.message || e}` });
        },

        onclose: (e) => {
          log.info("Gemini session closed for client %s", clientIp);
        },
      },
    });
  } catch (e) {
    log.exception("Failed to open or maintain Gemini session", e);
    safeSend(websocket, { type: "error", message: `Gemini session error: ${e}` });
    return;
  }

  // Trigger the opening greeting immediately — don't wait for the caller to
  // speak first. This turn is never shown to the caller, it just prompts the
  // model to say the greeting from the prompt. Sent here (rather than inside
  // onopen) because `session` is only assigned once connect() resolves.
  try {
    session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text: "(The call has just connected. Greet the caller now.)" }],
        },
      ],
      turnComplete: true,
    });
    log.info("Sent kickoff turn to trigger opening greeting");
  } catch (e) {
    log.exception("Failed to send kickoff greeting turn", e);
  }

  // ── client -> Gemini ──────────────────────────────────────────────────────
  websocket.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (e) {
      log.warning("Received non-JSON message from client");
      return;
    }

    const msgType = payload.event;

    try {
      if (msgType === "media") {
        let rawPcm = Buffer.from(payload.media?.payload || "", "base64");
        if (rawPcm.length % 2 !== 0) {
          rawPcm = Buffer.concat([rawPcm, Buffer.from([0x00])]); // Pad with one zero byte
        }

        const upsampled = resamplePcm(rawPcm, CLIENT_SEND_RATE, GEMINI_INPUT_RATE);
        state.audioChunksSent += 1;
        if (state.audioChunksSent % 50 === 0) {
          log.debug(
            "Audio chunk #%d: %d bytes @ %dHz → %d bytes @ %dHz → Gemini",
            state.audioChunksSent, rawPcm.length, CLIENT_SEND_RATE,
            upsampled.length, GEMINI_INPUT_RATE
          );
        }
        session.sendRealtimeInput({
          audio: { data: upsampled.toString("base64"), mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}` },
        });
      } else if (msgType === "text") {
        const userText = (payload.data || "").trim();
        if (!userText) return;
        state.textMessagesSent += 1;
        log.info("Text message #%d from client: %s", state.textMessagesSent, userText);
        session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: userText }] }],
          turnComplete: true,
        });
      } else if (msgType === "stop") {
        log.info("Client requested stop after %d audio chunks sent", state.audioChunksSent);
        closeEverything();
      } else {
        log.warning("Unknown message type from client: %s", msgType);
      }
    } catch (e) {
      log.exception("Error in client message handler", e);
    }
  });

  websocket.on("close", () => {
    log.info("Client disconnected after %d audio chunks", state.audioChunksSent);
    closeEverything();
  });

  websocket.on("error", (e) => {
    log.exception("WebSocket error", e);
  });
});

function safeSend(websocket, obj) {
  try {
    if (websocket.readyState === websocket.OPEN) {
      websocket.send(JSON.stringify(obj));
    }
  } catch {
    /* ignore — socket may already be closing */
  }
}

const PORT = process.env.PORT || 8765;
httpServer.listen(PORT, "0.0.0.0", () => {
  log.info("Server listening on 0.0.0.0:%d", PORT);
});