export type StreamChunk =
    | { type: "status"; stage: string; message: string }
    | { type: "token"; content: string }
    | { type: "reasoning"; content: string }
    | { type: "done"; raw: string; tokensUsed: number; model: string; latencyMs: number }
    | { type: "error"; error: string; code?: string };

export function sseEncode(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
