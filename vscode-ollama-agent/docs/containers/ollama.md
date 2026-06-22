# ollama Container

## Purpose

`ollama` runs the local model server used by Bob for chat, summarization, factoid extraction, and web-search summarization.

## Network And Permissions

- Exposes port `11434` only to Docker networks.
- Attached to `app_net`.
- Intended client: `app`.
- Model data persists in `ollama_data`.
- Health checked with `ollama list`.

## USER Functions

USERs do not call Ollama directly. They use Bob chat APIs in `app`, and `app` calls Ollama on their behalf.

## ADMIN Functions

ADMINs can manage models through `app`:

- Pull/install models.
- Remove models.
- Show/load/unload models.
- View monitor details.
- Browse available models.

## Security Notes

- Do not publish Ollama directly. The model API is powerful and should be mediated by `app`.
- Model management is ADMIN-only in Bob.
- The Docker network is not marked `internal` because Ollama may need outbound internet access to pull models.

