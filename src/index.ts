import { app } from "./app.ts";
import { env } from "./env.ts";
import { runBootstrap } from "./bootstrap/index.ts";

const PORT = env.PORT;

await app.listen(PORT);

const origin = `http://${app.server!.hostname}:${app.server!.port}`;

console.log(
    `\n🧠 AllKnower is running at ${origin}\n` +
    `   📖 API docs: ${origin}/reference\n` +
    `   ❤️  Health:   ${origin}/health\n`
);

runBootstrap().catch((e) => {
    console.error("❌ Bootstrap failed unexpectedly:", e);
});
