# Available Models Feature - Quick Reference

## UI Navigation

```
┌─────────────────────────────────────────┐
│   Chat Interface (Main Area)            │
│   ┌─────────────────────────────────┐   │
│   │  Message history and input      │   │
│   │  Select model dropdown ▼        │   │
│   └─────────────────────────────────┘   │
│                                         │
│   [☰] Menu Button (Top-Right)          │
└─────────────────────────────────────────┘

Menu → Models Tab
├── Installed Models (Section 1)
│   └── Lists currently installed models
│       └── [Remove] button per model
│
├── Available Models from Ollama (Section 2)
│   └── Curated list from official library
│       ├── Model Name
│       ├── Description text
│       ├── Size tags (7b, 13b, 70b)
│       ├── [Size Selector ▼] [Download] button
│       └── Status messages below
│
└── Manual Install (Section 3)
    ├── Text input: "model/name:tag"
    ├── [Install] button
    └── Status messages
```

## Example Models

| Model | Best For | Sizes |
|-------|----------|-------|
| llama2 | General purpose, benchmarks | 7b, 13b, 70b |
| mistral | Speed and efficiency | 7b |
| neural-chat | Conversations | 7b |
| codellama | Programming/code | 7b, 13b, 34b |
| alpaca | Cost-effective | 7b |
| dolphin-mixtral | Complex reasoning | 8x7b |

## Common Tasks

### Download a Model
1. Click hamburger menu (☰)
2. Go to "Models" tab
3. Find desired model in "Available Models"
4. Select size from dropdown (e.g., "7b")
5. Click [Download]
6. Confirm dialog
7. Wait for download to complete
8. Model appears in "Installed Models"

### Chat with a Model
1. Select model from dropdown in main chat area
2. Type message in composer
3. Click [Send] or press Enter
4. Response streams from Ollama

### Remove a Model
1. Open menu → Models
2. Find model in "Installed Models"
3. Click [Remove] button
4. Confirm deletion

### Monitor Download Progress
1. Open menu → Logging tab
2. Watch logs for "Starting ollama pull..."
3. "ollama pull succeeded" confirms completion

## Server Logs

Available logs show model operations:
```
[TIMESTAMP] INFO AI rules loaded
[TIMESTAMP] INFO Server listening on http://localhost:3000
[TIMESTAMP] INFO Fetching available models from Ollama library...
[TIMESTAMP] INFO Fetched 8 models from official Ollama library
[TIMESTAMP] INFO Starting ollama pull mistral:7b
[TIMESTAMP] INFO ollama pull mistral:7b succeeded
```

## Troubleshooting

### "Ollama not available" error
- Ensure Ollama service is running: `ollama serve`
- Check OLLAMA_URL in .env file
- Verify OLLAMA_BIN path (Windows)

### Models not appearing in "Available Models"
- Check server logs (Menu → Logging)
- Clear browser cache (Ctrl+Shift+Delete)
- Restart server: `npm run start-server`

### Download stuck/failing
- Check server logs for error details
- Ensure sufficient disk space
- Try smaller model first (e.g., 7b instead of 70b)
- Check internet connection (downloading from registry)

### Model appears installed but can't chat
- Ensure model is fully downloaded (check logs)
- Try selecting it again from dropdown
- Restart browser and try again
- Check browser console for errors (F12 → Console)

## API Reference

### Get Available Models
```bash
curl http://localhost:3000/api/ollama/available
```

### Get Installed Models
```bash
curl http://localhost:3000/api/ollama/models
```

### Download/Install Model
```bash
curl -X POST http://localhost:3000/api/ollama/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"mistral:7b"}'
```

### Remove Model
```bash
curl -X POST http://localhost:3000/api/ollama/remove \
  -H 'Content-Type: application/json' \
  -d '{"model":"mistral:7b"}'
```

## Performance Tips

- **Start Small**: Download 7b models first to test
- **Storage**: Each 7b model ≈ 4GB, 13b ≈ 8GB
- **Download Speed**: First download slower due to registry fetch
- **Memory**: 7b needs ≈ 8GB RAM, 13b needs ≈ 16GB RAM

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (except Voice Input on some versions)
