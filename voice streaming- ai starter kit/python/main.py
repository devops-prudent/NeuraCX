import asyncio
import base64
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
    INDIA_TZ = ZoneInfo("Asia/Kolkata")
except Exception:
    # Falls back if the 'tzdata' package isn't installed (common on Windows).
    # India doesn't observe DST, so a fixed UTC+5:30 offset is fully accurate.
    INDIA_TZ = timezone(timedelta(hours=5, minutes=30))

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
#from dotenv import load_dotenv

#load_dotenv()

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── audio config ──────────────────────────────────────────────────────────────
GEMINI_INPUT_RATE  = int(os.environ.get("GEMINI_INPUT_RATE",  "16000"))
GEMINI_OUTPUT_RATE = int(os.environ.get("GEMINI_OUTPUT_RATE", "24000"))
CLIENT_SEND_RATE   = int(os.environ.get("CLIENT_SEND_RATE",   "8000"))
CLIENT_RECV_RATE   = int(os.environ.get("CLIENT_RECV_RATE",   "8000"))

# ── app config ────────────────────────────────────────────────────────────────
API_KEY  = "YOUR API KEY"
MODEL_ID = "gemini-3.1-flash-live-preview"

if not API_KEY:
    log.critical("GEMINI_API_KEY is not set! Export it before starting the server.")
else:
    log.info("GEMINI_API_KEY loaded (length=%d)", len(API_KEY))

log.info(
    "Model: %s | client_in=%dHz→gemini=%dHz | gemini_out=%dHz→client=%dHz",
    MODEL_ID, CLIENT_SEND_RATE, GEMINI_INPUT_RATE, GEMINI_OUTPUT_RATE, CLIENT_RECV_RATE,
)


# ── resampling helpers ────────────────────────────────────────────────────────
def resample_pcm(pcm_bytes: bytes, from_rate: int, to_rate: int) -> bytes:
    """
    Resample raw signed-16-bit little-endian PCM from from_rate to to_rate.
    Uses linear interpolation via numpy — cheap and good enough for voice.
    Returns bytes in the same int16-LE format.
    """
    if from_rate == to_rate:
        return pcm_bytes

    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    old_len = len(samples)
    new_len = int(round(old_len * to_rate / from_rate))

    old_indices = np.linspace(0, old_len - 1, new_len)
    idx_floor   = np.floor(old_indices).astype(np.int32)
    idx_ceil    = np.clip(idx_floor + 1, 0, old_len - 1)
    frac        = old_indices - idx_floor

    resampled = samples[idx_floor] + frac * (samples[idx_ceil] - samples[idx_floor])
    resampled = np.clip(resampled, -32768, 32767).astype(np.int16)
    return resampled.tobytes()


# ── tool ──────────────────────────────────────────────────────────────────────
# NOTE: This is NOT a database lookup or availability check. It performs no
# external calls at all. Its only purpose is to let the model hand back the
# booking details it has already collected and verbally confirmed with the
# caller, in a clean structured form, so the server can emit the exit event.
confirm_booking_tool = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="confirm_booking",
            description=(
                "Call this ONLY after you have collected and verbally confirmed "
                "all booking details with the caller (patient name, doctor name, "
                "day, date, time). This does not check availability or touch any "
                "database — it simply finalizes the booking with the details you "
                "already agreed on with the caller."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "patient_name": types.Schema(type=types.Type.STRING, description="Full name of the patient"),
                    "dr_name":      types.Schema(type=types.Type.STRING, description="Name of the doctor"),
                    "day":          types.Schema(type=types.Type.STRING, description="Day of the appointment (e.g., Monday)"),
                    "date":         types.Schema(type=types.Type.STRING, description="Date of the appointment (e.g., 2025-07-15)"),
                    "time":         types.Schema(type=types.Type.STRING, description="Time of the appointment (e.g., 10:30 AM)"),
                },
                required=["patient_name", "dr_name", "day", "date", "time"],
            ),
        )
    ]
)


def build_system_prompt() -> str:
    now_ist = datetime.now(INDIA_TZ)
    today_str = now_ist.strftime("%A, %d %B %Y")   # e.g. "Tuesday, 04 August 2026"
    today_day = now_ist.strftime("%A")              # e.g. "Tuesday"

    return f"""You are a professional, warm, and efficient hospital receptionist managing doctor appointments. You book appointments purely based on what the caller tells you — you do not check any external schedule or database. Assume any day, date, time, and doctor the caller requests is available unless it is obviously invalid (e.g., a past date or a nonsensical time).

TODAY'S DATE: Today is {today_str} ({today_day}), current time in Kerala, India (Asia/Kolkata timezone). Use this as the ground truth for "today", "tomorrow", "day after tomorrow", "this Friday", "next week", and any other relative day or date the caller mentions. Always compute the correct calendar date from this reference point.

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
2. Immediately after, warmly thank the caller by name for booking with us and let them know their appointment is confirmed. Keep it short and sincere."""


def build_live_config() -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        # enable_affective_dialog=True,
        system_instruction=types.Content(
            parts=[types.Part.from_text(text=build_system_prompt())]
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        proactivity=types.ProactivityConfig(
            proactive_audio=True
        ),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Kore"
                )
            ),
        ),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                disabled=False,
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                prefix_padding_ms=20,
                silence_duration_ms=200,
            )
        ),
        tools=[confirm_booking_tool]
    )


# ── app ───────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=" * 60)
    log.info("Doctor Booking Voice Assistant starting up")
    log.info("Model          : %s", MODEL_ID)
    log.info("Client → Server: %d Hz", CLIENT_SEND_RATE)
    log.info("Server → Gemini: %d Hz", GEMINI_INPUT_RATE)
    log.info("Gemini → Server: %d Hz", GEMINI_OUTPUT_RATE)
    log.info("Server → Client: %d Hz", CLIENT_RECV_RATE)
    log.info("API key set    : %s", bool(API_KEY))
    log.info("=" * 60)
    yield
    log.info("Shutting down")

app = FastAPI(title="Doctor Booking Voice Assistant", lifespan=lifespan)


@app.get("/config")
async def get_config():
    """Returns audio rate config so the frontend can self-configure."""
    return {
        "client_send_rate": CLIENT_SEND_RATE,
        "client_recv_rate": CLIENT_RECV_RATE,
        "gemini_input_rate": GEMINI_INPUT_RATE,
        "gemini_output_rate": GEMINI_OUTPUT_RATE,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def voice_endpoint(websocket: WebSocket):

    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"

    # room_id can be passed as a query param, e.g. wss://.../ws?room_id=abc123
    room_id = websocket.query_params.get("room_id", client_ip)

    log.info("Client connected from %s (room_id=%s)", client_ip, room_id)

    if not API_KEY:
        log.error("Cannot open Gemini session — GEMINI_API_KEY is empty")
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Server misconfiguration: GEMINI_API_KEY not set"
        }))
        await websocket.close()
        return

    log.debug("Creating Gemini client (model=%s)", MODEL_ID)

    try:
        gemini_client = genai.Client(
            api_key=API_KEY,
            http_options={"api_version": "v1alpha"},
        )
        log.debug("Gemini client created successfully")
    except Exception as e:
        log.exception("Failed to create Gemini client: %s", e)
        await websocket.send_text(json.dumps({"type": "error", "message": f"Gemini client error: {e}"}))
        await websocket.close()
        return

    log.info("Opening Gemini Live session...")
    session_start = time.monotonic()
    live_config = build_live_config()

    try:
        async with gemini_client.aio.live.connect(model=MODEL_ID, config=live_config) as session:
            elapsed = time.monotonic() - session_start
            log.info("Gemini session opened in %.2fs", elapsed)

            audio_chunks_sent     = 0
            audio_chunks_received = 0
            text_messages_sent    = 0
            booking_confirmed     = False
            pending_exit_payload  = None  # set when confirm_booking fires; sent after the thank-you turn finishes

            async def receive_from_client():
                nonlocal audio_chunks_sent, text_messages_sent
                try:
                    async for message in websocket.iter_text():
                        payload  = json.loads(message)
                        #print("payload:",payload)
                        msg_type = payload.get("event")
                        #print("msg_type:",msg_type)

                        if msg_type == "media":
                            raw_pcm = base64.b64decode(payload.get("media", {}).get("payload"))
                            if len(raw_pcm) % 2 != 0:
                                raw_pcm += b"\x00"  # Pad with one zero byte

                            upsampled = resample_pcm(raw_pcm, CLIENT_SEND_RATE, GEMINI_INPUT_RATE)
                            audio_chunks_sent += 1
                            if audio_chunks_sent % 50 == 0:
                                log.debug(
                                    "Audio chunk #%d: %d bytes @ %dHz → %d bytes @ %dHz → Gemini",
                                    audio_chunks_sent, len(raw_pcm), CLIENT_SEND_RATE,
                                    len(upsampled), GEMINI_INPUT_RATE,
                                )
                            await session.send_realtime_input(
                                audio=types.Blob(data=upsampled, mime_type=f"audio/pcm;rate={GEMINI_INPUT_RATE}")
                            )

                        elif msg_type == "text":
                            user_text = (payload.get("data") or "").strip()
                            if not user_text:
                                continue
                            text_messages_sent += 1
                            log.info("Text message #%d from client: %s", text_messages_sent, user_text)
                            await session.send_client_content(
                                turns=types.Content(
                                    role="user",
                                    parts=[types.Part(text=user_text)],
                                ),
                                turn_complete=True,
                            )

                        elif msg_type == "stop":
                            log.info("Client requested stop after %d audio chunks sent", audio_chunks_sent)
                            break

                        else:
                            log.warning("Unknown message type from client: %s", msg_type)

                except WebSocketDisconnect:
                    log.info("Client disconnected (receive loop) after %d audio chunks", audio_chunks_sent)
                except RuntimeError as e:
                    # Happens when send_to_client closes the socket itself (e.g. right
                    # after booking completes) while this loop was still awaiting the
                    # next message. This is expected in that case, not a real error.
                    if "not connected" in str(e).lower():
                        log.info("Receive loop ended: socket closed by server after %d audio chunks", audio_chunks_sent)
                    else:
                        log.exception("Unexpected RuntimeError in receive_from_client: %s", e)
                except Exception as e:
                    log.exception("Error in receive_from_client: %s", e)

            async def send_to_client():
                nonlocal audio_chunks_received, booking_confirmed, pending_exit_payload
                try:
                    log.debug("send_to_client: listening for Gemini responses")
                    while True:
                        async for response in session.receive():

                            # ── booking confirmation (no DB, no availability check) ──
                            if hasattr(response, "tool_call") and response.tool_call:
                                for fc in response.tool_call.function_calls:
                                    if fc.name == "confirm_booking":
                                        exit_payload = dict(fc.args)
                                        booking_confirmed = True

                                        log.info(
                                            "Booking confirmed via prompt: %s",
                                            exit_payload
                                        )

                                        # Tell Gemini the call succeeded so it can proceed
                                        # to thank the caller as instructed in the prompt.
                                        await session.send_tool_response(
                                            function_responses=[
                                                types.FunctionResponse(
                                                    id=fc.id,
                                                    name=fc.name,
                                                    response={"status": "success"},
                                                )
                                            ]
                                        )

                                        # Don't emit the exit event yet — the model still
                                        # needs to speak its thank-you message as part of
                                        # this same turn. We send it once turn_complete
                                        # fires below, so the thank-you audio plays first.
                                        pending_exit_payload = exit_payload
                                    else:
                                        log.warning("Unknown tool requested: %s", fc.name)
                                        await session.send_tool_response(
                                            function_responses=[
                                                types.FunctionResponse(
                                                    id=fc.id,
                                                    name=fc.name,
                                                    response={"status": "unknown_tool"},
                                                )
                                            ]
                                        )

                            # ── audio / transcript / turn ───────────────────
                            if response.server_content:
                                sc = response.server_content

                                if getattr(sc, "interrupted", False):
                                    log.info("Barge-in detected — generation interrupted")
                                    await websocket.send_text(json.dumps({"event": "clear","room_id": room_id}))
                                    # await websocket.send_text(json.dumps({"type": "interrupted"}))

                                if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
                                    await websocket.send_text(json.dumps({
                                        "type": "transcript",
                                        "role": "user",
                                        "text": sc.input_transcription.text,
                                    }))

                                if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                                    await websocket.send_text(json.dumps({
                                        "type": "transcript",
                                        "role": "assistant",
                                        "text": sc.output_transcription.text,
                                    }))

                                if sc.model_turn:
                                    for part in sc.model_turn.parts:
                                        if hasattr(part, "inline_data") and part.inline_data:
                                            raw_audio   = part.inline_data.data
                                            downsampled = resample_pcm(raw_audio, GEMINI_OUTPUT_RATE, CLIENT_RECV_RATE)
                                            audio_b64   = base64.b64encode(downsampled).decode()
                                            audio_chunks_received += 1

                                            log.debug(
                                                "Audio chunk #%d: %d bytes @ %dHz → %d bytes @ %dHz → client",
                                                audio_chunks_received, len(raw_audio), GEMINI_OUTPUT_RATE,
                                                len(downsampled), CLIENT_RECV_RATE,
                                            )
                                            await websocket.send_text(json.dumps({
                                                "event": "media",
                                                "media": {"payload": audio_b64}
                                            }))

                                if sc.turn_complete:
                                    await websocket.send_text(json.dumps({"type": "turn_complete"}))

                                    # The thank-you turn has now fully finished streaming
                                    # to the client — safe to send the exit event.
                                    if pending_exit_payload is not None:
                                        await websocket.send_text(json.dumps({
                                            "event": "exit",
                                            "room_id": room_id,
                                            "exit": {
                                                "parameters": pending_exit_payload
                                            }
                                        }))
                                        log.info("Exit event sent for room_id=%s: %s", room_id, pending_exit_payload)
                                        pending_exit_payload = None

                                        # Booking is done and the caller has been thanked —
                                        # end the call now instead of waiting indefinitely.
                                        log.info("Booking complete — closing call for room_id=%s", room_id)
                                        try:
                                            await websocket.close()
                                        except Exception:
                                            pass
                                        return

                except WebSocketDisconnect:
                    log.info("Client disconnected (send loop)")
                except Exception as e:
                    log.exception("Error in send_to_client: %s", e)
                    try:
                        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
                    except Exception:
                        pass

            receive_task = asyncio.create_task(receive_from_client())
            send_task    = asyncio.create_task(send_to_client())

            # Trigger the opening greeting immediately — don't wait for the
            # caller to speak first. This turn is never shown to the caller,
            # it just prompts the model to say the greeting from the prompt.
            try:
                await session.send_client_content(
                    turns=types.Content(
                        role="user",
                        parts=[types.Part(text="(The call has just connected. Greet the caller now.)")],
                    ),
                    turn_complete=True,
                )
                log.info("Sent kickoff turn to trigger opening greeting")
            except Exception as e:
                log.exception("Failed to send kickoff greeting turn: %s", e)

            log.debug("Both tasks started, waiting for first to complete")
            done, pending = await asyncio.wait(
                [receive_task, send_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            for task in pending:
                log.debug("Cancelling pending task: %s", task.get_name())
                task.cancel()

            for task in done:
                if task.exception():
                    log.error("Task finished with exception: %s", task.exception())

    except Exception as e:
        log.exception("Failed to open or maintain Gemini session: %s", e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": f"Gemini session error: {e}"}))
        except Exception:
            pass

    log.info("Gemini session closed for client %s", client_ip)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)
