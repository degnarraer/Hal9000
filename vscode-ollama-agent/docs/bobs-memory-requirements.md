# Bob's Memory Requirements

## Purpose

Bob's Memory gives each signed-in user a private, inspectable memory layer that helps Bob answer the current message with useful context from prior conversations without replaying old chats or inventing profile details.

## User Requirements

- Store chat memory per authenticated user, keyed by the stable database user key, not by display name or email.
- Restore recent chat history for the signed-in user when they reopen the app.
- Show the user what Bob remembers in the Memory skill page: short, medium, and long summaries; learned factoids; and recent chat messages.
- Let the user refresh the Memory page, delete individual chat memory items, delete individual factoids, and wipe all saved memory for their own account after explicit confirmation.
- Keep visible chat clearing separate from saved memory deletion.
- Keep saved chat inspectable in the Memory page, but remove processed chat messages from Bob's prompt context after they have been merged into short-term memory.
- Use memory as background context only. Bob must answer the current user message, not continue old topics unless the user asks.
- Include only transcript-supported facts in durable factoids. Do not infer sensitive attributes, secrets, credentials, medical facts, or financial account data.
- Capture memory at three horizons:
  - Short term: merge chat messages since the last memory update into concise current task state, immediate goals, preferences stated today, and unresolved next steps.
  - Medium term: merge existing medium-term memory with the existing short-term memory.
  - Long term: merge existing long-term memory with the existing medium-term memory.
- Run memory updates as a cascade in this order: long term, then medium term, then short term. This prevents newly written short-term memory from being promoted immediately in the same run.
- Do not force a memory replacement when new information is less important than existing memory. The merge prompt should preserve higher-value existing bullets and return them unchanged when appropriate.
- Run the memory update process after configured chat-message thresholds or when estimated context pressure reaches the configured model-context trigger. Context pressure should count memory summaries and unprocessed chat messages, not the full saved chat log.
- Bound saved memory by the configured model processing budget: model context tokens, prompt reserve tokens, trigger ratio, and max words for short, medium, and long memory.
- Store assistant emotion metadata with assistant messages so Bob's visible state and future context can reflect the interaction.
- Degrade safely when memory storage or model summarization is unavailable: chat should continue, and the UI should show a clear memory error rather than mixing users or showing stale assumptions as fact.

## Architecture Requirements

- Keep the memory store responsible for persistence, schema setup, user scoping, CRUD, and prompt assembly from already-saved memory.
- Keep prompt assembly compacted: include summaries, factoids, and only chat messages newer than the last short-memory update.
- Keep the memory skill service responsible for cascading memory merges, factoid extraction, transcript formatting, context-pressure estimation, scheduling intervals, model-memory budgets, and duplicate job suppression.
- Keep Express route handlers thin: they should validate request shape, call the store or service, and return normalized JSON.
- Keep model-generated memory artifacts behind deterministic filters before persistence.
- Keep all memory manager API responses scoped to the current authenticated user.
- Keep tests around prompt construction, factoid filtering, emotion hydration, user-key scoping, and memory skill orchestration.

## Acceptance Checks

- A signed-in user can open Skills, open Memory, and open this requirements document from the Memory page.
- The Memory page shows only that user's summaries, factoids, and messages.
- The Memory page can delete one message, delete one factoid, and wipe all memory only for that user.
- After enough conversation turns, or when estimated context pressure is high, the memory cascade runs without blocking chat responses.
- The cascade updates long memory from existing medium memory, then medium memory from existing short memory, then short memory from new chat messages since the last update.
- After a cascade catches up, old chat messages remain visible in the Memory page but are omitted from Bob's future prompt context.
- Merge prompts preserve existing memory when incoming memory is weaker or less useful.
- Factoids are saved only when every claim is supported by user-authored transcript text and the category is allowed.
- Bob Chat receives memory in bounded, labeled sections and is instructed that prior memory is background context only.
- Server tests pass with the memory orchestration isolated from the main server startup file.
