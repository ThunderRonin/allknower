/**
 * AllCodex ETAPI Client
 *
 * HTTP client for communicating with AllCodex (Trilium) via its REST API.
 * Auth: Raw ETAPI token in Authorization header.
 *
 * ETAPI reference: apps/server/etapi.openapi.yaml in AllCodex repo
 */

import { env } from "../env.ts";
import prisma from "../db/client.ts";

// ── Credential cache ─────────────────────────────────────────────────────────
// Credentials are loaded from AppConfig (DB) with a 60-second TTL, falling back
// to env vars. This allows the portal to update AllCodex credentials at runtime
// without restarting AllKnower.

let _credCache: { url: string; token: string } | null = null;
let _credCacheAt = 0;
const CRED_TTL_MS = 60_000;

export function invalidateCredentialCache(): void {
    _credCache = null;
    _credCacheAt = 0;
}

async function getCredentials(): Promise<{ url: string; token: string }> {
    const now = Date.now();
    if (_credCache && now - _credCacheAt < CRED_TTL_MS) return _credCache;
    try {
        const [urlRecord, tokenRecord] = await Promise.all([
            prisma.appConfig.findUnique({ where: { key: "allcodexUrl" } }),
            prisma.appConfig.findUnique({ where: { key: "allcodexToken" } }),
        ]);
        const url = urlRecord?.value || env.ALLCODEX_URL;
        const token = tokenRecord?.value || env.ALLCODEX_ETAPI_TOKEN;
        _credCache = { url, token };
        _credCacheAt = now;
        return _credCache;
    } catch {
        // DB unavailable — fall back to env
        return { url: env.ALLCODEX_URL, token: env.ALLCODEX_ETAPI_TOKEN };
    }
}

/**
 * Lightweight connectivity check — verifies the ETAPI token is valid.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function probeAllCodex(): Promise<{ ok: boolean; error?: string }> {
    let url: string;
    let token: string;
    try {
        ({ url, token } = await getCredentials());
    } catch {
        return { ok: false, error: "Failed to load AllCodex credentials" };
    }
    if (!token) return { ok: false, error: "ALLCODEX_ETAPI_TOKEN is not configured" };
    try {
        const res = await fetch(`${url}/etapi/app-info`, {
            headers: { Authorization: token },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { ok: false, error: `AllCodex ETAPI returned HTTP ${res.status}` };
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `AllCodex unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
}

async function etapiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const { url: BASE_URL, token: TOKEN } = await getCredentials();
    const url = `${BASE_URL}/etapi${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: TOKEN,
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`ETAPI ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`);
    }

    return res;
}

// ── Note Operations ───────────────────────────────────────────────────────────

export interface EtapiNote {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isProtected: boolean;
    dateCreated: string;
    dateModified: string;
    utcDateCreated: string;
    utcDateModified: string;
    parentNoteIds: string[];
    childNoteIds: string[];
    attributes: EtapiAttribute[];
}

export interface EtapiAttribute {
    attributeId: string;
    noteId: string;
    type: "label" | "relation";
    name: string;
    value: string;
    isInheritable: boolean;
}

export interface CreateNoteParams {
    parentNoteId: string;
    title: string;
    type: "text" | "code" | "file" | "image" | "search" | "book" | "noteMap" | "webView";
    mime?: string;
    content?: string;
    notePosition?: number;
    prefix?: string;
    isExpanded?: boolean;
    noteId?: string;
}

/** Search for notes using Trilium's search syntax */
export async function getAllCodexNotes(search: string): Promise<EtapiNote[]> {
    const res = await etapiFetch(`/notes?search=${encodeURIComponent(search)}`);
    const data = await res.json() as { results: EtapiNote[] };
    return data.results;
}

/** Get a single note by ID */
export async function getNote(noteId: string): Promise<EtapiNote> {
    const res = await etapiFetch(`/notes/${noteId}`);
    return res.json() as Promise<EtapiNote>;
}

/** Get raw note content (HTML or plain text) */
export async function getNoteContent(noteId: string): Promise<string> {
    const res = await etapiFetch(`/notes/${noteId}/content`);
    return res.text();
}

/** Create a new note in AllCodex */
export async function createNote(params: CreateNoteParams): Promise<{ note: EtapiNote; branch: any }> {
    const res = await etapiFetch("/create-note", {
        method: "POST",
        body: JSON.stringify(params),
    });
    return res.json() as Promise<{ note: EtapiNote; branch: any }>;
}

/** Update note metadata (title, type) */
export async function updateNote(
    noteId: string,
    patch: Partial<Pick<EtapiNote, "title" | "type" | "mime">>
): Promise<EtapiNote> {
    const res = await etapiFetch(`/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    });
    return res.json() as Promise<EtapiNote>;
}

/** Set note content (HTML or plain text) */
export async function setNoteContent(noteId: string, content: string): Promise<void> {
    await etapiFetch(`/notes/${noteId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "text/html" },
        body: content,
    });
}

// ── Attribute Operations ──────────────────────────────────────────────────────

export interface CreateAttributeParams {
    noteId: string;
    type: "label" | "relation";
    name: string;
    value?: string;
    isInheritable?: boolean;
}

/** Create an attribute (label or relation) on a note */
export async function createAttribute(params: CreateAttributeParams): Promise<EtapiAttribute> {
    const res = await etapiFetch("/attributes", {
        method: "POST",
        body: JSON.stringify(params),
    });
    return res.json() as Promise<EtapiAttribute>;
}

/** Set a template relation on a note (links it to a lore template) */
export async function setNoteTemplate(noteId: string, templateNoteId: string): Promise<void> {
    await createAttribute({
        noteId,
        type: "relation",
        name: "template",
        value: templateNoteId,
    });
}

/** Tag a note with a label */
export async function tagNote(noteId: string, labelName: string, value: string = ""): Promise<void> {
    await createAttribute({ noteId, type: "label", name: labelName, value });
}

// ── Relation Operations ───────────────────────────────────────────────────────

/** Maps relationship types to Trilium relation attribute names */
const RELATION_NAME_MAP: Record<string, string> = {
    ally: "relAlly",
    enemy: "relEnemy",
    family: "relFamily",
    location: "relLocation",
    event: "relEvent",
    faction: "relFaction",
    other: "relOther",
};

export interface CreateRelationOptions {
    bidirectional?: boolean; // default true — also create inverse on target
    description?: string;   // written as #relationNote label for context
}

/**
 * Create a relation attribute linking sourceNoteId → targetNoteId.
 *
 * - Maps `relationshipType` to a `rel<Type>` attribute name convention
 * - Writes the description as a `#relationNote` label on the source note
 * - If bidirectional (default), creates the inverse on the target note too
 */
export async function createRelation(
    sourceNoteId: string,
    targetNoteId: string,
    relationshipType: string,
    options: CreateRelationOptions = {}
): Promise<void> {
    const { bidirectional = true, description } = options;
    const attrName = RELATION_NAME_MAP[relationshipType] ?? RELATION_NAME_MAP["other"];

    // Forward relation: source → target
    await createAttribute({
        noteId: sourceNoteId,
        type: "relation",
        name: attrName,
        value: targetNoteId,
    });

    // Write description as a label for inline context in AllCodex
    if (description) {
        await createAttribute({
            noteId: sourceNoteId,
            type: "label",
            name: "relationNote",
            value: `${relationshipType}:${targetNoteId}: ${description}`,
        });
    }

    // Inverse relation: target → source (bidirectional)
    if (bidirectional) {
        await createAttribute({
            noteId: targetNoteId,
            type: "relation",
            name: attrName,
            value: sourceNoteId,
        });

        if (description) {
            await createAttribute({
                noteId: targetNoteId,
                type: "label",
                name: "relationNote",
                value: `${relationshipType}:${sourceNoteId}: ${description}`,
            });
        }
    }
}

// ── Health Check ──────────────────────────────────────────────────────────────

/** Verify AllCodex is reachable via ETAPI */
export async function checkAllCodexHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
        const res = await etapiFetch("/app-info");
        const info = await res.json() as { appVersion: string };
        return { ok: true, version: info.appVersion };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}
