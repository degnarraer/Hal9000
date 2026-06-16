# UI Demo: Available Models Feature

## Main Chat Interface
```
┌───────────────────────────────────────────────────────────────┐
│ vscode-ollama-agent                              [☰] Menu    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                   💬 Chat with Ollama                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Select Model: [llama2 ▼]                               │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Bot: Hello! I'm ready to chat. How can I help?       │ │
│  │  User: Can you help me write code?                    │ │
│  │  Bot: Absolutely! I specialize in code generation.    │ │
│  │                                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌───────────────────────────────────┬─────────────────────┐ │
│  │ Type your message here...         │  [Send] [🎤] [🔊] │ │
│  └───────────────────────────────────┴─────────────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Hamburger Menu - Models Tab (NEW!)
```
╔══════════════════════════════════════════╗
║ Menu [×]                                 ║
╠══════════════════════════════════════════╣
║ [Models] [Monitor] [Logging] [Remote]   ║
╠══════════════════════════════════════════╣
║ INSTALLED MODELS                         ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ llama2:latest              [✖]     │  ║
║ └────────────────────────────────────┘  ║
║                                          ║
║ ─────────────────────────────────────   ║
║ AVAILABLE MODELS FROM OLLAMA             ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ 🔷 Mistral                         │  ║
║ │    A high-quality small model      │  ║
║ │    [7b]                            │  ║
║ │    [7b ▼] [⬇ Download]            │  ║
║ └────────────────────────────────────┘  ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ 🔶 Llama 2                         │  ║
║ │    General purpose LLM             │  ║
║ │    [7b] [13b] [70b]               │  ║
║ │    [7b ▼] [⬇ Download]            │  ║
║ └────────────────────────────────────┘  ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ 🔵 Neural Chat                     │  ║
║ │    Optimized for conversations     │  ║
║ │    [7b]                            │  ║
║ │    [7b ▼] [⬇ Download]            │  ║
║ └────────────────────────────────────┘  ║
║                                          ║
║ ─────────────────────────────────────   ║
║ MANUAL INSTALL                           ║
║ ┌────────────────────────────────────┐  ║
║ │ model/name:tag or url              │  ║
║ └────────────────────────────────────┘  ║
║ [Install]                                ║
║                                          ║
║ Status: Downloading mistral:7b...       ║
║                                          ║
╚══════════════════════════════════════════╝
```

## Download Confirmation Dialog
```
┌────────────────────────────────────────────┐
│ ⚠️  Download mistral:7b?                   │
├────────────────────────────────────────────┤
│ This may take a while (~5-10 minutes)     │
│                                            │
│ Model size: 4GB                           │
│ Architecture: 7B parameters               │
│                                            │
│                [Cancel]  [Download]       │
└────────────────────────────────────────────┘
```

## After Download - Status Updates
```
╔══════════════════════════════════════════╗
║ Menu [×]                                 ║
╠══════════════════════════════════════════╣
║ [Models] [Monitor] [Logging] [Remote]   ║
╠══════════════════════════════════════════╣
║ INSTALLED MODELS                         ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ llama2:latest              [✖]     │  ║
║ └────────────────────────────────────┘  ║
║                                          ║
║ ┌────────────────────────────────────┐  ║
║ │ mistral:latest             [✖]     │  ║  ← NEW!
║ └────────────────────────────────────┘  ║
║                                          ║
║ ✅ Downloaded mistral:7b                ║
║                                          ║
╚══════════════════════════════════════════╝
```

## Model Card Details

Each available model shows:
```
┌─────────────────────────────────────────────┐
│ 📦 Model Name                               │
│                                             │
│ Description: What this model is best for   │
│                                             │
│ [7b] [13b] [70b]  ← Available sizes        │
│                                             │
│ [Select Size ▼]  [⬇ Download]  ← Actions │
│                                             │
│ Status: Ready                              │
└─────────────────────────────────────────────┘
```

## Available Models Display
```
Model List (Currently showing 8):
├─ llama2          - General purpose LLM (7b, 13b, 70b)
├─ mistral         - High-quality small model (7b)
├─ neural-chat     - Chat-optimized (7b)
├─ codellama       - Code generation (7b, 13b, 34b)
├─ alpaca          - Fine-tuned variant (7b)
├─ llama2-uncensored - No restrictions (7b, 13b)
├─ orca-mini       - Small & fast (3b, 7b, 13b)
└─ dolphin-mixtral - Advanced reasoning (8x7b)
```

## Workflow Sequence

```
START
  │
  ├─→ Click ☰ Menu
  │
  ├─→ Select "Models" Tab
  │    │
  │    ├─→ See "Installed Models" (currently: llama2)
  │    │
  │    ├─→ Scroll to "Available Models"
  │    │
  │    ├─→ Pick desired model (e.g., Mistral)
  │    │
  │    ├─→ Choose size from [Dropdown] (e.g., 7b)
  │    │
  │    ├─→ Click [⬇ Download]
  │    │
  │    ├─→ Confirm: "Download mistral:7b?"
  │    │
  │    ├─→ DOWNLOADING... (shows in status)
  │    │
  │    ├─→ ✅ Downloaded Successfully!
  │    │
  │    └─→ Model appears in "Installed Models"
  │
  ├─→ Return to chat view
  │
  ├─→ Select model: [Mistral ▼]
  │
  ├─→ Type message and chat
  │
  └─→ END
```

## Server Log Output
```
[15:32:14] INFO Server listening on http://localhost:3000
[15:32:24] INFO Fetching available models from Ollama library...
[15:32:25] INFO Fetched 8 models from official Ollama library
[15:33:41] INFO Starting ollama pull mistral:7b
[15:33:42] INFO Downloading mistral (pulling from registry)
[15:43:15] INFO ollama pull mistral:7b succeeded
[15:43:20] INFO Returning 9 available models to client
```

## Color Theme

The UI uses a sci-fi gradient theme:
- **Available Model Cards**: Purple gradient background with blue text
- **Download Button**: Cyan-to-purple gradient
- **Size Tags**: Cyan badges with borders
- **Text**: Light blue/cyan for readability
- **Status Messages**: Green for success, Red for errors

## Responsive Behavior

- **Desktop**: Full sidebar with all details visible
- **Tablet**: Responsive sidebar, models stack vertically
- **Mobile**: Full-screen menu, touch-friendly buttons

---

## Color Palette Reference
```
Primary Accent:   #00e0ff (Cyan)
Secondary:        #7c5cff (Purple)
Background:       #020712 (Dark Blue)
Surface:          rgba(8,14,26,0.6)
Success:          #00ff00
Error:            #ff5f7a
```

## Typography
- Font Family: 'Orbitron', Inter, system-ui (sci-fi theme)
- Model Name: Bold, larger size
- Description: Muted color, smaller size
- Tags: Small mono-space, inline display
- Buttons: Font-weight 600-700

---

**This feature enhances the user experience by making it incredibly easy to discover and install Ollama models directly from the web interface!**
