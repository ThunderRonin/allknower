import { app } from "./app.ts";
import { env } from "./env.ts";

const PORT = env.PORT;

app.listen(PORT);

console.log(
    `\n🧠 AllKnower is running at http://${app.server?.hostname}:${app.server?.port}\n` +
    `   📖 API docs: http://${app.server?.hostname}:${app.server?.port}/reference\n` +
    `   ❤️  Health:   http://${app.server?.hostname}:${app.server?.port}/health\n`
);
