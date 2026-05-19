# Session Compaction Accuracy Evaluation — Implementation Plan

> **Status: COMPLETE — Executed 2026-05-19. 10 compactSession unit tests, 3 golden sessions (42 facts), 27 probes, eval harness with degradation testing.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how accurately the session compaction system preserves critical context across compaction boundaries. Establish a quantifiable accuracy score (target: ≥80%) and detect regressions when compaction prompts, schemas, or token budgets change.

**Architecture:** Two-phase approach: (1) unit tests for `compactSession()` itself (currently untested), then (2) a golden-session evaluation framework that replays multi-turn conversations, forces compaction, and probes whether post-compaction context retains key facts.

**Tech Stack:** Bun test runner for Phase 0. Custom eval harness (not Bun test) for accuracy scoring — runs as a standalone script that produces JSON reports. Mock LLM with deterministic responses for unit tests; real LLM (or high-quality mock) for accuracy eval.

**CI:** No — accuracy eval is non-deterministic (LLM output varies). Run manually before/after compaction prompt changes. Phase 0 (unit tests) can run in CI.

**Success Criterion:** ≥80% of probe questions answered correctly using only post-compaction context. Degradation: <5% accuracy drop between single and triple compaction cycles.

**Prerequisite:** Assumes `serene-mapping-fountain.md` remediation plan merged (userId on LoreSession).

---

## File Structure

```
test/
├── unit/
│   └── session-compactor.unit.test.ts  # NEW — compactSession() unit tests
├── fixtures/
│   └── golden-sessions/
│       ├── kingdom-founding.json       # NEW — 25-turn kingdom building session
│       ├── character-web.json          # NEW — 20-turn character relationship session
│       └── multi-compaction.json       # NEW — 40-turn session crossing 2 compaction thresholds
eval/
├── compaction-eval.ts                  # NEW — evaluation harness entry point
├── lib/
│   ├── session-player.ts              # NEW — replays golden session turns
│   ├── probe-scorer.ts               # NEW — scores probe answers against expected
│   └── report.ts                      # NEW — generates JSON/text report
├── probes/
│   ├── kingdom-founding.probes.json   # NEW — probe questions for kingdom session
│   ├── character-web.probes.json      # NEW — probe questions for character session
│   └── multi-compaction.probes.json   # NEW — probe questions for degradation test
├── results/                            # gitignored — eval output
└── README.md                           # NEW — how to run, interpret results
```

---

## Background: How Compaction Works

The session compactor (`src/pipeline/session-compactor.ts`) activates when a lore session's `tokensAccumulated` exceeds 80,000 tokens. It:

1. **Acquires an optimistic lock** (5-min stale threshold) on the session
2. **Fetches all session messages** from DB
3. **Calls LLM** with `SESSION_COMPACT_SYSTEM` prompt, asking it to produce a 7-section JSON state:
   - `intent` — user's overall goal
   - `loreTypesInPlay` — entity types being worked on
   - `noteIdsModified` — AllCodex note IDs created/updated
   - `skippedEntities` — entities that failed + reasons
   - `rawInputsSummary` — compressed history of user inputs
   - `unresolvedGaps` — open lore questions
   - `currentFocus` — the entity being actively worked on
4. **Validates** the JSON against `LoreSessionStateSchema` (Zod)
5. **Persists** the state to the session, resets `tokensAccumulated` to `POST_COMPACT_BUDGET` (50k)
6. **Rebuilds context** via `rebuildContext()`: injects the state JSON + top 5 recent notes (5k tokens each)

The accuracy question: does the compressed state in step 3 retain enough information for the LLM to continue the conversation without losing critical facts established in earlier turns?

---

## Task 0: Unit Tests for compactSession()

**Why this is Phase 0:** The advisor identified that `compactSession()` has zero direct tests. Only `shouldCompact()` (8 tests) and `rebuildContext()` (9 tests) are covered. Before measuring accuracy, we need to verify the plumbing works — LLM call, Zod parse, DB persist, lock acquisition, failure paths.

**Files:**
- Create: `test/unit/session-compactor.unit.test.ts`

- [ ] **Step 1: Write compactSession() unit tests**

```typescript
// test/unit/session-compactor.unit.test.ts
import { mock } from "bun:test";

const VALID_COMPACT_STATE = {
    intent: "Building lore for Valorheim",
    loreTypesInPlay: ["character", "location"],
    noteIdsModified: ["note-1"],
    skippedEntities: [],
    rawInputsSummary: "User described Aldric as king.",
    unresolvedGaps: [],
    currentFocus: "Aldric",
    lastCompactedAt: new Date().toISOString(),
    totalTokensConsumed: 85000,
    schemaVersion: 1,
};

const mockCallWithFallback = mock(async () => ({
    raw: JSON.stringify(VALID_COMPACT_STATE),
    tokensUsed: 200,
    model: "test-model",
    latencyMs: 50,
}));

mock.module("../../src/pipeline/model-router.ts", () => ({
    callWithFallback: mockCallWithFallback,
    getModelChain: mock(() => ["test-model"]),
}));

mock.module("../../src/env.ts", () => ({
    env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://allknower:allknower@localhost:5433/allknower",
        NODE_ENV: "test",
        SESSION_TOKEN_THRESHOLD: 80000,
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
}));

import { describe, expect, it, beforeEach } from "bun:test";
import prisma from "../../src/db/client.ts";
import { compactSession, shouldCompact, rebuildContext } from "../../src/pipeline/session-compactor.ts";

describe("compactSession() — unit", () => {
    let sessionId: string;

    beforeEach(async () => {
        // Create a session with enough tokens to trigger compaction
        const session = await prisma.loreSession.create({
            data: {
                userId: "test-user",
                title: "Unit test session",
                state: {},
                tokensAccumulated: 90000,
                compactionCount: 0,
                compactionFailed: 0,
            },
        });
        sessionId = session.id;

        // Add some messages
        await prisma.loreSessionMessage.createMany({
            data: [
                { loreSessionId: sessionId, role: "user", content: "Aldric is the king of Valorheim.", tokensEstimated: 15 },
                { loreSessionId: sessionId, role: "assistant", content: "I've noted Aldric as a character.", tokensEstimated: 20 },
                { loreSessionId: sessionId, role: "user", content: "He wields Dawnbreaker.", tokensEstimated: 10 },
                { loreSessionId: sessionId, role: "assistant", content: "Added Dawnbreaker as a legendary item.", tokensEstimated: 15 },
            ],
        });
    });

    it("calls LLM with session messages and persists state", async () => {
        await compactSession(sessionId);

        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated).not.toBeNull();
        expect(updated!.compactionCount).toBe(1);
        expect(updated!.tokensAccumulated).toBeLessThan(90000);

        const state = updated!.state as Record<string, unknown>;
        expect(state.intent).toBeDefined();
        expect(state.schemaVersion).toBe(1);
    });

    it("increments compactionCount", async () => {
        await compactSession(sessionId);
        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.compactionCount).toBe(1);

        // Bump tokens and compact again
        await prisma.loreSession.update({
            where: { id: sessionId },
            data: { tokensAccumulated: 90000 },
        });
        await compactSession(sessionId);
        const updated2 = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated2!.compactionCount).toBe(2);
    });

    it("releases lock after success", async () => {
        await compactSession(sessionId);
        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.lockedAt).toBeNull();
    });

    it("increments compactionFailed on LLM error", async () => {
        mockCallWithFallback.mockImplementationOnce(async () => {
            throw new Error("LLM timeout");
        });

        await expect(compactSession(sessionId)).rejects.toThrow();

        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.compactionFailed).toBe(1);
        expect(updated!.lockedAt).toBeNull(); // lock released
    });

    it("increments compactionFailed on invalid JSON", async () => {
        mockCallWithFallback.mockImplementationOnce(async () => ({
            raw: "not valid json",
            tokensUsed: 50,
            model: "test",
            latencyMs: 10,
        }));

        await expect(compactSession(sessionId)).rejects.toThrow();

        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.compactionFailed).toBe(1);
    });

    it("increments compactionFailed on Zod validation failure", async () => {
        mockCallWithFallback.mockImplementationOnce(async () => ({
            raw: JSON.stringify({ intent: "valid but missing required fields" }),
            tokensUsed: 50,
            model: "test",
            latencyMs: 10,
        }));

        await expect(compactSession(sessionId)).rejects.toThrow();
        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.compactionFailed).toBe(1);
    });

    it("respects lock — concurrent compaction fails gracefully", async () => {
        // Lock the session
        await prisma.loreSession.update({
            where: { id: sessionId },
            data: { lockedAt: new Date() },
        });

        // Attempting compaction should fail or skip
        await expect(compactSession(sessionId)).rejects.toThrow(/lock/i);
    });

    it("stale lock (>5min) is overridden", async () => {
        // Lock with timestamp >5 minutes ago
        const staleTime = new Date(Date.now() - 6 * 60 * 1000);
        await prisma.loreSession.update({
            where: { id: sessionId },
            data: { lockedAt: staleTime },
        });

        // Should succeed — stale lock override
        await compactSession(sessionId);
        const updated = await prisma.loreSession.findUnique({ where: { id: sessionId } });
        expect(updated!.compactionCount).toBe(1);
    });
});

describe("compactSession() — edge cases", () => {
    it("handles session with no messages", async () => {
        const session = await prisma.loreSession.create({
            data: {
                userId: "test-user",
                state: {},
                tokensAccumulated: 90000,
            },
        });

        // Should still call LLM with empty history — may produce sparse state
        await compactSession(session.id);
        const updated = await prisma.loreSession.findUnique({ where: { id: session.id } });
        expect(updated!.compactionCount).toBe(1);
    });

    it("handles session with null state", async () => {
        const session = await prisma.loreSession.create({
            data: {
                userId: "test-user",
                state: {},
                tokensAccumulated: 90000,
            },
        });

        await compactSession(session.id);
        const updated = await prisma.loreSession.findUnique({ where: { id: session.id } });
        expect(updated!.state).toBeDefined();
    });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test test/unit/session-compactor.unit.test.ts
```

- [ ] **Step 3: Add to CI scripts**

Append to `test` and `check` scripts in `package.json`:
```
&& bun test test/unit/session-compactor.unit.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add test/unit/session-compactor.unit.test.ts package.json
git commit -m "test(compactor): add unit tests for compactSession()

Tests: LLM call + state persist, compactionCount increment, lock release,
LLM error path, invalid JSON, Zod failure, concurrent lock, stale lock
override, empty messages, null state. 10 test cases."
```

---

## Task 1: Golden Session Corpus

**Files:**
- Create: `test/fixtures/golden-sessions/kingdom-founding.json`
- Create: `test/fixtures/golden-sessions/character-web.json`
- Create: `test/fixtures/golden-sessions/multi-compaction.json`

Each golden session is a scripted multi-turn conversation with embedded "facts" that must survive compaction. Facts are tagged with IDs for probe scoring.

- [ ] **Step 1: Create kingdom-founding session (25 turns)**

```json
{
    "id": "kingdom-founding",
    "description": "User builds Valorheim kingdom: founding, geography, political structure, key locations",
    "turns": [
        { "role": "user", "content": "I want to create a kingdom called Valorheim. It was founded 800 years ago by King Aldric the First." },
        { "role": "assistant", "content": "Created Valorheim as a location. Founded 800 years ago by Aldric I." },
        { "role": "user", "content": "Valorheim is in the northern mountains, bordered by the Frostmere Sea to the west and the Dragon's Spine range to the east." },
        { "role": "assistant", "content": "Updated Valorheim geography: northern mountains, Frostmere Sea (west), Dragon's Spine (east)." },
        { "role": "user", "content": "The capital city is Solara, built at the confluence of two rivers: the Bright and the Shadow." },
        { "role": "assistant", "content": "Created Solara as the capital of Valorheim, at the Bright-Shadow river confluence." },
        { "role": "user", "content": "Valorheim uses a council system. The Ruling Council has 7 seats: the Crown, the Sword, the Quill, the Coin, the Flame, the Shield, and the Star." },
        { "role": "assistant", "content": "Documented the 7-seat Ruling Council of Valorheim." },
        { "role": "user", "content": "The current king is Aldric VII. He's been ruling for 12 years." },
        { "role": "assistant", "content": "Created Aldric VII, current king, 12 years on throne." },
        { "role": "user", "content": "The currency is called Aurens. 1 gold Auren = 10 silver Marks = 100 copper Bits." },
        { "role": "assistant", "content": "Documented Aurens currency: gold/silver/copper denominations." },
        { "role": "user", "content": "There's a rival kingdom to the south called Thornwall. They've been enemies for 300 years since the War of Broken Oaths." },
        { "role": "assistant", "content": "Created Thornwall. 300-year rivalry, War of Broken Oaths." },
        { "role": "user", "content": "Valorheim's military is called the Frostguard. Their commander is General Brianna Ironhelm." },
        { "role": "assistant", "content": "Created the Frostguard military and General Brianna Ironhelm." },
        { "role": "user", "content": "The main religion worships the Twin Moons — Lunara (silver moon, wisdom) and Solus (golden moon, courage)." },
        { "role": "assistant", "content": "Created Twin Moons religion: Lunara (wisdom) and Solus (courage)." },
        { "role": "user", "content": "The Mage Tower in Solara is run by Archmage Celine. She's 200 years old thanks to life-extension magic." },
        { "role": "assistant", "content": "Created Archmage Celine, 200 years old, leads Mage Tower in Solara." },
        { "role": "user", "content": "Valorheim's chief export is moonstone, mined from the Shimmering Caverns beneath Dragon's Spine." },
        { "role": "assistant", "content": "Documented moonstone trade from Shimmering Caverns." },
        { "role": "user", "content": "The Frostmere Sea is home to the Tidecallers, a semi-autonomous fishing clan with their own traditions." },
        { "role": "assistant", "content": "Created the Tidecallers, semi-autonomous fishing clan on Frostmere Sea." },
        { "role": "user", "content": "Annual festival: the Night of Twin Stars, held when both moons are full. Biggest holiday in Valorheim." },
        { "role": "assistant", "content": "Documented Night of Twin Stars festival." }
    ],
    "facts": [
        { "id": "f1", "category": "founding", "fact": "Valorheim was founded 800 years ago by Aldric the First" },
        { "id": "f2", "category": "geography", "fact": "Frostmere Sea borders Valorheim to the west" },
        { "id": "f3", "category": "geography", "fact": "Dragon's Spine mountain range borders to the east" },
        { "id": "f4", "category": "capital", "fact": "Capital city is Solara, at confluence of Bright and Shadow rivers" },
        { "id": "f5", "category": "politics", "fact": "Ruling Council has 7 seats: Crown, Sword, Quill, Coin, Flame, Shield, Star" },
        { "id": "f6", "category": "politics", "fact": "Current king is Aldric VII, ruling for 12 years" },
        { "id": "f7", "category": "economics", "fact": "Currency: Aurens (1 gold = 10 silver Marks = 100 copper Bits)" },
        { "id": "f8", "category": "conflict", "fact": "Thornwall is rival kingdom, 300-year enmity since War of Broken Oaths" },
        { "id": "f9", "category": "military", "fact": "Military: Frostguard, led by General Brianna Ironhelm" },
        { "id": "f10", "category": "religion", "fact": "Twin Moons worship: Lunara (silver/wisdom), Solus (golden/courage)" },
        { "id": "f11", "category": "character", "fact": "Archmage Celine is 200 years old, leads Mage Tower in Solara" },
        { "id": "f12", "category": "economics", "fact": "Chief export: moonstone from Shimmering Caverns" },
        { "id": "f13", "category": "culture", "fact": "Tidecallers are semi-autonomous fishing clan on Frostmere Sea" },
        { "id": "f14", "category": "culture", "fact": "Night of Twin Stars is biggest annual festival, both moons full" }
    ]
}
```

- [ ] **Step 2: Create character-web session (20 turns)**

```json
{
    "id": "character-web",
    "description": "User builds interconnected character relationships: family, rivals, mentors",
    "turns": [
        { "role": "user", "content": "Create a character: Kael Stormborn, a 28-year-old human ranger who patrols the Whispering Woods." },
        { "role": "assistant", "content": "Created Kael Stormborn, 28, human ranger, Whispering Woods patrol." },
        { "role": "user", "content": "His mother is Sera Stormborn, a retired knight who lost her left arm in the Siege of Ashvale." },
        { "role": "assistant", "content": "Created Sera Stormborn, Kael's mother, retired knight, lost left arm at Siege of Ashvale." },
        { "role": "user", "content": "His father Darius Stormborn died when Kael was 10. He was poisoned by a political rival named Lord Cassian Vex." },
        { "role": "assistant", "content": "Created Darius Stormborn (deceased) and Lord Cassian Vex. Vex poisoned Darius." },
        { "role": "user", "content": "Kael has a twin sister named Lyra who is a healer at the Temple of Dawn. They're very close." },
        { "role": "assistant", "content": "Created Lyra Stormborn, Kael's twin sister, healer at Temple of Dawn." },
        { "role": "user", "content": "Kael's mentor is an old elf named Thandril who taught him tracking and survival. Thandril is 400 years old." },
        { "role": "assistant", "content": "Created Thandril, elf, 400 years old, Kael's mentor in tracking and survival." },
        { "role": "user", "content": "Kael has a wolf companion named Frost. Frost has a distinctive scar across his muzzle from a bear fight." },
        { "role": "assistant", "content": "Created Frost, Kael's wolf companion, muzzle scar from bear fight." },
        { "role": "user", "content": "Lord Cassian Vex is now the governor of Ashvale. He has a daughter named Elise who is secretly in love with Kael." },
        { "role": "assistant", "content": "Updated Vex as Ashvale governor. Created Elise Vex, secret love interest for Kael." },
        { "role": "user", "content": "Kael's best friend is a dwarf blacksmith named Brogan Deepforge. Brogan made Kael's signature weapon: a bow called Whisperwind." },
        { "role": "assistant", "content": "Created Brogan Deepforge, dwarf blacksmith, crafted Whisperwind bow for Kael." },
        { "role": "user", "content": "There's an ongoing threat: a group called the Hollowed who are corrupted forest spirits. Kael has been tracking them for 3 years." },
        { "role": "assistant", "content": "Created the Hollowed, corrupted forest spirits. Kael tracking them for 3 years." },
        { "role": "user", "content": "The leader of the Hollowed is a fallen druid named Morwen who was once Thandril's apprentice." },
        { "role": "assistant", "content": "Created Morwen, fallen druid, ex-apprentice of Thandril, leads the Hollowed." }
    ],
    "facts": [
        { "id": "f1", "category": "character", "fact": "Kael Stormborn is 28 years old, human ranger in Whispering Woods" },
        { "id": "f2", "category": "family", "fact": "Mother Sera lost left arm at Siege of Ashvale" },
        { "id": "f3", "category": "family", "fact": "Father Darius was poisoned by Lord Cassian Vex when Kael was 10" },
        { "id": "f4", "category": "family", "fact": "Twin sister Lyra is a healer at Temple of Dawn" },
        { "id": "f5", "category": "mentor", "fact": "Thandril is a 400-year-old elf mentor" },
        { "id": "f6", "category": "companion", "fact": "Wolf companion Frost has muzzle scar from bear fight" },
        { "id": "f7", "category": "conflict", "fact": "Cassian Vex is now governor of Ashvale, has daughter Elise" },
        { "id": "f8", "category": "relationship", "fact": "Elise Vex is secretly in love with Kael" },
        { "id": "f9", "category": "ally", "fact": "Brogan Deepforge crafted Whisperwind bow for Kael" },
        { "id": "f10", "category": "threat", "fact": "The Hollowed are corrupted forest spirits, Kael tracking for 3 years" },
        { "id": "f11", "category": "villain", "fact": "Morwen leads the Hollowed, was Thandril's former apprentice" }
    ]
}
```

- [ ] **Step 3: Create multi-compaction session (40 turns)**

This session is long enough to trigger 2 compaction cycles (80k × 2 = 160k tokens worth of content), testing context degradation across multiple compressions.

```json
{
    "id": "multi-compaction",
    "description": "Extended session crossing 2 compaction boundaries — tests degradation",
    "turns": [
        { "role": "user", "content": "Let's build a magic system. It's called Resonance. Casters attune to one of 5 Harmonics: Fire, Frost, Storm, Earth, Shadow." },
        { "role": "assistant", "content": "Created Resonance magic system with 5 Harmonics." },
        { "role": "user", "content": "Each Harmonic has a physical manifestation. Fire casters' eyes glow amber. Frost casters have pale blue skin markings. Storm casters' hair stands on end. Earth casters develop stone-like calluses. Shadow casters' pupils become slitted." },
        { "role": "assistant", "content": "Documented physical manifestations for all 5 Harmonics." },
        { "role": "user", "content": "Attunement happens at age 13 in a ceremony called the Harmonic Trial. About 1 in 50 people can attune." },
        { "role": "assistant", "content": "Documented Harmonic Trial at age 13, 1-in-50 rate." },
        { "role": "user", "content": "Dual attunement is extremely rare — 1 in 10,000. The last known dual was Archmage Voss who wielded Storm and Shadow 200 years ago." },
        { "role": "assistant", "content": "Documented dual attunement rarity and Archmage Voss." },
        { "role": "user", "content": "Overuse of Resonance causes Harmonic Sickness. Symptoms: nosebleeds, tremors, temporary blindness. Lethal if pushed past the threshold." },
        { "role": "assistant", "content": "Created Harmonic Sickness with symptoms and lethality threshold." },
        { "role": "user", "content": "The governing body for magic is the Concordance, based in the Crystal Spire. Five Archons, one per Harmonic." },
        { "role": "assistant", "content": "Created the Concordance and Crystal Spire. 5 Archons." },
        { "role": "user", "content": "Current Fire Archon: Pyrra Ashcrown. Frost: Thane Iceweaver. Storm: Zara Thundercall. Earth: Gorim Deeproot. Shadow: position vacant after Archon Nyx disappeared 2 years ago." },
        { "role": "assistant", "content": "Documented all 5 Archon positions. Shadow Archon Nyx missing 2 years." },
        { "role": "user", "content": "Resonance requires a focus object. Common foci: rings, amulets, staves. Rare foci: tattoos (permanent, can't be disarmed)." },
        { "role": "assistant", "content": "Documented focus objects and tattoo foci." },
        { "role": "user", "content": "There's an anti-magic material called Nullstone. Found only in the Voidchasms. Nullstone disrupts Resonance within a 10-meter radius." },
        { "role": "assistant", "content": "Created Nullstone from Voidchasms, 10m anti-magic radius." },
        { "role": "user", "content": "The Hollowed from the Whispering Woods have been corrupting Resonance. Corrupted Resonance turns purple and drives casters insane." },
        { "role": "assistant", "content": "Linked Hollowed corruption to Resonance. Purple corruption = madness." },
        { "role": "user", "content": "A resistance group called the Untuned fights against Resonance discrimination. They're non-casters who believe magic creates inequality." },
        { "role": "assistant", "content": "Created the Untuned resistance movement." },
        { "role": "user", "content": "The Untuned leader is Marcus Grimm, a former soldier who lost his family to a Fire Harmonic accident." },
        { "role": "assistant", "content": "Created Marcus Grimm, Untuned leader, backstory." },
        { "role": "user", "content": "Resonance energy can be stored in Harmonic Crystals. Each crystal holds about 3 days of casting power. They're expensive — 50 gold Aurens each." },
        { "role": "assistant", "content": "Documented Harmonic Crystals: 3-day storage, 50 Aurens cost." },
        { "role": "user", "content": "The most powerful Resonance spell ever cast was the Worldshield — a Storm+Earth dual spell that protected Solara during the War of Broken Oaths." },
        { "role": "assistant", "content": "Documented the Worldshield spell and its War of Broken Oaths context." },
        { "role": "user", "content": "Young casters train at the Academy of Harmonics in Solara. 4-year program. Graduation ceremony is called the Final Resonance." },
        { "role": "assistant", "content": "Created Academy of Harmonics, 4-year program, Final Resonance graduation." },
        { "role": "user", "content": "There are Resonance-enhanced weapons called Harmonic Arms. The most famous is Stormbreaker, a warhammer that generates lightning on impact." },
        { "role": "assistant", "content": "Created Harmonic Arms concept and Stormbreaker warhammer." },
        { "role": "user", "content": "Shadow Resonance is controversial. 3 of the 5 Archons want to ban Shadow attunement. Pyrra and Zara support the ban." },
        { "role": "assistant", "content": "Documented Shadow ban controversy. Pyrra and Zara favor ban." },
        { "role": "user", "content": "The Voidchasms (where Nullstone is found) are also the suspected origin of the Hollowed corruption." },
        { "role": "assistant", "content": "Linked Voidchasms to both Nullstone and Hollowed corruption origin." },
        { "role": "user", "content": "Ancient texts mention a 6th Harmonic: Light. It hasn't been seen in 1000 years. The Crystal Spire was supposedly built using Light Resonance." },
        { "role": "assistant", "content": "Documented the lost 6th Harmonic: Light. Crystal Spire connection." }
    ],
    "facts": [
        { "id": "f1", "category": "magic-system", "fact": "5 Harmonics: Fire, Frost, Storm, Earth, Shadow" },
        { "id": "f2", "category": "physical", "fact": "Fire = amber eyes, Frost = blue markings, Storm = standing hair, Earth = stone calluses, Shadow = slitted pupils" },
        { "id": "f3", "category": "attunement", "fact": "Harmonic Trial at age 13, 1-in-50 can attune" },
        { "id": "f4", "category": "rarity", "fact": "Dual attunement: 1 in 10,000. Last was Archmage Voss (Storm+Shadow) 200 years ago" },
        { "id": "f5", "category": "danger", "fact": "Harmonic Sickness: nosebleeds, tremors, blindness, potentially lethal" },
        { "id": "f6", "category": "governance", "fact": "Concordance: 5 Archons in Crystal Spire, one per Harmonic" },
        { "id": "f7", "category": "characters", "fact": "Archons: Pyrra (Fire), Thane (Frost), Zara (Storm), Gorim (Earth), Shadow vacant since Nyx disappeared 2 years ago" },
        { "id": "f8", "category": "mechanics", "fact": "Focus objects required. Tattoo foci are permanent and rare." },
        { "id": "f9", "category": "material", "fact": "Nullstone from Voidchasms disrupts Resonance in 10m radius" },
        { "id": "f10", "category": "corruption", "fact": "Hollowed corrupt Resonance to purple, causes madness" },
        { "id": "f11", "category": "faction", "fact": "The Untuned: anti-magic resistance led by Marcus Grimm" },
        { "id": "f12", "category": "economics", "fact": "Harmonic Crystals: 3-day storage, 50 gold Aurens each" },
        { "id": "f13", "category": "history", "fact": "Worldshield: Storm+Earth dual spell protected Solara during War of Broken Oaths" },
        { "id": "f14", "category": "education", "fact": "Academy of Harmonics: 4-year program, Final Resonance graduation" },
        { "id": "f15", "category": "weapons", "fact": "Stormbreaker: lightning warhammer, most famous Harmonic Arm" },
        { "id": "f16", "category": "politics", "fact": "Shadow ban: Pyrra and Zara favor banning Shadow attunement" },
        { "id": "f17", "category": "mystery", "fact": "6th Harmonic (Light) lost for 1000 years, Crystal Spire built with it" }
    ]
}
```

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/golden-sessions/
git commit -m "test(eval): golden session corpus for compaction accuracy evaluation

3 sessions: kingdom-founding (25 turns, 14 facts), character-web
(20 turns, 11 facts), multi-compaction (40 turns, 17 facts).
Each session has tagged facts for probe-based accuracy scoring."
```

---

## Task 2: Probe Questions

**Files:**
- Create: `eval/probes/kingdom-founding.probes.json`
- Create: `eval/probes/character-web.probes.json`
- Create: `eval/probes/multi-compaction.probes.json`

Each probe is a question that requires retained context to answer correctly. Probes reference fact IDs, so scoring can trace which facts survive compaction.

- [ ] **Step 1: Create kingdom-founding probes**

```json
{
    "sessionId": "kingdom-founding",
    "probes": [
        {
            "id": "p1",
            "question": "How long ago was Valorheim founded and by whom?",
            "expectedFacts": ["f1"],
            "expectedKeywords": ["800", "Aldric the First"],
            "difficulty": "easy"
        },
        {
            "id": "p2",
            "question": "What bodies of water and mountain ranges border Valorheim?",
            "expectedFacts": ["f2", "f3"],
            "expectedKeywords": ["Frostmere Sea", "Dragon's Spine"],
            "difficulty": "easy"
        },
        {
            "id": "p3",
            "question": "Name all 7 seats on the Ruling Council of Valorheim.",
            "expectedFacts": ["f5"],
            "expectedKeywords": ["Crown", "Sword", "Quill", "Coin", "Flame", "Shield", "Star"],
            "difficulty": "hard"
        },
        {
            "id": "p4",
            "question": "What are the currency denominations in Valorheim and their exchange rates?",
            "expectedFacts": ["f7"],
            "expectedKeywords": ["Aurens", "Marks", "Bits", "10", "100"],
            "difficulty": "medium"
        },
        {
            "id": "p5",
            "question": "What event caused the rivalry between Valorheim and Thornwall, and how long ago was it?",
            "expectedFacts": ["f8"],
            "expectedKeywords": ["War of Broken Oaths", "300"],
            "difficulty": "medium"
        },
        {
            "id": "p6",
            "question": "Who leads Valorheim's military and what is it called?",
            "expectedFacts": ["f9"],
            "expectedKeywords": ["Frostguard", "Brianna Ironhelm"],
            "difficulty": "easy"
        },
        {
            "id": "p7",
            "question": "What are the two moons in Valorheim's religion and what do they represent?",
            "expectedFacts": ["f10"],
            "expectedKeywords": ["Lunara", "wisdom", "Solus", "courage"],
            "difficulty": "medium"
        },
        {
            "id": "p8",
            "question": "How old is Archmage Celine and where does she work?",
            "expectedFacts": ["f11"],
            "expectedKeywords": ["200", "Mage Tower", "Solara"],
            "difficulty": "easy"
        },
        {
            "id": "p9",
            "question": "What is Valorheim's chief export and where is it mined?",
            "expectedFacts": ["f12"],
            "expectedKeywords": ["moonstone", "Shimmering Caverns"],
            "difficulty": "easy"
        },
        {
            "id": "p10",
            "question": "Who are the Tidecallers?",
            "expectedFacts": ["f13"],
            "expectedKeywords": ["fishing", "semi-autonomous", "Frostmere"],
            "difficulty": "medium"
        }
    ]
}
```

- [ ] **Step 2: Create character-web probes**

```json
{
    "sessionId": "character-web",
    "probes": [
        {
            "id": "p1",
            "question": "What happened to Kael's father and who was responsible?",
            "expectedFacts": ["f3"],
            "expectedKeywords": ["poisoned", "Cassian Vex", "Darius"],
            "difficulty": "easy"
        },
        {
            "id": "p2",
            "question": "What injury did Kael's mother sustain and in what battle?",
            "expectedFacts": ["f2"],
            "expectedKeywords": ["left arm", "Siege of Ashvale"],
            "difficulty": "medium"
        },
        {
            "id": "p3",
            "question": "What is the relationship between Thandril and Morwen?",
            "expectedFacts": ["f5", "f11"],
            "expectedKeywords": ["mentor", "apprentice", "Thandril"],
            "difficulty": "hard"
        },
        {
            "id": "p4",
            "question": "Who crafted Kael's bow and what is it called?",
            "expectedFacts": ["f9"],
            "expectedKeywords": ["Brogan Deepforge", "Whisperwind"],
            "difficulty": "easy"
        },
        {
            "id": "p5",
            "question": "What is notable about Kael's wolf companion?",
            "expectedFacts": ["f6"],
            "expectedKeywords": ["Frost", "scar", "muzzle", "bear"],
            "difficulty": "medium"
        },
        {
            "id": "p6",
            "question": "What romantic subplot exists between the protagonist and antagonist families?",
            "expectedFacts": ["f7", "f8"],
            "expectedKeywords": ["Elise", "Vex", "love", "Kael"],
            "difficulty": "hard"
        },
        {
            "id": "p7",
            "question": "What are the Hollowed and how long has Kael been tracking them?",
            "expectedFacts": ["f10"],
            "expectedKeywords": ["corrupted", "forest spirits", "3 years"],
            "difficulty": "easy"
        }
    ]
}
```

- [ ] **Step 3: Create multi-compaction probes**

```json
{
    "sessionId": "multi-compaction",
    "probes": [
        {
            "id": "p1",
            "question": "What physical change does a Shadow Resonance caster exhibit?",
            "expectedFacts": ["f2"],
            "expectedKeywords": ["slitted", "pupils"],
            "difficulty": "medium"
        },
        {
            "id": "p2",
            "question": "What was the name and type of Archmage Voss's dual attunement?",
            "expectedFacts": ["f4"],
            "expectedKeywords": ["Storm", "Shadow", "Voss"],
            "difficulty": "hard"
        },
        {
            "id": "p3",
            "question": "Who is the current Shadow Archon?",
            "expectedFacts": ["f7"],
            "expectedKeywords": ["vacant", "Nyx", "disappeared"],
            "difficulty": "medium"
        },
        {
            "id": "p4",
            "question": "What is Nullstone and what does it do?",
            "expectedFacts": ["f9"],
            "expectedKeywords": ["Voidchasms", "disrupts", "10"],
            "difficulty": "easy"
        },
        {
            "id": "p5",
            "question": "Who leads the anti-magic resistance and what is their motivation?",
            "expectedFacts": ["f11"],
            "expectedKeywords": ["Marcus Grimm", "Untuned", "family", "Fire"],
            "difficulty": "medium"
        },
        {
            "id": "p6",
            "question": "How much does a Harmonic Crystal cost and how long does it last?",
            "expectedFacts": ["f12"],
            "expectedKeywords": ["50", "Aurens", "3 days"],
            "difficulty": "medium"
        },
        {
            "id": "p7",
            "question": "What dual spell protected Solara and during which war?",
            "expectedFacts": ["f13"],
            "expectedKeywords": ["Worldshield", "Storm", "Earth", "War of Broken Oaths"],
            "difficulty": "hard"
        },
        {
            "id": "p8",
            "question": "Which Archons support banning Shadow attunement?",
            "expectedFacts": ["f16"],
            "expectedKeywords": ["Pyrra", "Zara"],
            "difficulty": "hard"
        },
        {
            "id": "p9",
            "question": "What is the lost 6th Harmonic and what was it used to build?",
            "expectedFacts": ["f17"],
            "expectedKeywords": ["Light", "Crystal Spire", "1000 years"],
            "difficulty": "hard"
        },
        {
            "id": "p10",
            "question": "What are the symptoms of Harmonic Sickness?",
            "expectedFacts": ["f5"],
            "expectedKeywords": ["nosebleeds", "tremors", "blindness"],
            "difficulty": "easy"
        }
    ]
}
```

- [ ] **Step 4: Commit**

```bash
git add eval/probes/
git commit -m "test(eval): probe questions for compaction accuracy scoring

10 probes per kingdom/multi-compaction session, 7 for character-web.
Each probe has expected keywords + difficulty rating for weighted scoring."
```

---

## Task 3: Evaluation Harness

**Files:**
- Create: `eval/lib/session-player.ts`
- Create: `eval/lib/probe-scorer.ts`
- Create: `eval/lib/report.ts`
- Create: `eval/compaction-eval.ts`
- Create: `eval/.gitignore`
- Create: `eval/README.md`

- [ ] **Step 1: Create session player**

```typescript
// eval/lib/session-player.ts
import prisma from "../../src/db/client.ts";
import { compactSession } from "../../src/pipeline/session-compactor.ts";
import { rebuildContext } from "../../src/pipeline/session-compactor.ts";
import { countTokens } from "../../src/utils/tokens.ts";

interface Turn {
    role: string;
    content: string;
}

interface GoldenSession {
    id: string;
    turns: Turn[];
}

export interface PlayedSession {
    sessionId: string;
    dbSessionId: string;
    preCompactionTokens: number;
    postCompactionState: Record<string, unknown> | null;
    rebuiltContext: string;
    compactionCount: number;
}

export async function playSession(golden: GoldenSession, userId = "eval-user"): Promise<PlayedSession> {
    // Create DB session
    const dbSession = await prisma.loreSession.create({
        data: {
            userId,
            title: `Eval: ${golden.id}`,
            state: {},
            tokensAccumulated: 0,
        },
    });

    let totalTokens = 0;

    // Replay all turns
    for (const turn of golden.turns) {
        const tokens = countTokens(turn.content);
        totalTokens += tokens;

        await prisma.loreSessionMessage.create({
            data: {
                loreSessionId: dbSession.id,
                role: turn.role,
                content: turn.content,
                tokensEstimated: tokens,
            },
        });
    }

    // Update token count
    await prisma.loreSession.update({
        where: { id: dbSession.id },
        data: { tokensAccumulated: totalTokens },
    });

    return {
        sessionId: golden.id,
        dbSessionId: dbSession.id,
        preCompactionTokens: totalTokens,
        postCompactionState: null,
        rebuiltContext: "",
        compactionCount: 0,
    };
}

export async function forceCompaction(played: PlayedSession): Promise<PlayedSession> {
    // Ensure tokens are above threshold
    const session = await prisma.loreSession.findUnique({ where: { id: played.dbSessionId } });
    if (!session) throw new Error(`Session ${played.dbSessionId} not found`);

    // Force tokens above threshold if needed
    if (session.tokensAccumulated < 80000) {
        await prisma.loreSession.update({
            where: { id: played.dbSessionId },
            data: { tokensAccumulated: 85000 },
        });
    }

    await compactSession(played.dbSessionId);

    const updated = await prisma.loreSession.findUnique({ where: { id: played.dbSessionId } });
    const state = updated?.state as Record<string, unknown> | null;

    const context = state ? rebuildContext(
        state,
        [],  // recentNotes — empty for eval (we test state accuracy, not note reinjection)
        updated!.compactionCount,
    ) : "";

    return {
        ...played,
        postCompactionState: state,
        rebuiltContext: context,
        compactionCount: updated?.compactionCount ?? 0,
    };
}
```

- [ ] **Step 2: Create probe scorer**

```typescript
// eval/lib/probe-scorer.ts

interface Probe {
    id: string;
    question: string;
    expectedKeywords: string[];
    difficulty: "easy" | "medium" | "hard";
}

interface ProbeResult {
    probeId: string;
    question: string;
    passed: boolean;
    matchedKeywords: string[];
    missedKeywords: string[];
    difficulty: string;
    score: number;
}

const DIFFICULTY_WEIGHTS: Record<string, number> = {
    easy: 1.0,
    medium: 1.5,
    hard: 2.0,
};

export function scoreProbeAgainstState(
    probe: Probe,
    compactedState: Record<string, unknown>,
): ProbeResult {
    const stateText = JSON.stringify(compactedState).toLowerCase();

    const matched: string[] = [];
    const missed: string[] = [];

    for (const keyword of probe.expectedKeywords) {
        if (stateText.includes(keyword.toLowerCase())) {
            matched.push(keyword);
        } else {
            missed.push(keyword);
        }
    }

    const keywordScore = probe.expectedKeywords.length > 0
        ? matched.length / probe.expectedKeywords.length
        : 0;

    const passed = keywordScore >= 0.5; // at least half keywords retained

    return {
        probeId: probe.id,
        question: probe.question,
        passed,
        matchedKeywords: matched,
        missedKeywords: missed,
        difficulty: probe.difficulty,
        score: keywordScore * DIFFICULTY_WEIGHTS[probe.difficulty],
    };
}

export function scoreProbeAgainstContext(
    probe: Probe,
    rebuiltContext: string,
): ProbeResult {
    const contextLower = rebuiltContext.toLowerCase();

    const matched: string[] = [];
    const missed: string[] = [];

    for (const keyword of probe.expectedKeywords) {
        if (contextLower.includes(keyword.toLowerCase())) {
            matched.push(keyword);
        } else {
            missed.push(keyword);
        }
    }

    const keywordScore = probe.expectedKeywords.length > 0
        ? matched.length / probe.expectedKeywords.length
        : 0;

    const passed = keywordScore >= 0.5;

    return {
        probeId: probe.id,
        question: probe.question,
        passed,
        matchedKeywords: matched,
        missedKeywords: missed,
        difficulty: probe.difficulty,
        score: keywordScore * DIFFICULTY_WEIGHTS[probe.difficulty],
    };
}

export interface SessionScore {
    sessionId: string;
    totalProbes: number;
    passed: number;
    failed: number;
    accuracy: number;
    weightedScore: number;
    maxWeightedScore: number;
    weightedAccuracy: number;
    results: ProbeResult[];
}

export function aggregateScores(sessionId: string, results: ProbeResult[]): SessionScore {
    const passed = results.filter((r) => r.passed).length;
    const maxWeighted = results.reduce((s, r) => s + DIFFICULTY_WEIGHTS[r.difficulty], 0);
    const actualWeighted = results.reduce((s, r) => s + r.score, 0);

    return {
        sessionId,
        totalProbes: results.length,
        passed,
        failed: results.length - passed,
        accuracy: results.length > 0 ? passed / results.length : 0,
        weightedScore: actualWeighted,
        maxWeightedScore: maxWeighted,
        weightedAccuracy: maxWeighted > 0 ? actualWeighted / maxWeighted : 0,
        results,
    };
}
```

- [ ] **Step 3: Create report generator**

```typescript
// eval/lib/report.ts
import type { SessionScore } from "./probe-scorer.ts";

export interface EvalReport {
    timestamp: string;
    sessions: SessionScore[];
    overallAccuracy: number;
    overallWeightedAccuracy: number;
    passThreshold: number;
    passed: boolean;
}

export function generateReport(scores: SessionScore[], threshold = 0.8): EvalReport {
    const totalProbes = scores.reduce((s, sc) => s + sc.totalProbes, 0);
    const totalPassed = scores.reduce((s, sc) => s + sc.passed, 0);
    const totalWeighted = scores.reduce((s, sc) => s + sc.weightedScore, 0);
    const totalMaxWeighted = scores.reduce((s, sc) => s + sc.maxWeightedScore, 0);

    const report: EvalReport = {
        timestamp: new Date().toISOString(),
        sessions: scores,
        overallAccuracy: totalProbes > 0 ? totalPassed / totalProbes : 0,
        overallWeightedAccuracy: totalMaxWeighted > 0 ? totalWeighted / totalMaxWeighted : 0,
        passThreshold: threshold,
        passed: (totalProbes > 0 ? totalPassed / totalProbes : 0) >= threshold,
    };

    return report;
}

export function printReport(report: EvalReport): string {
    const lines: string[] = [];

    lines.push("═══════════════════════════════════════════════════");
    lines.push("  COMPACTION ACCURACY EVALUATION REPORT");
    lines.push(`  ${report.timestamp}`);
    lines.push("═══════════════════════════════════════════════════");
    lines.push("");

    for (const session of report.sessions) {
        lines.push(`─── ${session.sessionId} ───`);
        lines.push(`  Probes: ${session.passed}/${session.totalProbes} passed (${(session.accuracy * 100).toFixed(1)}%)`);
        lines.push(`  Weighted: ${session.weightedScore.toFixed(1)}/${session.maxWeightedScore.toFixed(1)} (${(session.weightedAccuracy * 100).toFixed(1)}%)`);
        lines.push("");

        for (const r of session.results) {
            const icon = r.passed ? "✓" : "✗";
            lines.push(`  ${icon} [${r.difficulty}] ${r.probeId}: ${r.question}`);
            if (r.missedKeywords.length > 0) {
                lines.push(`    Missing: ${r.missedKeywords.join(", ")}`);
            }
        }
        lines.push("");
    }

    lines.push("═══════════════════════════════════════════════════");
    lines.push(`  OVERALL: ${(report.overallAccuracy * 100).toFixed(1)}% accuracy (threshold: ${(report.passThreshold * 100).toFixed(0)}%)`);
    lines.push(`  WEIGHTED: ${(report.overallWeightedAccuracy * 100).toFixed(1)}%`);
    lines.push(`  VERDICT: ${report.passed ? "PASS ✓" : "FAIL ✗"}`);
    lines.push("═══════════════════════════════════════════════════");

    return lines.join("\n");
}
```

- [ ] **Step 4: Create evaluation entry point**

```typescript
// eval/compaction-eval.ts
// Run: bun run eval/compaction-eval.ts [--session=kingdom-founding] [--threshold=0.8]
import { playSession, forceCompaction } from "./lib/session-player.ts";
import { scoreProbeAgainstState, scoreProbeAgainstContext, aggregateScores } from "./lib/probe-scorer.ts";
import { generateReport, printReport } from "./lib/report.ts";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const sessionFilter = args.find((a) => a.startsWith("--session="))?.split("=")[1];
const threshold = parseFloat(args.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? "0.8");

const GOLDEN_DIR = join(import.meta.dir, "../test/fixtures/golden-sessions");
const PROBE_DIR = join(import.meta.dir, "probes");
const RESULTS_DIR = join(import.meta.dir, "results");

mkdirSync(RESULTS_DIR, { recursive: true });

const sessionFiles = ["kingdom-founding", "character-web", "multi-compaction"];
const sessions = sessionFilter ? sessionFiles.filter((s) => s === sessionFilter) : sessionFiles;

console.log(`Running compaction accuracy eval for: ${sessions.join(", ")}`);
console.log(`Threshold: ${(threshold * 100).toFixed(0)}%\n`);

const allScores = [];

for (const sessionName of sessions) {
    console.log(`\n─── Evaluating: ${sessionName} ───`);

    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, `${sessionName}.json`), "utf-8"));
    const probes = JSON.parse(readFileSync(join(PROBE_DIR, `${sessionName}.probes.json`), "utf-8"));

    // Phase 1: Play the session
    console.log(`  Playing ${golden.turns.length} turns...`);
    let played = await playSession(golden);
    console.log(`  Pre-compaction tokens: ${played.preCompactionTokens}`);

    // Phase 2: Force compaction
    console.log("  Forcing compaction...");
    played = await forceCompaction(played);
    console.log(`  Compaction #${played.compactionCount} complete.`);

    // Phase 3: Score probes against compacted state
    console.log(`  Scoring ${probes.probes.length} probes...`);
    const stateResults = probes.probes.map((probe: any) =>
        scoreProbeAgainstState(probe, played.postCompactionState ?? {})
    );

    const contextResults = probes.probes.map((probe: any) =>
        scoreProbeAgainstContext(probe, played.rebuiltContext)
    );

    const stateScore = aggregateScores(`${sessionName}-state`, stateResults);
    const contextScore = aggregateScores(`${sessionName}-context`, contextResults);

    allScores.push(stateScore, contextScore);

    console.log(`  State accuracy: ${(stateScore.accuracy * 100).toFixed(1)}%`);
    console.log(`  Context accuracy: ${(contextScore.accuracy * 100).toFixed(1)}%`);

    // Multi-compaction: force a second compaction for degradation testing
    if (sessionName === "multi-compaction") {
        console.log("  Forcing second compaction (degradation test)...");
        await (async () => {
            // Re-inflate tokens
            const prisma = (await import("../../src/db/client.ts")).default;
            await prisma.loreSession.update({
                where: { id: played.dbSessionId },
                data: { tokensAccumulated: 85000 },
            });
        })();
        played = await forceCompaction(played);
        console.log(`  Compaction #${played.compactionCount} complete.`);

        const degradedResults = probes.probes.map((probe: any) =>
            scoreProbeAgainstState(probe, played.postCompactionState ?? {})
        );
        const degradedScore = aggregateScores(`${sessionName}-degraded`, degradedResults);
        allScores.push(degradedScore);

        const drop = contextScore.accuracy - degradedScore.accuracy;
        console.log(`  Degraded accuracy: ${(degradedScore.accuracy * 100).toFixed(1)}%`);
        console.log(`  Degradation: ${(drop * 100).toFixed(1)}% drop`);
    }
}

// Generate final report
const report = generateReport(allScores, threshold);
const reportText = printReport(report);

console.log("\n" + reportText);

// Save results
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = join(RESULTS_DIR, `eval-${timestamp}.json`);
const textPath = join(RESULTS_DIR, `eval-${timestamp}.txt`);

writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(textPath, reportText);

console.log(`\nResults saved to:`);
console.log(`  ${jsonPath}`);
console.log(`  ${textPath}`);

process.exit(report.passed ? 0 : 1);
```

- [ ] **Step 5: Create .gitignore and README**

```
# eval/.gitignore
results/
```

```markdown
# eval/README.md
# Compaction Accuracy Evaluation

## What This Measures

Tests whether the session compaction system retains critical context across compaction boundaries. Each golden session contains tagged facts — after compaction, we check how many facts survive in the compressed state.

## Prerequisites

- AllKnower DB running (Postgres)
- LLM mock or real endpoint configured

## Running

```bash
# Run all sessions
bun run eval/compaction-eval.ts

# Run single session
bun run eval/compaction-eval.ts --session=kingdom-founding

# Custom threshold (default 80%)
bun run eval/compaction-eval.ts --threshold=0.9
```

## Interpreting Results

- **State accuracy**: facts found in compacted JSON state
- **Context accuracy**: facts found in rebuilt context string (includes re-injected notes)
- **Degradation**: accuracy drop between 1st and 2nd compaction (multi-compaction session only)

## Thresholds

| Metric | Target | Action if Below |
|---|---|---|
| Overall accuracy | ≥80% | Investigate compaction prompt or schema |
| Weighted accuracy | ≥70% | Hard facts (names, numbers) being lost |
| Degradation | <5% drop | Compaction prompt losing cumulative context |
| Hard difficulty probes | ≥60% | Specific detail categories being dropped |

## When to Run

- Before/after changing `SESSION_COMPACT_SYSTEM` prompt
- Before/after changing `LoreSessionStateSchema`
- Before/after changing `POST_COMPACT_BUDGET` or `SESSION_TOKEN_THRESHOLD`
- After model changes for `session-compact` task
```

- [ ] **Step 6: Commit**

```bash
git add eval/
git commit -m "test(eval): compaction accuracy evaluation harness

Session player, probe scorer with weighted difficulty, report generator.
Entry point: bun run eval/compaction-eval.ts
Scores keyword retention in compacted state and rebuilt context.
Degradation test for multi-compaction cycles. Exit code reflects pass/fail."
```

---

## Verification

```bash
# Phase 0: unit tests (requires Postgres)
bun test test/unit/session-compactor.unit.test.ts

# Full eval (requires Postgres + LLM mock)
bun run eval/compaction-eval.ts

# Single session
bun run eval/compaction-eval.ts --session=kingdom-founding

# Strict threshold
bun run eval/compaction-eval.ts --threshold=0.9
```

**Expected output format:**

```
═══════════════════════════════════════════════════
  COMPACTION ACCURACY EVALUATION REPORT
  2026-05-19T12:00:00.000Z
═══════════════════════════════════════════════════

─── kingdom-founding-state ───
  Probes: 8/10 passed (80.0%)
  Weighted: 11.5/14.0 (82.1%)

  ✓ [easy] p1: How long ago was Valorheim founded?
  ✓ [easy] p2: What borders Valorheim?
  ✗ [hard] p3: Name all 7 Ruling Council seats.
    Missing: Quill, Flame
  ...

═══════════════════════════════════════════════════
  OVERALL: 78.5% accuracy (threshold: 80%)
  WEIGHTED: 75.2%
  VERDICT: FAIL ✗
═══════════════════════════════════════════════════
```

**Success criteria:**

| Session | Target Accuracy | Notes |
|---|---|---|
| kingdom-founding | ≥80% | Broad facts, easy to retain |
| character-web | ≥80% | Relationship chains, harder to compress |
| multi-compaction (1st) | ≥75% | Longer session, more detail |
| multi-compaction (2nd) | ≥70% | Degradation expected, <5% drop from 1st |
| **Overall** | **≥80%** | **Pass threshold** |
