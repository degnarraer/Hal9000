# vscode-ollama-agent

## Overview
The vscode-ollama-agent is a Visual Studio Code extension that integrates the Ollama API, allowing users to manage an Ollama agent directly from the editor. This extension provides commands to start and stop the agent, as well as a status bar indicator to show the agent's current state.

## Features
- Start and stop the Ollama agent with simple commands.
- Status bar integration to display the agent's status.
- Easy setup and configuration.

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd vscode-ollama-agent
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Usage
- To start the Ollama agent, use the command palette (Ctrl+Shift+P) and type `Activate Ollama Agent`.
- To stop the Ollama agent, use the command palette and type `Stop Ollama Agent`.
- The status bar will indicate whether the agent is running or stopped.

## Development
To contribute to the project, please follow these steps:
1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Push your branch and create a pull request.

## License
This project is licensed under the MIT License. See the LICENSE file for more details.

## Local server for Ollama Assistant

A simple Express server is included at `server/index.js` which proxies requests to your local Ollama instance and serves a web UI from `public/index.html`.

For an internet-facing setup with separated services, Keycloak authentication, PostgreSQL, Ollama, and Caddy, see `DEPLOYMENT.md`.

### Features

- **Chat Interface**: Real-time streaming chat with Ollama models
- **Model Management**: 
  - View installed models
  - Download models from the official Ollama library
  - Select model versions (tags) before downloading
  - Remove models locally
- **Voice Input**: Capture audio and transcribe using Web Speech API
- **Voice Output**: Text-to-speech synthesis for assistant responses
- **Monitoring**: Real-time server logs and Ollama status monitoring
- **Remote Control**: Soft reboot the server
- **AI Rules Enforcement**: Machine-readable rules system for prompt validation

### Quick Start

1. Install dependencies: 
   ```bash
   npm install
   ```

2. Configure environment variables by copying `.env.example` to `.env`:
   ```bash
   # Windows
   copy .env.example .env
   # macOS/Linux
   cp .env.example .env
   ```
   
   Update `.env` with your settings:
   ```env
   PORT=3000
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=llama2
   OLLAMA_BIN=/path/to/ollama  # (optional, for Windows: C:\Users\...\AppData\Local\Programs\Ollama\ollama.exe)
   ```

3. Ensure Ollama is running locally. You can start it with:
   ```bash
   ollama serve
   ```

4. Start the server:
   ```bash
   npm run start-server
   ```
   or
   ```bash
   node server/index.js
   ```

5. Open `http://localhost:3000` in your browser

### Using the Models Panel

1. Click the **☰ (hamburger menu)** button in the top-right corner
2. Go to the **Models** tab
3. View **Installed Models** at the top
4. Scroll down to **Available Models from Ollama** to see the official library
5. Select a model size/tag from the dropdown and click **Download**
6. The model will be fetched and installed automatically

Alternatively, you can manually enter a model name in the **Manual Install** section (e.g., `llama2`, `mistral:7b`, etc.) and click **Install**.

### Local text-to-speech

The server uses Piper for open source offline voice output. Install Piper separately, download a Piper voice model, then set:

```env
TTS_PROVIDER=piper
TTS_PIPER_BIN=piper
TTS_PIPER_MODEL=C:\voices\en_US-lessac-medium.onnx
TTS_PIPER_CONFIG=C:\voices\en_US-lessac-medium.onnx.json
```

### Local speech-to-text

The server can use Vosk for offline speech recognition. The `vosk` Node package is installed as a server dependency, and the acoustic model is installed separately:

```bash
npm run server:install:vosk
```

That downloads the default small English model to `./stt-models/vosk-model-small-en-us-0.15`. For local Node runs, set:

```env
VOSK_MODEL_PATH=stt-models/vosk-model-small-en-us-0.15
MIC_TRANSCRIPTION_PROVIDER=auto
```

If Piper is not configured or fails at runtime, the TTS request fails instead of falling back to browser or OS speech synthesis. The active server-side provider is exposed at `/api/tts/status`.
