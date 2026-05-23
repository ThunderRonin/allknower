import { getNote, type EtapiCredentials } from "../etapi/client.ts";
import { CORE_NAME_TO_CANONICAL } from "../relationships/mapping.ts";
import { rootLogger } from "../logger.ts";

export interface GraphNode {
    noteId: string;
    title: string;
    loreType: string;
    depth: number;
}

export interface GraphEdge {
    sourceNoteId: string;
    targetNoteId: string;
    relationshipType: string;
}

export interface GraphResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    centerNoteId: string;
    maxDepthReached: number;
    truncated: boolean;
}

export interface TraverseOptions {
    depth?: number;
    maxNodes?: number;
    credentials?: EtapiCredentials;
}

const MAX_DEPTH_CAP = 3;
const DEFAULT_MAX_NODES = 50;
const DEFAULT_DEPTH = 2;

export async function traverseRelationGraph(
    centerNoteId: string,
    options: TraverseOptions = {},
): Promise<GraphResult> {
    const maxDepth = Math.min(options.depth ?? DEFAULT_DEPTH, MAX_DEPTH_CAP);
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeSeen = new Set<string>();
    const queued = new Set<string>([centerNoteId]);

    let queue: Array<{ noteId: string; depth: number }> = [
        { noteId: centerNoteId, depth: 0 },
    ];

    while (queue.length > 0 && nodes.size < maxNodes) {
        const currentDepth = queue[0].depth;
        const batch: typeof queue = [];
        while (queue.length > 0 && queue[0].depth === currentDepth) {
            batch.push(queue.shift()!);
        }

        const fetchBatch = batch.filter((item) => !nodes.has(item.noteId));
        if (fetchBatch.length === 0) continue;

        const results = await Promise.allSettled(
            fetchBatch.map(async (item) => {
                const note = await getNote(item.noteId, options.credentials);
                return { item, note };
            }),
        );

        const nextDepthQueue: typeof queue = [];

        for (let i = 0; i < results.length; i++) {
            const settled = results[i];
            if (settled.status === "rejected" || nodes.size >= maxNodes) {
                if (settled.status === "rejected") {
                    const noteId = fetchBatch[i]?.noteId;
                    rootLogger.warn("Graph traversal: failed to fetch note", { noteId });
                }
                continue;
            }

            const { item, note } = settled.value;
            const loreType = note.attributes
                .find((a) => a.type === "label" && a.name === "loreType")
                ?.value ?? "unknown";

            nodes.set(item.noteId, {
                noteId: item.noteId,
                title: note.title,
                loreType,
                depth: item.depth,
            });

            const relations = note.attributes.filter(
                (a) => a.type === "relation" && a.name !== "template",
            );

            for (const rel of relations) {
                const canonical = CORE_NAME_TO_CANONICAL[rel.name];
                if (!canonical) continue;

                // Skip self-loops
                if (rel.value === item.noteId) continue;

                const edgeKey = [item.noteId, rel.value, canonical].sort().join("::");
                if (edgeSeen.has(edgeKey)) continue;
                edgeSeen.add(edgeKey);

                edges.push({
                    sourceNoteId: item.noteId,
                    targetNoteId: rel.value,
                    relationshipType: canonical,
                });

                if (item.depth < maxDepth && !queued.has(rel.value)) {
                    queued.add(rel.value);
                    nextDepthQueue.push({ noteId: rel.value, depth: item.depth + 1 });
                }
            }
        }

        queue = [...nextDepthQueue, ...queue];
    }

    const maxDepthReached = nodes.size > 0
        ? Math.max(...Array.from(nodes.values()).map((n) => n.depth))
        : 0;

    return {
        nodes: Array.from(nodes.values()),
        edges,
        centerNoteId,
        maxDepthReached,
        truncated: nodes.size >= maxNodes,
    };
}
