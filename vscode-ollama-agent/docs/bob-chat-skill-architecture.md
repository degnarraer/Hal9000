# Bob Chat And Skill Contracts

Bob skills communicate through explicit JSON contracts. The goal is to make chat, tools, memory, voice, and future skill chaining predictable instead of relying on unstructured model text.

## Principles

- Every skill has a named `skill` id and `contractVersion`.
- Every skill receives an input contract and returns an output contract.
- User-visible text lives only in `output.response` or, for Bob Chat's compact model contract, `response`.
- UI state lives in metadata, not inferred from prose.
- Bob's face emotion is driven by `metadata.emotion`.
- Raw model output is debug data only.
- Invalid contracts are normalized by the server before reaching the client.

## Shared Skill Input Contract

```json
{
  "contractVersion": 1,
  "skill": "web-search",
  "input": {
    "prompt": "User request or skill instruction",
    "context": {},
    "upstream": []
  }
}
```

`input.prompt` is the task for the skill.

`input.context` contains structured skill-specific data, such as search results, memory summaries, or selected model settings.

`input.upstream` contains prior skill output contracts when skills are chained.

## Shared Skill Output Contract

```json
{
  "contractVersion": 1,
  "skill": "web-search",
  "output": {
    "response": "Text shown to the user.",
    "metadata": {
      "emotion": "focused",
      "contractValid": true
    },
    "data": {},
    "sources": []
  }
}
```

`output.response` is the display text for chat bubbles and voice output.

`output.metadata.emotion` drives Bob's visible emotional state. The value must be one of the supported API states below.

## Bob Emotion API

The emotion API is designed to be LLM-compatible: the model receives both the enum values and a plain-language description of when to use each state.

Bob Chat must calculate emotion from the full interaction, including:

- The current user message.
- The apparent user tone.
- The requested task type.
- Relevant conversation context.
- Whether Bob's response succeeds, fails, warns, asks for clarification, or completes the task confidently.

The emotion is not a decoration applied after the answer. It is part of the skill output contract and should describe Bob's interaction state for that turn.

`idle`: Neutral resting state. Use when no stronger emotional signal is appropriate.

`listening`: Attentive and receptive. Use when Bob is taking in user context or inviting more detail.

`thinking`: Processing or reasoning. Use when Bob is working through uncertainty or a multi-step problem.

`speaking`: Actively presenting. Use rarely in model output because the client usually controls speaking animation during audio playback.

`happy`: Warm, pleased, or encouraging. Use for positive outcomes, friendly greetings, or celebrations.

`love`: Affectionate or deeply appreciative. Use sparingly for sincere warmth or user delight, not routine answers.

`magic`: Playful wonder or imaginative surprise. Use for creative, whimsical, or delightful moments.

`amused`: Light humor or playful recognition. Use when Bob is joking gently or responding to something funny.

`confident`: Certain and direct. Use for clear answers, completed tasks, or strong recommendations.

`curious`: Interested and exploratory. Use when asking questions, investigating, or exploring possibilities.

`focused`: Task-oriented concentration. Use for implementation, debugging, analysis, or step-by-step work.

`sleepy`: Low-energy or winding down. Use rarely, only when tone intentionally becomes quiet or tired.

`annoyed`: Mild frustration. Use sparingly for repeated failures, friction, or clearly irritating constraints.

`distrustful`: Skeptical or cautious. Use for suspicious inputs, unsafe claims, scams, or unverified assumptions.

`sad`: Sympathetic or disappointed. Use for bad news, user frustration, loss, or regret.

`surprised`: Unexpected discovery. Use when results differ from expectations or something is genuinely notable.

`concerned`: Careful worry or caution. Use for errors, risks, safety issues, or when the contract is invalid.

`error`: Failure state. Use only when Bob cannot complete the requested operation or a system/tool error occurred.

`output.data` is skill-specific structured data.

`output.sources` is an array of source objects for skills that cite external information.

## Bob Chat Compact Model Contract

Bob Chat asks the model to return a compact contract:

```json
{
  "response": "Text shown to the user.",
  "metadata": {
    "emotion": "focused"
  }
}
```

The server normalizes this into message content and metadata:

- `response` becomes the chat message content.
- `metadata.emotion` is saved with the message, persisted in the chat database `emotion` column, and sent to the browser.
- Invalid or missing emotion becomes `idle`.
- Non-JSON model output becomes a safe invalid contract with `emotion: "concerned"` and `contractValid: false`.

## Current Skills

`bob-chat`

- Input: user prompt plus memory context.
- Output: compact Bob Chat contract.
- UI behavior: `response` is shown in the chat bubble; `metadata.emotion` drives the Bob face.

`web-search`

- Input: shared input contract with `context.query` and `context.results`.
- Output: shared output contract.
- UI behavior: `output.response` is shown; `output.sources` are available as source metadata; `output.metadata.emotion` can drive Bob's face.

## Chaining

A skill can pass its normalized output contract to another skill through `input.upstream`.

Example:

```json
{
  "contractVersion": 1,
  "skill": "bob-chat",
  "input": {
    "prompt": "Explain these findings.",
    "context": {},
    "upstream": [
      {
        "contractVersion": 1,
        "skill": "web-search",
        "output": {
          "response": "Search summary.",
          "metadata": { "emotion": "focused", "contractValid": true },
          "data": { "query": "Piper TTS" },
          "sources": []
        }
      }
    ]
  }
}
```

## Server Responsibilities

The server owns contract validation and normalization.

- Build input contracts before invoking skills.
- Parse model output as JSON.
- Normalize `metadata.emotion`.
- Save only user-visible `response` as message content.
- Save structured metadata with chat messages.
- Save assistant response emotion as a first-class `chat_messages.emotion` value.
- Include prior assistant emotions in recent transcript context so Bob can maintain a longer-running emotional state.
- Expose raw model output only through admin debug fields.

## Client Responsibilities

The client consumes normalized contracts only.

- Render chat bubbles from `response`.
- Apply Bob face state from `metadata.emotion`.
- Display skill pills from `skill` or `skills`.
- Treat debug pills as diagnostics, not user-facing content.

## Adding A Skill

1. Choose a stable `skill` id.
2. Define the skill-specific `input.context` and `output.data` fields.
3. Build a shared input contract before execution.
4. Require the model or tool to return a shared output contract.
5. Parse and normalize the output on the server.
6. Add tests for valid output, invalid output, and metadata normalization.
