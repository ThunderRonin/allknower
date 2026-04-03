export interface RouteApp {
    handle(request: Request): Promise<Response>;
}

export async function requestJson(
    app: RouteApp,
    path: string,
    init: RequestInit & { json?: unknown } = {}
) {
    const headers = new Headers(init.headers ?? {});
    const body = init.json === undefined ? init.body : JSON.stringify(init.json);

    if (init.json !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const response = await app.handle(new Request(`http://localhost${path}`, {
        ...init,
        headers,
        body,
    }));

    const text = await response.text();

    let json: unknown = null;
    if (text.length > 0) {
        try {
            json = JSON.parse(text);
        } catch {
            json = text;
        }
    }

    return {
        response,
        status: response.status,
        json,
        text,
    };
}