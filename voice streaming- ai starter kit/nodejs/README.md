# Doctor Booking Voice Assistant (Node.js)

Express + Gemini Live API voice assistant that books doctor appointments over a WebSocket audio bridge.

## 1. Check your Node.js version

Node.js 18.17.0 or higher is required.

```
node -v
```

If it's older or not installed, download the LTS version from https://nodejs.org.

## 2. Install dependencies

```
npm install
```

This installs:

* `express` — the web framework (serves the `/health` and `/config` endpoints)
* `ws` — the WebSocket server used for the audio bridge at `/ws`
* `@google/genai` — the Gemini API/Live SDK


## 3. Set up your Gemini API key

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey),
then open `main.py` and paste it into the `API_KEY` variable near the top of the file.


## 4. Run the server

```
npm start
```

For auto-reload during development:

```
npm run dev
```

The server listens on `0.0.0.0:8765` by default. To use a different port:

```
PORT=9000 npm start
```

On Windows PowerShell, use `$env:PORT=9000; npm start` instead.

