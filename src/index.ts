import { app } from "./app.ts";
import { env } from "./env.ts";

const PORT = env.PORT;

await app.listen(PORT);

const origin = `http://${app.server!.hostname}:${app.server!.port}`;

console.log(
    `\n🧠 AllKnower is running at ${origin}\n` +
    `   📖 API docs: ${origin}/reference\n` +
    `   ❤️  Health:   ${origin}/health\n`
);

// Non-blocking startup dependency check — warns early instead of failing silently later.
setTimeout(async () => {
    try {
        const res = await fetch(`${origin}/health`);
        const data = await res.json();
        if (!data?.checks) throw new Error("Unexpected health response shape");
        const { checks } = data as {
            checks: {
                allcodex: { ok: boolean };
                lancedb: { ok: boolean };
                database: { ok: boolean };
            };
        };
        if (!checks.allcodex.ok)  console.warn("⚠️  AllCodex Core is unreachable — check ALLCODEX_URL and ALLCODEX_TOKEN");
        if (!checks.database.ok)  console.warn("⚠️  Postgres is unreachable — check DATABASE_URL");
        if (!checks.lancedb.ok)   console.warn("⚠️  LanceDB failed to initialize — check data directory permissions");
    } catch (e) {
        console.warn(`⚠️  Startup health check failed — ${e instanceof Error ? e.message : "dependencies may not be ready"}`);
    }
}, 150);
