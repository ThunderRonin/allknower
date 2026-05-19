const BASE_URL = process.env.ALLKNOWER_URL || "http://localhost:3001";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "perf-test-token";

async function seed() {
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };

    console.log("Seeding brain dump history...");
    for (let i = 0; i < 20; i++) {
        const res = await fetch(`${BASE_URL}/brain-dump`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                rawText: `Performance test entity ${i}: A ${
                    ["warrior", "mage", "thief", "cleric", "ranger"][i % 5]
                } from the ${["north", "south", "east", "west"][i % 4]}.`,
                mode: "auto",
            }),
        });
        if (!res.ok) console.warn(`Brain dump ${i} failed: ${res.status}`);
        else console.log(`  Created brain dump ${i + 1}/20`);
    }

    console.log("Triggering RAG reindex...");
    const reindexRes = await fetch(`${BASE_URL}/rag/reindex`, {
        method: "POST",
        headers,
    });
    console.log(`  Reindex: ${reindexRes.status}`);

    console.log("Seed complete.");
}

seed().catch(console.error);
