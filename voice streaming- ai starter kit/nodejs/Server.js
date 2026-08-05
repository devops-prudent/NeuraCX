
import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { URL } from "node:url";
import { GoogleGenAI, Modality, Type } from "@google/genai";
 
// ── logging ──────────────────────────────────────────────────────────────
function timestamp() {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}
const log = {
  debug: (...a) => console.debug(`${timestamp()} [DEBUG] main |`, ...a),
  info: (...a) => console.info(`${timestamp()} [INFO] main |`, ...a),
  warn: (...a) => console.warn(`${timestamp()} [WARNING] main |`, ...a),
  error: (...a) => console.error(`${timestamp()} [ERROR] main |`, ...a),
  exception: (...a) => console.error(`${timestamp()} [ERROR] main |`, ...a),
};
 
// ── audio config ─────────────────────────────────────────────────────────
const GEMINI_INPUT_RATE = parseInt(process.env.GEMINI_INPUT_RATE || "16000", 10);
const GEMINI_OUTPUT_RATE = parseInt(process.env.GEMINI_OUTPUT_RATE || "24000", 10);
const CLIENT_SEND_RATE = parseInt(process.env.CLIENT_SEND_RATE || "8000", 10);
const CLIENT_RECV_RATE = parseInt(process.env.CLIENT_RECV_RATE || "8000", 10);
 
// ── app config ───────────────────────────────────────────────────────────
const API_KEY =  "YOUR API KEY";
const MODEL_ID = "gemini-3.1-flash-live-preview";
 
if (!API_KEY || API_KEY === "YOUR API KEY") {
  log.error("GEMINI_API_KEY is not set! Export it before starting the server.");
} else {
  log.info(`GEMINI_API_KEY loaded (length=${API_KEY.length})`);
}
 
log.info(
  `Model: ${MODEL_ID} | client_in=${CLIENT_SEND_RATE}Hz→gemini=${GEMINI_INPUT_RATE}Hz | ` +
    `gemini_out=${GEMINI_OUTPUT_RATE}Hz→client=${CLIENT_RECV_RATE}Hz`
);
 
// ── resampling helpers ───────────────────────────────────────────────────
/**
 * Resample raw signed 16-bit little-endian PCM from fromRate to toRate using
 * linear interpolation — cheap and good enough for voice. Mirrors the numpy
 * implementation in the original Python service.
 * @param {Buffer} pcmBuffer
 * @param {number} fromRate
 * @param {number} toRate
 * @returns {Buffer}
 */
function resamplePcm(pcmBuffer, fromRate, toRate) {
  if (fromRate === toRate) return pcmBuffer;
 
  const samples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.length / 2)
  );
  const oldLen = samples.length;
  if (oldLen === 0) return Buffer.alloc(0);
 
  const newLen = Math.max(1, Math.round((oldLen * toRate) / fromRate));
  const out = new Int16Array(newLen);
 
  const scale = oldLen > 1 ? (oldLen - 1) / Math.max(1, newLen - 1) : 0;
 
  for (let i = 0; i < newLen; i++) {
    const oldIndex = i * scale;
    const idxFloor = Math.floor(oldIndex);
    const idxCeil = Math.min(idxFloor + 1, oldLen - 1);
    const frac = oldIndex - idxFloor;
 
    const interpolated =
      samples[idxFloor] + frac * (samples[idxCeil] - samples[idxFloor]);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(interpolated)));
  }
 
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}
 
// ── tool ─────────────────────────────────────────────────────────────────
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
 
// ── prompt / config builders ────────────────────────────────────────────
function buildSystemPrompt() {
  const now = new Date();
  const fmtLong = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const fmtWeekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  });
 
  // e.g. "Tuesday, 04 August 2026"
  const parts = fmtLong.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const todayStr = `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
  const todayDay = fmtWeekday.format(now);
 
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
You handle ONLY booking, rescheduling, and canceling doctor appointments. If the caller asks about anything else — medical advice, symptoms, prices unrelated to booking, general chit-chat, or any topic outside appointment booking — do not attempt to answer it. Instead say, in your own natural words, something like: "I'm an appointment booking system, I don't have that information" or "I'm an appointment booking system, I can't help with that right now." Then gently steer back by asking if they'd like to book, reschedule, or cancel an appointment.
 
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
        startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 100,
        silenceDurationMs: 400,
      },
    },
    tools: [confirmBookingTool],
  };
}
 
// A single GoogleGenAI client can safely be reused across concurrent Live
// sessions — it holds no per-call state, it's just a thin request factory.
const genaiClient = new GoogleGenAI({
  apiKey: API_KEY,
  httpOptions: { apiVersion: "v1alpha" },
});
 
// ── HTTP app ─────────────────────────────────────────────────────────────
const app = express();
 
app.get("/config", (req, res) => {
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
 
const server = http.createServer(app);
 
// ── WebSocket bridge ─────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
 
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);
  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});
 
wss.on("connection", async (clientWs, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const clientIp = request.socket.remoteAddress || "unknown";
  const roomId = url.searchParams.get("room_id") || clientIp;
 
  log.info(`Client connected from ${clientIp} (room_id=${roomId})`);
 
  if (!API_KEY || API_KEY === "YOUR API KEY") {
    log.error("Cannot open Gemini session — GEMINI_API_KEY is empty");
    safeSend(clientWs, { type: "error", message: "Server misconfiguration: GEMINI_API_KEY not set" });
    clientWs.close();
    return;
  }
 
  // ── per-connection state (isolated per caller — safe for concurrency) ──
  let audioChunksSent = 0;
  let audioChunksReceived = 0;
  let textMessagesSent = 0;
  let bookingConfirmed = false;
  let pendingExitPayload = null;
  let session = null;
  let closed = false;
 
  function safeSend(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch (e) {
        log.exception(`[${roomId}] failed to send to client:`, e);
      }
    }
  }
 
  async function closeCall() {
    if (closed) return;
    closed = true;
    try {
      if (session) session.close();
    } catch (e) {
      log.debug(`[${roomId}] error closing gemini session:`, e?.message);
    }
    try {
      clientWs.close();
    } catch {
      /* noop */
    }
  }
 
  async function handleGeminiMessage(message) {
    try {
      // ── tool call: confirm_booking (no DB, no availability check) ──
      if (message.toolCall && message.toolCall.functionCalls) {
        for (const fc of message.toolCall.functionCalls) {
          if (fc.name === "confirm_booking") {
            const exitPayload = { ...fc.args };
            bookingConfirmed = true;
            log.info(`[${roomId}] Booking confirmed via prompt:`, exitPayload);
 
            await session.sendToolResponse({
              functionResponses: [
                { id: fc.id, name: fc.name, response: { status: "success" } },
              ],
            });
 
            // Don't emit the exit event yet — the model still needs to speak
            // its thank-you message as part of this same turn. We send it
            // once turnComplete fires below, so the thank-you audio plays first.
            pendingExitPayload = exitPayload;
          } else {
            log.warn(`[${roomId}] Unknown tool requested:`, fc.name);
            await session.sendToolResponse({
              functionResponses: [
                { id: fc.id, name: fc.name, response: { status: "unknown_tool" } },
              ],
            });
          }
        }
      }
 
      // ── audio / transcript / turn ───────────────────
      const sc = message.serverContent;
      if (sc) {
        if (sc.interrupted) {
          log.info(`[${roomId}] Barge-in detected — generation interrupted`);
          safeSend(clientWs, { type: "interrupted" });
        }
 
        if (sc.inputTranscription && sc.inputTranscription.text) {
          safeSend(clientWs, {
            type: "transcript",
            role: "user",
            text: sc.inputTranscription.text,
          });
        }
 
        if (sc.outputTranscription && sc.outputTranscription.text) {
          safeSend(clientWs, {
            type: "transcript",
            role: "assistant",
            text: sc.outputTranscription.text,
          });
        }
 
        if (sc.modelTurn && sc.modelTurn.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData && part.inlineData.data) {
              const rawAudio = Buffer.from(part.inlineData.data, "base64");
              const downsampled = resamplePcm(rawAudio, GEMINI_OUTPUT_RATE, CLIENT_RECV_RATE);
              const audioB64 = downsampled.toString("base64");
              audioChunksReceived += 1;
 
              if (audioChunksReceived % 50 === 0) {
                log.debug(
                  `[${roomId}] Audio chunk #${audioChunksReceived}: ${rawAudio.length} bytes @ ${GEMINI_OUTPUT_RATE}Hz → ${downsampled.length} bytes @ ${CLIENT_RECV_RATE}Hz → client`
                );
              }
 
              safeSend(clientWs, { event: "media", media: { payload: audioB64 } });
            }
          }
        }
 
        if (sc.turnComplete) {
          safeSend(clientWs, { type: "turn_complete" });
 
          // The thank-you turn has now fully finished streaming to the
          // client — safe to send the exit event.
          if (pendingExitPayload !== null) {
            safeSend(clientWs, {
              event: "exit",
              room_id: roomId,
              exit: { parameters: pendingExitPayload },
            });
            log.info(`[${roomId}] Exit event sent:`, pendingExitPayload);
            pendingExitPayload = null;
 
            // Booking is done and the caller has been thanked — end the
            // call now instead of waiting indefinitely.
            log.info(`[${roomId}] Booking complete — closing call`);
            await closeCall();
          }
        }
      }
    } catch (e) {
      log.exception(`[${roomId}] Error handling Gemini message:`, e);
    }
  }
 
  log.debug(`[${roomId}] Creating Gemini Live session (model=${MODEL_ID})`);
  const sessionStart = Date.now();
 
  try {
    session = await genaiClient.live.connect({
      model: MODEL_ID,
      config: buildLiveConfig(),
      callbacks: {
        onopen: () => {
          const elapsed = ((Date.now() - sessionStart) / 1000).toFixed(2);
          log.info(`[${roomId}] Gemini session opened in ${elapsed}s`);
        },
        onmessage: (message) => {
          handleGeminiMessage(message);
        },
        onerror: (e) => {
          log.exception(`[${roomId}] Gemini session error:`, e?.message || e);
          safeSend(clientWs, { type: "error", message: `Gemini session error: ${e?.message || e}` });
        },
        onclose: (e) => {
          log.info(`[${roomId}] Gemini session closed: ${e?.reason || ""}`);
        },
      },
    });
  } catch (e) {
    log.exception(`[${roomId}] Failed to open Gemini session:`, e);
    safeSend(clientWs, { type: "error", message: `Gemini session error: ${e}` });
    clientWs.close();
    return;
  }
 
  // Kickoff turn to trigger the opening greeting, mirroring the Python service.
  try {
    await session.sendClientContent({
      turns: { role: "user", parts: [{ text: "(The call has just connected. Greet the caller now.)" }] },
      turnComplete: true,
    });
    log.info(`[${roomId}] Sent kickoff turn to trigger opening greeting`);
  } catch (e) {
    log.exception(`[${roomId}] Failed to send kickoff greeting turn:`, e);
  }
 
  // ── inbound: browser/telephony client → Gemini ─────────────────────────
  clientWs.on("message", async (raw) => {
    if (closed) return;
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (e) {
      log.warn(`[${roomId}] Received non-JSON message from client, ignoring`);
      return;
    }
 
    const msgType = payload.event;
 
    try {
      if (msgType === "media") {
        let rawPcm = Buffer.from(payload.media?.payload || "", "base64");
        if (rawPcm.length % 2 !== 0) {
          rawPcm = Buffer.concat([rawPcm, Buffer.from([0x00])]); // pad with one zero byte
        }
 
        const upsampled = resamplePcm(rawPcm, CLIENT_SEND_RATE, GEMINI_INPUT_RATE);
        audioChunksSent += 1;
 
        if (audioChunksSent % 50 === 0) {
          log.debug(
            `[${roomId}] Audio chunk #${audioChunksSent}: ${rawPcm.length} bytes @ ${CLIENT_SEND_RATE}Hz → ${upsampled.length} bytes @ ${GEMINI_INPUT_RATE}Hz → Gemini`
          );
        }
 
        await session.sendRealtimeInput({
          audio: {
            data: upsampled.toString("base64"),
            mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
          },
        });
      } else if (msgType === "text") {
        const userText = (payload.data || "").trim();
        if (!userText) return;
        textMessagesSent += 1;
        log.info(`[${roomId}] Text message #${textMessagesSent} from client: ${userText}`);
        await session.sendClientContent({
          turns: { role: "user", parts: [{ text: userText }] },
          turnComplete: true,
        });
      } else if (msgType === "stop") {
        log.info(`[${roomId}] Client requested stop after ${audioChunksSent} audio chunks sent`);
        await closeCall();
      } else {
        log.warn(`[${roomId}] Unknown message type from client: ${msgType}`);
      }
    } catch (e) {
      log.exception(`[${roomId}] Error in client message handler:`, e);
    }
  });
 
  clientWs.on("close", async () => {
    log.info(`[${roomId}] Client disconnected after ${audioChunksSent} audio chunks`);
    await closeCall();
  });
 
  clientWs.on("error", (e) => {
    log.exception(`[${roomId}] WebSocket error:`, e);
  });
});
 
// ── startup ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8765", 10);
 
server.listen(PORT, "0.0.0.0", () => {
  log.info("=".repeat(60));
  log.info("Doctor Booking Voice Assistant starting up");
  log.info(`Model          : ${MODEL_ID}`);
  log.info(`Client → Server: ${CLIENT_SEND_RATE} Hz`);
  log.info(`Server → Gemini: ${GEMINI_INPUT_RATE} Hz`);
  log.info(`Gemini → Server: ${GEMINI_OUTPUT_RATE} Hz`);
  log.info(`Server → Client: ${CLIENT_RECV_RATE} Hz`);
  log.info(`API key set    : ${Boolean(API_KEY && API_KEY !== "YOUR API KEY")}`);
  log.info(`Listening on   : http://0.0.0.0:${PORT}  (ws: /ws, http: /config /health)`);
  log.info("=".repeat(60));
});
 
process.on("SIGINT", () => {
  log.info("Shutting down");
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  log.info("Shutting down");
  server.close(() => process.exit(0));
});