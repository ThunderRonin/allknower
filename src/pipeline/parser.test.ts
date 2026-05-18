import { describe, expect, it } from "bun:test";
import { parseBrainDumpResponse } from "./parser";

describe("parser", () => {
    it("should parse valid JSON successfully", () => {
        const validJson = JSON.stringify({
            entities: [
                {
                    type: "character",
                    title: "Arthur",
                    content: "<p>The great king.</p>",
                    attributes: {},
                    action: "create"
                }
            ],
            summary: "Extracted a character."
        });

        const result = parseBrainDumpResponse(validJson);
        expect(result.summary).toBe("Extracted a character.");
        expect(result.entities.length).toBe(1);
        expect(result.entities[0].title).toBe("Arthur");
    });

    it("should throw error for completely invalid JSON", () => {
        expect(() => parseBrainDumpResponse("Not JSON")).toThrow("LLM returned invalid JSON");
    });

    it("should safely drop malformed entities but keep valid ones", () => {
        const mixedJson = JSON.stringify({
            entities: [
                {
                    type: "character",
                    title: "Arthur",
                    content: "<p>The great king.</p>",
                    attributes: {},
                    action: "create"
                },
                {
                    // Malformed: missing type
                    title: "Bad Entity",
                    action: "create"
                }
            ],
            summary: "Extracted mixed entities."
        });

        const result = parseBrainDumpResponse(mixedJson);
        expect(result.entities.length).toBe(1); // Dropped the bad one
        expect(result.entities[0].title).toBe("Arthur");
    });

    it("should coerce comma-string faction fields into arrays (LLM formatting quirk)", () => {
        // LLMs often return members/allies/enemies as comma-separated strings instead of arrays.
        // The coerceToArray helper in lore.ts should handle this gracefully.
        const json = JSON.stringify({
            entities: [
                {
                    type: "faction",
                    title: "Übermenschreich",
                    content: "<p>A militarized technocratic superpower.</p>",
                    attributes: {
                        members: "The Chancellor, The General Council",
                        allies: "Iron Pact",
                        enemies: "The Free Cities, The Wanderers",
                        factionType: "Empire",
                    },
                    action: "create"
                }
            ],
            summary: "Extracted a faction with string-formatted arrays."
        });

        const result = parseBrainDumpResponse(json);
        expect(result.entities.length).toBe(1);

        const faction = result.entities[0];
        expect(faction.title).toBe("Übermenschreich");
        // @ts-expect-error — accessing typed attributes union
        expect(Array.isArray(faction.attributes.members)).toBe(true);
        // @ts-expect-error
        expect(faction.attributes.members).toEqual(["The Chancellor", "The General Council"]);
        // @ts-expect-error
        expect(Array.isArray(faction.attributes.allies)).toBe(true);
        // @ts-expect-error
        expect(faction.attributes.enemies).toEqual(["The Free Cities", "The Wanderers"]);
    });

    it("should parse rich wiki-style HTML content with all formatting elements", () => {
        const richContent = [
            '<blockquote>"The weak beg for mercy."<br><em>— Kommandant Voss</em></blockquote>',
            '<h2>Overview</h2>',
            '<p><strong>Voss Ironhelm</strong> is a feared commander with a <mark>50,000 gold</mark> bounty.</p>',
            '<hr>',
            '<h2>History</h2>',
            '<h3>Early Years</h3>',
            '<p>Born in <strong>Eisenstadt</strong>.</p>',
            '<table><thead><tr><th>Enhancement</th><th>Effect</th></tr></thead>',
            '<tbody><tr><td>Titanium Frame</td><td>400% bone density</td></tr></tbody></table>',
            '<hr>',
            '<h2>Relationships</h2>',
            '<ul><li><strong>The Chancellor</strong> — transactional alliance</li></ul>',
            '<details><summary>Physical Specs</summary><p>193cm, 136kg</p></details>',
            '<div class="gm-only"><h2>GM Notes</h2><p>Voss is secretly planning a coup.</p></div>',
        ].join("\n");

        const json = JSON.stringify({
            entities: [
                {
                    type: "character",
                    title: "Kommandant Voss Ironhelm",
                    content: richContent,
                    tags: ["military", "antagonist", "empowered"],
                    attributes: {
                        fullName: "Voss Ironhelm",
                        race: "Human (Enhanced)",
                        role: "Kommandant",
                        status: "alive",
                        secrets: "Planning a military coup against the Chancellor",
                    },
                    action: "create"
                },
                {
                    type: "quest",
                    title: "Capture Kommandant Voss",
                    content: '<h2>Overview</h2><p>A <mark>50,000 gold crown</mark> bounty on Voss.</p><div class="gm-only"><p>Voss may offer alliance if cornered.</p></div>',
                    tags: ["bounty", "military"],
                    attributes: {
                        questStatus: "active",
                        questGiver: "Senate of the Free Cities",
                        reward: "50,000 gold crowns",
                    },
                    action: "create"
                },
                {
                    type: "session",
                    title: "Session 12: The Iron March Begins",
                    content: '<h2>Recap</h2><p>Party witnessed the siege.</p>',
                    attributes: {
                        sessionDate: "2026-05-10",
                        sessionStatus: "complete",
                        recap: "Party witnessed the opening of the Iron March campaign",
                    },
                    action: "create"
                }
            ],
            summary: "Extracted character with rich wiki formatting, a quest, and a session."
        });

        const result = parseBrainDumpResponse(json);
        expect(result.entities.length).toBe(3);

        const voss = result.entities[0];
        expect(voss.title).toBe("Kommandant Voss Ironhelm");
        expect(voss.content).toContain("<h2>");
        expect(voss.content).toContain("<table>");
        expect(voss.content).toContain('<div class="gm-only">');
        expect(voss.content).toContain("<blockquote>");
        expect(voss.content).toContain("<details>");
        expect(voss.content).toContain("<mark>");

        const quest = result.entities[1];
        expect(quest.type).toBe("quest");
        // @ts-expect-error — accessing typed attributes union
        expect(quest.attributes.questStatus).toBe("active");

        const session = result.entities[2];
        expect(session.type).toBe("session");
        // @ts-expect-error
        expect(session.attributes.sessionDate).toBe("2026-05-10");
    });
});
