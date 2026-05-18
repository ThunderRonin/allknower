# Streaming LLM Responses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed global LLM timeouts with streaming responses using inactivity-based timeouts. Users see incremental progress instead of staring at a spinner for 30–120s.

**Architecture:** Migrate from `openrouter.chat.send()` (blocking) to `openrouter.callModel()` (streaming) using the native `@openrouter/sdk` Responses API. Add a streaming layer in model-router, expose SSE endpoints from Elysia routes, proxy through Next.js API routes, consume in React components. Non-streaming `callWithFallback()` stays for internal pipelines (compact, relations).

**Tech Stack:** `@openrouter/sdk` callModel + getTextStream/getItemsStream, Elysia AsyncGenerator SSE, Next.js ReadableStream proxy, React fetch + ReadableStream reader, Zustand for progressive state updates

---

## SDK API Reference

The `@openrouter/sdk` provides `callModel()` which returns a `ModelResult` with multiple streaming APIs:

```typescript
const result = openrouter.callModel({
    model: "deepseek/deepseek-v4-pro",
    models: ["x-ai/grok-4.1-fast", "qwen/qwen3.6-plus"],  // fallbacks
    instructions: systemPrompt,                              // replaces system message
    input: fromChatMessages(messages),                       // or plain string
    reasoning: { effort: "low" },
    temperature: 0.3,
    maxOutputTokens: 30000,
    text: { format: { type: "json_object" } },              // JSON mode
    provider: { allowFallbacks: true },
    plugins: [{ id: "response-healing" }],
});

// Streaming consumption patterns:
result.getTextStream()           // AsyncIterableIterator<string> — text deltas only
result.getItemsStream()          // reasoning + message items (typed)
result.getFullResponsesStream()  // low-level events with delta types
result.getReasoningStream()      // reasoning deltas only
await result.getText()           // block until complete text
await result.getResponse()       // block until full response with usage
```

Chat-compat helper converts existing message arrays:
```typescript
import { fromChatMessages } from "@openrouter/sdk";
const input = fromChatMessages([
    { role: "system", content: "..." },
    { role: "user", content: "..." },
]);
```

---

## Timeout Strategy

**Current:** Single `LLM_TIMEOUT_MS=180000` (3 min) global AbortController — if model is slow, request dies.

**New (streaming):**
| Timeout | Default | Purpose |
|---------|---------|---------|
| `LLM_FIRST_CHUNK_TIMEOUT_MS` | 30000 | Time to first token — detects dead/overloaded model |
| `LLM_INACTIVITY_TIMEOUT_MS` | 15000 | Max gap between chunks — detects stalled stream |
| `LLM_MAX_DURATION_MS` | 300000 | Absolute ceiling safety net (5 min) |

If tokens are flowing → model is working. No more guessing if 180s is enough.

**Non-streaming calls** (compact, relations, session-compact) keep simple AbortSignal.timeout() — they're internal and fast.

---

## SSE Wire Protocol

AllKnower → Portal SSE format:

```
event: status
data: {"stage":"rag","message":"Querying lore context..."}

event: token
data: {"content":"The "}

event: token
data: {"content":"ancient "}

event: reasoning
data: {"content":"I should extract..."}

event: result
data: {"summary":"...","created":[...],"updated":[...],...}

event: error
data: {"error":"Model timed out","code":"TIMEOUT"}

event: done
data: {"tokensUsed":1234,"model":"deepseek/deepseek-v4-pro","latencyMs":45000}
```

---

## Phase 1: Foundation — Streaming Model Router

### Task 1: StreamChunk Types + Env Vars

**Files:**
- Create: `src/pipeline/stream-types.ts`
- Modify: `src/env.ts:71-75`

- [ ] **Step 1: Create stream type definitions**

```typescript
// src/pipeline/stream-types.ts

export type StreamChunk =
    | { type: "status"; stage: string; message: string }
    | { type: "token"; content: string }
    | { type: "reasoning"; content: string }
    | { type: "done"; raw: string; tokensUsed: number; model: string; latencyMs: number }
    | { type: "error"; error: string; code?: string };

export function sseEncode(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
```

- [ ] **Step 2: Add streaming timeout env vars**

In `src/env.ts`, replace the single `LLM_TIMEOUT_MS` block:

```typescript
// Streaming timeouts
LLM_FIRST_CHUNK_TIMEOUT_MS: z.coerce.number().optional().default(30000).pipe(z.number().positive()),
LLM_INACTIVITY_TIMEOUT_MS: z.coerce.number().optional().default(15000).pipe(z.number().positive()),
LLM_MAX_DURATION_MS: z.coerce.number().optional().default(300000).pipe(z.number().positive()),

// Legacy non-streaming timeout (compact, relations — internal pipelines)
LLM_TIMEOUT_MS: z.coerce.number().optional().default(120000).pipe(z.number().positive()),
```

- [ ] **Step 3: Update .env and .env.example**

Add to both:
```
# Streaming timeouts (for user-facing pipelines)
LLM_FIRST_CHUNK_TIMEOUT_MS=30000
LLM_INACTIVITY_TIMEOUT_MS=15000
LLM_MAX_DURATION_MS=300000
```

- [ ] **Step 4: Verify**

```bash
bun typecheck
```

- [ ] **Step 5: Commit**

```
feat(streaming): add StreamChunk types and streaming timeout env vars
```

---

### Task 2: callModelStream() in Model Router

**Files:**
- Modify: `src/pipeline/model-router.ts`

This is the core streaming primitive. Uses `openrouter.callModel()` + `getItemsStream()` with inactivity-based timeout.

- [ ] **Step 1: Add imports**

```typescript
import { fromChatMessages } from "@openrouter/sdk";
import type { StreamChunk } from "./stream-types.ts";
```

- [ ] **Step 2: Add callModelStream function**

```typescript
export async function* callModelStream(
    task: TaskType,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
        temperature?: number;
        maxTokens?: number;
        responseFormat?: { type: "json_object" } | {
            type: "json_schema";
            jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean };
        };
        requestId?: string;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
        log?: Logger;
    }
): AsyncGenerator<StreamChunk> {
    const log = options?.log ?? rootLogger;
    const models = getModelChain(task);

    if (models.length === 0) {
        yield { type: "error", error: `No models configured for task "${task}"`, code: "NO_MODEL" };
        return;
    }

    const [primaryModel, ...fallbackModels] = models;
    const startTime = performance.now();

    // Timeout controller
    const controller = new AbortController();
    const FIRST_CHUNK_MS = env.LLM_FIRST_CHUNK_TIMEOUT_MS;
    const INACTIVITY_MS = env.LLM_INACTIVITY_TIMEOUT_MS;
    const MAX_DURATION_MS = env.LLM_MAX_DURATION_MS;

    let firstChunkReceived = false;
    let inactivityTimer: ReturnType<typeof setTimeout>;
    let maxDurationTimer: ReturnType<typeof setTimeout>;

    // First-chunk timeout
    let firstChunkTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (!firstChunkReceived) {
            controller.abort();
        }
    }, FIRST_CHUNK_MS);

    // Absolute max duration
    maxDurationTimer = setTimeout(() => controller.abort(), MAX_DURATION_MS);

    const resetInactivity = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_MS);
    };

    // Extract system message and build input
    const systemMsg = messages.find(m => m.role === "system");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    // Build text format from responseFormat
    const textFormat = options?.responseFormat?.type === "json_object"
        ? { format: { type: "json_object" as const } }
        : options?.responseFormat?.type === "json_schema"
            ? { format: { type: "json_schema" as const, ...options.responseFormat.jsonSchema } }
            : undefined;

    let accumulatedText = "";
    let tokensUsed = 0;
    let usedModel = primaryModel;

    try {
        const result = openrouter.callModel({
            model: primaryModel,
            ...(fallbackModels.length > 0 && { models: fallbackModels }),
            ...(systemMsg && { instructions: systemMsg.content }),
            input: nonSystemMessages.length === 1 && nonSystemMessages[0].role === "user"
                ? nonSystemMessages[0].content
                : fromChatMessages(nonSystemMessages as any),
            temperature: options?.temperature ?? 0.3,
            maxOutputTokens: options?.maxTokens ?? 30000,
            ...(textFormat && { text: textFormat }),
            ...(options?.reasoning && { reasoning: options.reasoning }),
            plugins: [{ id: "response-healing" as any }],
            provider: {
                allowFallbacks: true,
                ...(env.OPENROUTER_SORT && { sort: env.OPENROUTER_SORT }),
                ...(env.OPENROUTER_ZDR === "true" && { dataCollection: "deny" as any }),
            } as any,
        });

        for await (const item of result.getItemsStream()) {
            // First chunk arrived — clear first-chunk timer, start inactivity timer
            if (!firstChunkReceived) {
                firstChunkReceived = true;
                clearTimeout(firstChunkTimer);
                resetInactivity();
            } else {
                resetInactivity();
            }

            if (item.type === "reasoning") {
                yield { type: "reasoning", content: item.summary ?? "" };
            } else if (item.type === "message") {
                // getItemsStream emits cumulative content — extract delta
                const delta = (item.content ?? "").slice(accumulatedText.length);
                if (delta) {
                    accumulatedText += delta;
                    yield { type: "token", content: delta };
                }
            }
        }

        // Get full response for usage stats
        const response = await result.getResponse();
        tokensUsed = (response.usage as any)?.totalTokens
            ?? ((response.usage as any)?.inputTokens ?? 0) + ((response.usage as any)?.outputTokens ?? 0);
        usedModel = (response as any).model ?? primaryModel;

        const latencyMs = Math.round(performance.now() - startTime);

        if (usedModel !== primaryModel) {
            log.info("Task fell back to alternate model", { task, from: primaryModel, to: usedModel });
        }

        logLLMCall({ requestId: options?.requestId, task, model: usedModel, tokensUsed, latencyMs }, log);

        yield { type: "done", raw: accumulatedText, tokensUsed, model: usedModel, latencyMs };
    } catch (error) {
        const latencyMs = Math.round(performance.now() - startTime);
        if (error instanceof DOMException && error.name === "AbortError") {
            const reason = !firstChunkReceived
                ? `No response from model within ${FIRST_CHUNK_MS}ms`
                : `Stream stalled (no data for ${INACTIVITY_MS}ms)`;
            yield { type: "error", error: reason, code: "TIMEOUT" };
        } else {
            yield { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
        logLLMCall({ requestId: options?.requestId, task, model: usedModel, tokensUsed: 0, latencyMs }, log);
    } finally {
        clearTimeout(firstChunkTimer);
        clearTimeout(inactivityTimer!);
        clearTimeout(maxDurationTimer);
    }
}
```

- [ ] **Step 3: Verify**

```bash
bun typecheck
```

- [ ] **Step 4: Commit**

```
feat(streaming): add callModelStream() with inactivity-based timeouts

Uses @openrouter/sdk callModel() + getItemsStream() for token-by-token
streaming. Replaces fixed 180s timeout with 30s first-chunk + 15s
inactivity + 5min ceiling. Existing callWithFallback() unchanged.
```

---

### Task 3: callLLMStream() Wrapper in prompt.ts

**Files:**
- Modify: `src/pipeline/prompt.ts`

Thin wrapper that mirrors `callLLM()` but delegates to `callModelStream()`.

- [ ] **Step 1: Add streaming wrapper**

```typescript
import { callModelStream } from "./model-router.ts";
import type { StreamChunk } from "./stream-types.ts";

export async function* callLLMStream(
    system: string,
    user: string,
    task: TaskType = "brain-dump",
    context?: string,
    options?: {
        jsonSchema?: { name: string; schema: Record<string, unknown> };
        maxTokens?: number;
        temperature?: number;
        reasoning?: { effort?: "xhigh" | "high" | "medium" | "low" | "minimal" };
    }
): AsyncGenerator<StreamChunk> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: system },
    ];
    if (context) {
        messages.push({ role: "user", content: context });
    }
    messages.push({ role: "user", content: user });

    const responseFormat = options?.jsonSchema
        ? { type: "json_schema" as const, jsonSchema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema, strict: true } }
        : { type: "json_object" as const };

    yield* callModelStream(task, messages, {
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 30000,
        responseFormat,
        reasoning: options?.reasoning,
    });
}
```

- [ ] **Step 2: Verify**

```bash
bun typecheck
```

- [ ] **Step 3: Commit**

```
feat(streaming): add callLLMStream() wrapper in prompt.ts
```

---

## Phase 2: Article Copilot Streaming (Highest UX Impact)

### Task 4: Copilot Stream Route

**Files:**
- Modify: `src/routes/copilot.ts`
- Modify: `src/pipeline/article-copilot.ts`

The copilot is the best first target: chat UI, users expect token-by-token streaming, and the output is prose (not JSON that needs post-processing).

- [ ] **Step 1: Add streaming generator to article-copilot pipeline**

In `src/pipeline/article-copilot.ts`, add a new export alongside existing `runArticleCopilot`:

```typescript
import { callModelStream } from "./model-router.ts";
import type { StreamChunk } from "./stream-types.ts";

export async function* runArticleCopilotStream(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: { requestId?: string }
): AsyncGenerator<StreamChunk> {
    // Same message construction as runArticleCopilot but yields chunks
    yield* callModelStream("article-copilot", messages, {
        temperature: 0.4,
        maxTokens: 30000,
        responseFormat: { type: "json_object" },
        requestId: options?.requestId,
        reasoning: { effort: "low" },
    });
}
```

- [ ] **Step 2: Add /copilot/article/stream route**

In `src/routes/copilot.ts`:

```typescript
import { sseEncode } from "../pipeline/stream-types.ts";

.post("/article/stream", async ({ body, session, set }) => {
    const credentials = await resolveAllCodexCredentials(session!.user.id);

    // Build messages (same as non-streaming /article endpoint)
    const messages = buildCopilotMessages(body);

    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";

    return new ReadableStream({
        async start(controller) {
            try {
                controller.enqueue(sseEncode("status", { stage: "llm", message: "Generating response..." }));

                let rawResponse = "";
                for await (const chunk of runArticleCopilotStream(messages)) {
                    if (chunk.type === "token") {
                        controller.enqueue(sseEncode("token", { content: chunk.content }));
                        rawResponse += chunk.content;
                    } else if (chunk.type === "reasoning") {
                        controller.enqueue(sseEncode("reasoning", { content: chunk.content }));
                    } else if (chunk.type === "done") {
                        // Parse accumulated JSON, validate, return final result
                        const parsed = parseCopilotResponse(rawResponse);
                        controller.enqueue(sseEncode("result", parsed));
                        controller.enqueue(sseEncode("done", {
                            tokensUsed: chunk.tokensUsed,
                            model: chunk.model,
                            latencyMs: chunk.latencyMs,
                        }));
                    } else if (chunk.type === "error") {
                        controller.enqueue(sseEncode("error", { error: chunk.error, code: chunk.code }));
                    }
                }
            } catch (e) {
                controller.enqueue(sseEncode("error", { error: e instanceof Error ? e.message : String(e) }));
            } finally {
                controller.close();
            }
        }
    });
})
```

- [ ] **Step 3: Verify**

```bash
bun typecheck
```

- [ ] **Step 4: Test with curl**

```bash
curl -N -X POST http://localhost:3001/copilot/article/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"Describe the city of Solara"}]}'
```

Verify SSE events arrive incrementally.

- [ ] **Step 5: Commit**

```
feat(copilot): add streaming SSE endpoint /copilot/article/stream

Token-by-token streaming via callModelStream. Returns SSE events:
status, token, reasoning, result, done, error. Non-streaming endpoint
unchanged for backward compat.
```

---

### Task 5: Portal Copilot Streaming — Server Proxy

**Files:**
- Create: `lib/sse-proxy.ts` (in allcodex-portal)
- Modify: `app/api/lore/[id]/copilot/chat/route.ts` (or create stream variant)
- Modify: `lib/allknower-server.ts`

- [ ] **Step 1: Create SSE proxy utility**

```typescript
// lib/sse-proxy.ts
import { getAkCreds } from "./get-creds";

export async function proxySSE(
    path: string,
    body: unknown,
    timeoutMs = 300_000,
): Promise<Response> {
    const creds = await getAkCreds();
    if (!creds.url || !creds.token) {
        return new Response(
            `event: error\ndata: ${JSON.stringify({ error: "AllKnower not configured" })}\n\n`,
            { headers: { "Content-Type": "text/event-stream" } },
        );
    }

    const res = await fetch(`${creds.url}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "Unknown error");
        return new Response(
            `event: error\ndata: ${JSON.stringify({ error: text })}\n\n`,
            { status: 502, headers: { "Content-Type": "text/event-stream" } },
        );
    }

    return new Response(res.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
```

- [ ] **Step 2: Add streaming route**

```typescript
// app/api/lore/[id]/copilot/stream/route.ts
import { proxySSE } from "@/lib/sse-proxy";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();
    return proxySSE(`/copilot/article/stream`, { ...body, noteId: id });
}
```

- [ ] **Step 3: Verify**

```bash
cd allcodex-portal && bun run check
```

- [ ] **Step 4: Commit**

```
feat(portal): add SSE proxy for copilot streaming

Passes AllKnower SSE body-stream through Next.js API route.
```

---

### Task 6: Portal Copilot Streaming — React UI

**Files:**
- Create: `hooks/use-sse-stream.ts` (in allcodex-portal)
- Modify: `components/portal/ArticleCopilot.tsx`

- [ ] **Step 1: Create SSE stream hook**

```typescript
// hooks/use-sse-stream.ts
import { useCallback, useRef } from "react";

export type SSEEvent = {
    event: string;
    data: unknown;
};

export function useSSEStream() {
    const abortRef = useRef<AbortController | null>(null);

    const stream = useCallback(async function* (
        url: string,
        body: unknown,
    ): AsyncGenerator<SSEEvent> {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!res.ok || !res.body) {
            throw new Error(`Stream failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            let currentEvent = "message";
            for (const line of lines) {
                if (line.startsWith("event: ")) {
                    currentEvent = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                    try {
                        yield { event: currentEvent, data: JSON.parse(line.slice(6)) };
                    } catch {
                        yield { event: currentEvent, data: line.slice(6) };
                    }
                }
            }
        }
    }, []);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return { stream, cancel };
}
```

- [ ] **Step 2: Integrate into ArticleCopilot.tsx**

Replace the blocking `fetchJsonOrThrow` call with the streaming hook. Accumulate tokens into the assistant message bubble in real-time:

```typescript
const { stream, cancel } = useSSEStream();

async function sendMessageStreaming(content: string) {
    const messages = [...currentMessages, { role: "user", content }];
    store.sendMessage(noteId, content);
    store.addMessage(noteId, { role: "assistant", content: "" }); // placeholder
    setIsSending(true);

    let accumulated = "";
    for await (const event of stream(`/api/lore/${noteId}/copilot/stream`, { messages })) {
        if (event.event === "token") {
            accumulated += (event.data as { content: string }).content;
            store.updateLastMessage(noteId, accumulated); // update in-place
        } else if (event.event === "result") {
            // Final structured result — update store with parsed proposal
            handleCopilotResult(event.data);
        } else if (event.event === "error") {
            store.updateLastMessage(noteId, `Error: ${(event.data as any).error}`);
        }
    }
    setIsSending(false);
}
```

Note: `updateLastMessage` is a new Zustand action that updates the content of the last message in-place. Add to `useCopilotStore`.

- [ ] **Step 3: Add updateLastMessage to Zustand store**

In the copilot store, add:
```typescript
updateLastMessage: (noteId: string, content: string) => {
    set((state) => {
        const conv = state.conversations[noteId];
        if (!conv?.messages.length) return state;
        const messages = [...conv.messages];
        messages[messages.length - 1] = { ...messages[messages.length - 1], content };
        return { conversations: { ...state.conversations, [noteId]: { ...conv, messages } } };
    });
},
```

- [ ] **Step 4: Verify**

```bash
cd allcodex-portal && bun run check
```

- [ ] **Step 5: Manual test**

Start full stack, open copilot UI, send message. Verify tokens stream into chat bubble progressively.

- [ ] **Step 6: Commit**

```
feat(portal): streaming copilot chat with progressive token rendering

useSSEStream hook consumes SSE from AllKnower via proxy route.
Tokens render into chat bubble in real-time via Zustand updateLastMessage.
```

---

## Phase 3: Brain Dump Streaming

### Task 7: Brain Dump Stream Route

**Files:**
- Modify: `src/pipeline/brain-dump.ts`
- Modify: `src/routes/brain-dump.ts`

Brain dump is more complex — output is JSON that gets parsed + written to AllCodex. Can't stream partial JSON. Instead, stream **pipeline stage events** so the user sees progress.

- [ ] **Step 1: Add streaming brain dump pipeline**

In `src/pipeline/brain-dump.ts`, add alongside existing `runBrainDump`:

```typescript
import { callLLMStream } from "./prompt.ts";
import type { StreamChunk } from "./stream-types.ts";

export async function* runBrainDumpStream(
    rawText: string,
    options: { autoRelate?: boolean; credentials?: EtapiCredentials; userId?: string } = {}
): AsyncGenerator<StreamChunk | { type: "status"; stage: string; message: string }> {
    const { autoRelate = true, credentials, userId } = options;

    // Preflight
    yield { type: "status", stage: "preflight", message: "Checking AllCodex connection..." };
    const probe = await probeAllCodex(credentials);
    if (!probe.ok) {
        yield { type: "error", error: `AllCodex is not connected: ${probe.error}` };
        return;
    }

    // Idempotency check
    const rawTextHash = Buffer.from(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawText))
    ).toString("hex");

    const existing = await prisma.brainDumpHistory.findFirst({
        where: { rawTextHash, userId: userId ?? null },
        orderBy: { createdAt: "desc" },
        select: { id: true, parsedJson: true },
    });
    if (existing) {
        const cached = existing.parsedJson as { summary: string };
        yield { type: "status", stage: "cache", message: "Found cached result" };
        // Yield done with cached result — caller handles
        yield { type: "done", raw: JSON.stringify(cached), tokensUsed: 0, model: "cache", latencyMs: 0 };
        return;
    }

    // RAG retrieval
    yield { type: "status", stage: "rag", message: "Querying existing lore for context..." };
    // ... (same RAG logic as runBrainDump, building mergedContext)
    let ragContext = [];
    try { ragContext = await queryLore(rawText, 10); } catch {}
    let statblockContext = [];
    try {
        const statblockNotes = await getAllCodexNotes("#statblock", credentials);
        const ids = statblockNotes.map((n: any) => n.noteId);
        if (ids.length > 0) statblockContext = await queryLore(rawText, 5, { includeNoteIds: ids });
    } catch {}
    const mergedContext = [...statblockContext, ...ragContext.filter(
        r => !statblockContext.some(s => s.noteId === r.noteId)
    )].slice(0, 12);

    // Build prompt
    yield { type: "status", stage: "llm", message: "Sending to LLM..." };
    const { system, context, user } = await buildBrainDumpPrompt(rawText, mergedContext);

    // Stream LLM response
    let rawResponse = "";
    let llmMeta = { tokensUsed: 0, model: "", latencyMs: 0 };

    for await (const chunk of callLLMStream(system, user, "brain-dump", context, {
        reasoning: { effort: "low" },
    })) {
        if (chunk.type === "token") {
            rawResponse += chunk.content;
            yield chunk; // pass through for progress indication
        } else if (chunk.type === "reasoning") {
            yield chunk;
        } else if (chunk.type === "done") {
            rawResponse = chunk.raw;
            llmMeta = { tokensUsed: chunk.tokensUsed, model: chunk.model, latencyMs: chunk.latencyMs };
        } else if (chunk.type === "error") {
            yield chunk;
            return;
        }
    }

    // Parse
    yield { type: "status", stage: "parse", message: "Parsing entities..." };
    const { entities, summary } = parseBrainDumpResponse(rawResponse);
    yield { type: "status", stage: "parse", message: `Found ${entities.length} entities` };

    // Write to AllCodex
    yield { type: "status", stage: "write", message: `Writing ${entities.length} entities to AllCodex...` };
    const writeResult = await _writeEntitiesToAllCodex(
        rawText, rawTextHash, entities, summary,
        llmMeta.tokensUsed, llmMeta.model, autoRelate, credentials, userId
    );

    // Final result
    yield {
        type: "status",
        stage: "complete",
        message: `Created ${writeResult.created.length}, updated ${writeResult.updated.length}, skipped ${writeResult.skipped.length}`,
    };

    // Emit the full result as a "result" event for the route to serialize
    yield { type: "done", raw: JSON.stringify(writeResult), tokensUsed: llmMeta.tokensUsed, model: llmMeta.model, latencyMs: llmMeta.latencyMs } as StreamChunk;
}
```

- [ ] **Step 2: Add /brain-dump/stream route**

In `src/routes/brain-dump.ts`:

```typescript
.post("/stream", async ({ body, session, set }) => {
    const credentials = await resolveAllCodexCredentials(session!.user.id);
    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";

    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of runBrainDumpStream(body.rawText, {
                    autoRelate: body.autoRelate ?? true,
                    credentials,
                    userId: session!.user.id,
                })) {
                    controller.enqueue(sseEncode(chunk.type, chunk));
                }
            } catch (e) {
                controller.enqueue(sseEncode("error", { error: e instanceof Error ? e.message : String(e) }));
            } finally {
                controller.close();
            }
        }
    });
})
```

- [ ] **Step 3: Verify**

```bash
bun typecheck
```

- [ ] **Step 4: Manual test with curl**

```bash
curl -N -X POST http://localhost:3001/brain-dump/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"rawText":"Solara is the capital city of the Ember Reach..."}'
```

Verify: status events → token events → status (parse) → status (write) → done.

- [ ] **Step 5: Commit**

```
feat(brain-dump): add streaming SSE endpoint with stage-based progress

Streams pipeline stages (preflight, rag, llm, parse, write) as SSE
status events. LLM tokens streamed for progress indication. Final
result emitted as done event. Non-streaming endpoint unchanged.
```

---

### Task 8: Portal Brain Dump Streaming

**Files:**
- Create: `app/api/brain-dump/stream/route.ts` (in allcodex-portal)
- Modify: `app/(portal)/brain-dump/page.tsx`
- Modify: `stores/brain-dump-store.ts` (or equivalent Zustand store)

- [ ] **Step 1: Add Next.js proxy route**

```typescript
// app/api/brain-dump/stream/route.ts
import { proxySSE } from "@/lib/sse-proxy";

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxySSE("/brain-dump/stream", body);
}
```

- [ ] **Step 2: Add streaming state to brain dump store**

```typescript
// In useBrainDumpStore:
streamStatus: null as { stage: string; message: string } | null,
streamTokens: "",  // accumulated raw LLM output for progress display
setStreamStatus: (status) => set({ streamStatus: status }),
appendStreamToken: (token) => set((s) => ({ streamTokens: s.streamTokens + token })),
resetStream: () => set({ streamStatus: null, streamTokens: "" }),
```

- [ ] **Step 3: Integrate streaming into brain dump page**

Replace the blocking `runBrainDump` fetch with streaming consumption:

```typescript
async function handleBrainDumpStream(rawText: string) {
    store.resetStream();
    store.setLoading(true);

    for await (const event of stream("/api/brain-dump/stream", { rawText })) {
        switch (event.event) {
            case "status":
                store.setStreamStatus(event.data as any);
                break;
            case "token":
                store.appendStreamToken((event.data as any).content);
                break;
            case "done":
                // Parse final result, update main store
                const result = JSON.parse((event.data as any).raw);
                store.setResult(result);
                break;
            case "error":
                store.setError((event.data as any).error);
                break;
        }
    }
    store.setLoading(false);
}
```

- [ ] **Step 4: Show progressive UI**

Render `streamStatus` as a stage indicator:
```tsx
{streamStatus && (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        <span>{streamStatus.message}</span>
    </div>
)}
```

- [ ] **Step 5: Verify**

```bash
cd allcodex-portal && bun run check
```

- [ ] **Step 6: Manual test**

Full stack up, run brain dump from UI. Verify: stage messages appear progressively → result renders.

- [ ] **Step 7: Commit**

```
feat(portal): streaming brain dump with progressive stage indicators

Shows pipeline progress (rag, llm, parse, write) as streaming status
updates. Eliminates blank loading spinner during 30-120s brain dumps.
```

---

## Phase 4: Autocomplete + Remaining Pipelines

### Task 9: Autocomplete Streaming

**Files:**
- Modify: `src/routes/suggest.ts`
- Modify: Portal autocomplete component

Autocomplete is latency-sensitive — streaming the first suggestion token ASAP matters most.

- [ ] **Step 1: Add /suggest/autocomplete/stream route**

Same pattern as copilot: yield tokens from `callLLMStream("autocomplete", ...)`. Autocomplete output is typically short — streaming gives time-to-first-suggestion benefit.

- [ ] **Step 2: Portal integration**

Autocomplete UI consumes first tokens to show inline suggestion immediately.

- [ ] **Step 3: Commit**

```
feat(autocomplete): add streaming endpoint for faster first-suggestion
```

---

### Task 10: Gap-Detect + Consistency Streaming

**Files:**
- Modify: `src/routes/suggest.ts` (gap-detect)
- Modify: `src/routes/consistency.ts`

Lower priority — these are less latency-sensitive. Stream status events for progress indication on long analyses.

- [ ] **Step 1: Add /suggest/gaps/stream and /consistency/check/stream routes**

Status events only (not token streaming) — output is structured JSON, not incremental text.

- [ ] **Step 2: Portal integration**

Show "Analyzing N notes..." → "Found 3 gaps" progressively.

- [ ] **Step 3: Commit**

```
feat(analysis): add streaming progress for gap-detect and consistency
```

---

## Phase 5: Timeout Cleanup

### Task 11: Deprecate LLM_TIMEOUT_MS for Streaming Routes

**Files:**
- Modify: `src/env.ts`
- Modify: `.env` / `.env.example`
- Modify: `src/pipeline/model-router.ts`

- [ ] **Step 1: Mark LLM_TIMEOUT_MS as legacy**

Keep `LLM_TIMEOUT_MS` for non-streaming calls (compact, relations). Add comment marking it as legacy.

- [ ] **Step 2: Remove timeout from streaming-capable routes**

Routes with `/stream` endpoints no longer need the global timeout — they use first-chunk + inactivity timeouts.

- [ ] **Step 3: Update docs**

Add streaming architecture to `docs/shared/reference/architecture.md`.

- [ ] **Step 4: Commit**

```
refactor(timeout): streaming routes use inactivity timeouts, deprecate global LLM_TIMEOUT_MS
```

---

## Verification Plan

### Per-Phase Smoke Tests

| Phase | Test |
|-------|------|
| 1 — Foundation | `bun typecheck` passes. callModelStream exists. |
| 2 — Copilot | `curl -N` to /copilot/article/stream → SSE tokens arrive. Portal chat shows progressive text. |
| 3 — Brain dump | `curl -N` to /brain-dump/stream → status + token events. Portal shows stage progress. |
| 4 — Autocomplete | First token arrives in <3s. Inline suggestion appears before full response. |
| 5 — Cleanup | Non-streaming routes still work. No regressions. |

### Timeout Behavior Tests

1. Kill model mid-stream → inactivity timeout fires within 15s
2. Model returns nothing → first-chunk timeout fires within 30s
3. Very long response (5min+) → max-duration safety net kills it
4. Fast model → no timeout interference, response completes normally

### Backward Compatibility

- All existing non-stream endpoints (`/brain-dump`, `/copilot/article`, etc.) unchanged
- Portal can choose streaming or blocking per-component
- `callWithFallback()` unchanged for internal pipelines
