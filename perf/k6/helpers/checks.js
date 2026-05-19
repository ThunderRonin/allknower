import { check } from "k6";

/**
 * Assert that an HTTP response has the expected status code and record the check under a label.
 * @param {object} res - The k6 HTTP response object to validate (`res.status` expected).
 * @param {number} [expected=200] - The HTTP status code expected on the response.
 * @param {string} [name=""] - Optional custom label for the check; when omitted the label is `status is ${expected}`.
 */
export function checkStatus(res, expected = 200, name = "") {
    const label = name || `status is ${expected}`;
    check(res, { [label]: (r) => r.status === expected });
}

/**
 * Performs a k6 check that the response body is valid JSON.
 * Records the check result under the provided label.
 * @param {Object} res - HTTP response object whose `body` will be parsed as JSON.
 * @param {string} [name="response is JSON"] - Label to use for the check result.
 */
export function checkJson(res, name = "response is JSON") {
    check(res, {
        [name]: (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        },
    });
}

/**
 * Asserts that the response duration is less than the specified threshold in milliseconds.
 *
 * If `name` is provided it is used as the check label; otherwise the label defaults to `latency < ${maxMs}ms`.
 * @param {object} res - The HTTP response object to evaluate (k6 response).
 * @param {number} maxMs - Maximum allowed duration in milliseconds.
 * @param {string} [name] - Optional custom label for the check.
 */
export function checkLatency(res, maxMs, name = "") {
    const label = name || `latency < ${maxMs}ms`;
    check(res, { [label]: (r) => r.timings.duration < maxMs });
}
