import { mock, beforeEach, beforeAll, describe, expect, it } from "bun:test";

// Mock environment
mock.module("../env.ts", () => ({
    env: {
        VAPID_PUBLIC_KEY: "mock-pub-key",
        VAPID_PRIVATE_KEY: "mock-priv-key",
        VAPID_SUBJECT: "mailto:admin@example.com",
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost:5436/allknower_test",
        NODE_ENV: "test",
    },
}));

// Mock logger
const mockLog = {
    child: () => mockLog,
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
};
mock.module("../logger.ts", () => ({
    rootLogger: mockLog,
}));

// Mock web-push
const mockSetVapidDetails = mock(() => {});
const mockSendNotification = mock(async () => {});
mock.module("web-push", () => ({
    default: {
        setVapidDetails: mockSetVapidDetails,
        sendNotification: mockSendNotification,
    },
}));

// Mock prisma
const mockFindMany = mock(async (): Promise<any[]> => []);
const mockDelete = mock(async (): Promise<any> => ({}));
mock.module("../db/client.ts", () => ({
    default: {
        pushSubscription: {
            findMany: mockFindMany,
            delete: mockDelete,
        },
    },
}));

let firePushNotifications: any;

beforeAll(async () => {
    const mod = await import("./push-notify.ts");
    firePushNotifications = mod.firePushNotifications;
});

beforeEach(() => {
    mockSendNotification.mockClear();
    mockFindMany.mockClear();
    mockDelete.mockClear();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
});

describe("push-notify pipeline", () => {
    it("calls setVapidDetails on initialization if keys are present", () => {
        expect(mockSetVapidDetails).toHaveBeenCalledWith(
            "mailto:admin@example.com",
            "mock-pub-key",
            "mock-priv-key"
        );
    });

    it("does not fire push notifications if user has no subscriptions", async () => {
        mockFindMany.mockResolvedValue([]);

        await firePushNotifications("user-1", { title: "Hello", body: "World" });

        expect(mockFindMany).toHaveBeenCalledTimes(1);
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it("handles database errors when fetching subscriptions", async () => {
        mockFindMany.mockRejectedValue(new Error("DB error"));

        await firePushNotifications("user-1", { title: "Hello", body: "World" });

        expect(mockFindMany).toHaveBeenCalledTimes(1);
        expect(mockSendNotification).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(
            "Failed to fetch subscriptions",
            expect.objectContaining({ userId: "user-1", error: "Error: DB error" })
        );
    });

    it("sends notifications to all user subscriptions", async () => {
        mockFindMany.mockResolvedValue([
            { id: "sub-1", endpoint: "endpoint-1", p256dh: "dh-1", auth: "auth-1" },
            { id: "sub-2", endpoint: "endpoint-2", p256dh: "dh-2", auth: "auth-2" },
        ]);

        await firePushNotifications("user-1", { title: "Hello", body: "World", href: "/test" });

        expect(mockSendNotification).toHaveBeenCalledTimes(2);
        expect(mockSendNotification).toHaveBeenCalledWith(
            { endpoint: "endpoint-1", keys: { p256dh: "dh-1", auth: "auth-1" } },
            JSON.stringify({ title: "Hello", body: "World", href: "/test" })
        );
        expect(mockSendNotification).toHaveBeenCalledWith(
            { endpoint: "endpoint-2", keys: { p256dh: "dh-2", auth: "auth-2" } },
            JSON.stringify({ title: "Hello", body: "World", href: "/test" })
        );
    });

    it("removes expired subscriptions (statusCode 410 or 404)", async () => {
        mockFindMany.mockResolvedValue([
            { id: "sub-1", endpoint: "endpoint-1", p256dh: "dh-1", auth: "auth-1" },
        ]);
        
        const error: any = new Error("Subscription expired");
        error.statusCode = 410;
        mockSendNotification.mockRejectedValue(error);

        await firePushNotifications("user-1", { title: "Hello", body: "World" });

        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockDelete).toHaveBeenCalledWith({ where: { id: "sub-1" } });
        expect(mockLog.info).toHaveBeenCalledWith(
            "Removing expired subscription",
            { subscriptionId: "sub-1" }
        );
    });

    it("logs failure on other push errors", async () => {
        mockFindMany.mockResolvedValue([
            { id: "sub-1", endpoint: "endpoint-1", p256dh: "dh-1", auth: "auth-1" },
        ]);
        
        const error: any = new Error("Quota exceeded");
        error.statusCode = 403;
        mockSendNotification.mockRejectedValue(error);

        await firePushNotifications("user-1", { title: "Hello", body: "World" });

        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(
            "Push send failed",
            expect.objectContaining({ subscriptionId: "sub-1" })
        );
    });

    it("does not throw if prisma delete fails when removing expired subscription", async () => {
        mockFindMany.mockResolvedValue([
            { id: "sub-1", endpoint: "endpoint-1", p256dh: "dh-1", auth: "auth-1" },
        ]);
        
        const error: any = new Error("Subscription expired");
        error.statusCode = 410;
        mockSendNotification.mockRejectedValue(error);
        mockDelete.mockRejectedValue(new Error("DB delete error"));

        await expect(
            firePushNotifications("user-1", { title: "Hello", body: "World" })
        ).resolves.toBeUndefined();

        expect(mockSendNotification).toHaveBeenCalledTimes(1);
        expect(mockDelete).toHaveBeenCalledWith({ where: { id: "sub-1" } });
    });
});
