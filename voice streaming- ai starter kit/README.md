# Doctor Booking Voice Assistant (Python)

FastAPI + Gemini Live API voice assistant that books doctor appointments
over a WebSocket audio bridge.

## 1. Create and activate a virtual environment

**macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows (PowerShell):**
```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```

**Windows (cmd.exe):**
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

You'll know it worked because your shell prompt gets a `(venv)` prefix.
To leave the venv later, just run `deactivate`.

## 2. Install dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `fastapi` — the web framework
- `uvicorn[standard]` — the ASGI server that actually runs FastAPI, plus
  the extras needed for WebSocket support
- `google-genai` — the Gemini API/Live SDK
- `numpy` — used for PCM resampling
- `tzdata` — IANA timezone database, needed for `zoneinfo.ZoneInfo("Asia/Kolkata")`
  to work reliably (mainly matters on Windows, which doesn't ship system
  tz data the way Linux/macOS do)



## 3. Run the server


```bash
uvicorn main:app --host 0.0.0.0 --port 8765 --reload
```
