import { beforeEach, describe, expect, it, mock } from "bun:test";

const findUniqueMock = mock(async () => null as { value: string } | null);
const createMock = mock(async () => ({ key: "ownerUserId", value: "owner-1" }));

mock.module("../db/client.ts", () => ({
    default: {
        appConfig: {
            findUnique: findUniqueMock,
            create: createMock,
        },
    },
}));

const { ensureOwnerUserId, getOwnerUserId, isOwnerUserId, OWNER_USER_ID_KEY } = await import("./owner.ts");

beforeEach(() => {
    findUniqueMock.mockClear();
    findUniqueMock.mockResolvedValue(null);
    createMock.mockClear();
    createMock.mockResolvedValue({ key: OWNER_USER_ID_KEY, value: "owner-1" });
});

describe("owner auth helpers", () => {
    it("reads the configured owner user id", async () => {
        findUniqueMock.mockResolvedValue({ value: "owner-1" });

        await expect(getOwnerUserId()).resolves.toBe("owner-1");
        expect(findUniqueMock).toHaveBeenCalledWith({
            where: { key: OWNER_USER_ID_KEY },
            select: { value: true },
        });
    });

    it("creates owner config when no owner exists", async () => {
        await expect(ensureOwnerUserId("owner-1")).resolves.toBe("owner-1");

        expect(createMock).toHaveBeenCalledWith({
            data: { key: OWNER_USER_ID_KEY, value: "owner-1" },
        });
    });

    it("keeps existing owner when owner config already exists", async () => {
        findUniqueMock.mockResolvedValue({ value: "owner-1" });

        await expect(ensureOwnerUserId("owner-2")).resolves.toBe("owner-1");
        expect(createMock).not.toHaveBeenCalled();
    });

    it("returns concurrently-created owner instead of overwriting it", async () => {
        findUniqueMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ value: "owner-1" });
        createMock.mockRejectedValue(new Error("Unique constraint failed"));

        await expect(ensureOwnerUserId("owner-2")).resolves.toBe("owner-1");
    });

    it("checks whether a user id is the configured owner", async () => {
        findUniqueMock.mockResolvedValue({ value: "owner-1" });

        await expect(isOwnerUserId("owner-1")).resolves.toBe(true);
        await expect(isOwnerUserId("owner-2")).resolves.toBe(false);
        await expect(isOwnerUserId(null)).resolves.toBe(false);
    });
});
