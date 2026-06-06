export function isEmailSignUpRequest(request: Request): boolean {
    const url = new URL(request.url);
    return request.method === "POST" && url.pathname.endsWith("/api/auth/sign-up/email");
}

export function hasBootstrapSecret(request: Request, secret: string): boolean {
    return Boolean(secret) && request.headers.get("X-AllCodex-Bootstrap-Secret") === secret;
}
