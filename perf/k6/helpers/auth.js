import { BASE_URL, AUTH_TOKEN } from "../config.js";

/**
 * Build default HTTP headers for JSON requests including bearer authentication.
 * @returns {{ "Content-Type": string, Authorization: string }} An object with `"Content-Type"` set to `"application/json"` and `Authorization` set to `Bearer ${AUTH_TOKEN}`.
 */
export function authHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };
}

/**
 * Build a full request URL by concatenating the configured base URL with the provided path.
 * @param {string} path - The request path or endpoint to append to the base URL.
 * @returns {string} The combined URL (BASE_URL followed by `path`).
 */
export function url(path) {
    return `${BASE_URL}${path}`;
}
