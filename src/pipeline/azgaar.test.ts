import { describe, expect, it } from "bun:test";
import { isAzgaarMapData, getMapPreview } from "./azgaar.ts";
import type { AzgaarMapData } from "./azgaar.ts";

describe("isAzgaarMapData", () => {
    it("null → false", () => expect(isAzgaarMapData(null)).toBe(false));
    it("undefined → false", () => expect(isAzgaarMapData(undefined)).toBe(false));
    it("string → false", () => expect(isAzgaarMapData("map")).toBe(false));
    it("number → false", () => expect(isAzgaarMapData(42)).toBe(false));
    it("{} → false (no pack)", () => expect(isAzgaarMapData({})).toBe(false));
    it("{ pack: null } → false", () => expect(isAzgaarMapData({ pack: null })).toBe(false));
    it("{ pack: {} } → false (no arrays)", () => expect(isAzgaarMapData({ pack: {} })).toBe(false));
    it('{ pack: { burgs: "not-array" } } → false', () =>
        expect(isAzgaarMapData({ pack: { burgs: "not-array" } })).toBe(false));
    it("{ pack: { burgs: [] } } → true", () =>
        expect(isAzgaarMapData({ pack: { burgs: [] } })).toBe(true));
    it("{ pack: { states: [] } } → true", () =>
        expect(isAzgaarMapData({ pack: { states: [] } })).toBe(true));
    it("{ pack: { religions: [] } } → true", () =>
        expect(isAzgaarMapData({ pack: { religions: [] } })).toBe(true));
    it("full valid export shape → true", () => {
        const map: AzgaarMapData = {
            info: { mapName: "Valdoria", version: "1.7.0" },
            settings: { mapName: "Valdoria" },
            pack: {
                burgs: [{ i: 0, name: "" }, { i: 1, name: "Ironmark" }],
                states: [{ i: 0, name: "" }, { i: 1, name: "Valorheim" }],
                religions: [],
                cultures: [],
            },
            notes: [],
        };
        expect(isAzgaarMapData(map)).toBe(true);
    });
    it("export with info.mapName → true", () => {
        expect(isAzgaarMapData({ info: { mapName: "Test" }, pack: { burgs: [] } })).toBe(true);
    });
    it("export with only settings.mapName (no info) → true", () => {
        expect(isAzgaarMapData({ settings: { mapName: "Test" }, pack: { states: [] } })).toBe(true);
    });
});

describe("getMapPreview", () => {
    it("skips i=0 entries (reserved slot in Azgaar model)", () => {
        const map: AzgaarMapData = {
            pack: {
                burgs: [{ i: 0, name: "reserved" }, { i: 1, name: "Ironmark" }],
            },
        };
        const preview = getMapPreview(map);
        expect(preview.burgCnt).toBe(1);
    });

    it("skips removed=true entries", () => {
        const map: AzgaarMapData = {
            pack: {
                burgs: [
                    { i: 0, name: "" },
                    { i: 1, name: "Ironmark", removed: false },
                    { i: 2, name: "OldCity", removed: true },
                ],
            },
        };
        expect(getMapPreview(map).burgCnt).toBe(1);
    });

    it("counts valid burgs correctly (i>0, !removed)", () => {
        const map: AzgaarMapData = {
            pack: {
                burgs: [
                    { i: 0, name: "" },
                    { i: 1, name: "A" },
                    { i: 2, name: "B" },
                    { i: 3, name: "C", removed: true },
                ],
            },
        };
        expect(getMapPreview(map).burgCnt).toBe(2);
    });

    it("counts valid states correctly", () => {
        const map: AzgaarMapData = {
            pack: {
                states: [
                    { i: 0, name: "" },
                    { i: 1, name: "Valorheim" },
                    { i: 2, name: "Ironland", removed: true },
                ],
            },
        };
        expect(getMapPreview(map).stateCnt).toBe(1);
    });

    it("counts valid religions correctly", () => {
        const map: AzgaarMapData = {
            pack: {
                religions: [{ i: 0, name: "" }, { i: 1, name: "Sunfaith" }, { i: 2, name: "Moonpath" }],
            },
        };
        expect(getMapPreview(map).religionCnt).toBe(2);
    });

    it("counts valid cultures correctly", () => {
        const map: AzgaarMapData = {
            pack: {
                // Use burgs to satisfy isAzgaarMapData check (not needed here, plain object)
                cultures: [{ i: 0, name: "" }, { i: 1, name: "Nordic" }],
            },
        };
        expect(getMapPreview(map).cultureCnt).toBe(1);
    });

    it("counts map notes correctly (no i field — all are valid)", () => {
        const map: AzgaarMapData = {
            pack: {},
            notes: [
                { id: "n1", name: "Ancient Ruin" },
                { id: "n2", name: "Dragon Lair" },
            ],
        };
        expect(getMapPreview(map).noteCnt).toBe(2);
    });

    it("uses info.mapName as primary name source", () => {
        const map: AzgaarMapData = {
            info: { mapName: "PrimaryName" },
            settings: { mapName: "FallbackName" },
            pack: { burgs: [] },
        };
        expect(getMapPreview(map).mapName).toBe("PrimaryName");
    });

    it("falls back to settings.mapName when info absent", () => {
        const map: AzgaarMapData = {
            settings: { mapName: "FallbackName" },
            pack: { burgs: [] },
        };
        expect(getMapPreview(map).mapName).toBe("FallbackName");
    });

    it('falls back to "Unnamed Map" when both absent', () => {
        const map: AzgaarMapData = { pack: { burgs: [] } };
        expect(getMapPreview(map).mapName).toBe("Unnamed Map");
    });

    it("info.mapName takes priority over settings.mapName", () => {
        const map: AzgaarMapData = {
            info: { mapName: "InfoName" },
            settings: { mapName: "SettingsName" },
            pack: { states: [] },
        };
        expect(getMapPreview(map).mapName).toBe("InfoName");
    });

    it("empty pack arrays → all counts 0", () => {
        const map: AzgaarMapData = {
            pack: { burgs: [], states: [], religions: [], cultures: [] },
            notes: [],
        };
        const p = getMapPreview(map);
        expect(p.burgCnt).toBe(0);
        expect(p.stateCnt).toBe(0);
        expect(p.religionCnt).toBe(0);
        expect(p.cultureCnt).toBe(0);
        expect(p.noteCnt).toBe(0);
    });

    it("null pack → all counts 0 (handles missing pack gracefully)", () => {
        // getMapPreview uses `map.pack ?? {}` — undefined pack is safe
        const map = { info: { mapName: "Test" } } as AzgaarMapData;
        const p = getMapPreview(map);
        expect(p.burgCnt).toBe(0);
        expect(p.stateCnt).toBe(0);
    });
});
