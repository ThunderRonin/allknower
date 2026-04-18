import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";

// Import after env side-effects are irrelevant (logger.ts doesn't call parseEnv)
import { rootLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

describe("Logger", () => {
    let logSpy: Mock<typeof console.log>;
    let warnSpy: Mock<typeof console.warn>;
    let errorSpy: Mock<typeof console.error>;

    beforeEach(() => {
        logSpy = spyOn(console, "log").mockImplementation(() => {});
        warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        errorSpy = spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("emits JSON to console.log on info()", () => {
        rootLogger.info("test info");
        expect(logSpy).toHaveBeenCalledTimes(1);
        const arg = logSpy.mock.calls[0][0] as string;
        expect(() => JSON.parse(arg)).not.toThrow();
    });

    it("emits JSON to console.warn on warn()", () => {
        rootLogger.warn("test warn");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const arg = warnSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.level).toBe("warn");
    });

    it("emits JSON to console.error on error()", () => {
        rootLogger.error("test error");
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const arg = errorSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.level).toBe("error");
    });

    it("emitted JSON includes level, timestamp, message fields", () => {
        rootLogger.info("hello world");
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.level).toBe("info");
        expect(typeof obj.timestamp).toBe("string");
        expect(obj.message).toBe("hello world");
    });

    it("emitted JSON includes context fields from constructor", () => {
        const child = rootLogger.child({ task: "test-task", requestId: "abc123" });
        child.info("contextual");
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.task).toBe("test-task");
        expect(obj.requestId).toBe("abc123");
    });

    it("child() creates new logger with merged context", () => {
        const parent = rootLogger.child({ service: "allknower" });
        const child = parent.child({ requestId: "req-1" });
        child.info("merged");
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.service).toBe("allknower");
        expect(obj.requestId).toBe("req-1");
    });

    it("child() does not mutate parent context", () => {
        const parent = rootLogger.child({ service: "allknower" });
        const child = parent.child({ requestId: "req-1" });
        parent.info("parent msg");
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.requestId).toBeUndefined();
    });

    it("data fields from info(msg, data) appear in emitted JSON", () => {
        rootLogger.info("with data", { noteId: "note-abc", chunkCount: 5 });
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.noteId).toBe("note-abc");
        expect(obj.chunkCount).toBe(5);
    });

    it("data fields override context fields of same name", () => {
        const logger = rootLogger.child({ task: "original" });
        logger.info("override", { task: "overridden" });
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        expect(obj.task).toBe("overridden");
    });

    it("timestamp is valid ISO string", () => {
        rootLogger.info("ts-test");
        const arg = logSpy.mock.calls[0][0] as string;
        const obj = JSON.parse(arg);
        const d = new Date(obj.timestamp);
        expect(isNaN(d.getTime())).toBe(false);
    });
});

describe("rootLogger", () => {
    it("is a Logger-like instance with info/warn/error methods", () => {
        expect(typeof rootLogger.info).toBe("function");
        expect(typeof rootLogger.warn).toBe("function");
        expect(typeof rootLogger.error).toBe("function");
        expect(typeof rootLogger.child).toBe("function");
    });
});
