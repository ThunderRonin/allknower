import prisma from "../db/client.ts";
import { decrypt } from "../integrations/crypto.ts";
import { encryptCredential } from "../integrations/credential-crypto.ts";

const CORE_PROVIDER = "core";
const ALLCODEX_PROVIDER = "allcodex";

async function migrate() {
    const coreRows = await prisma.userIntegration.findMany({ where: { provider: CORE_PROVIDER } });
    console.log(`Found ${coreRows.length} rows with provider="${CORE_PROVIDER}"`);
    for (const row of coreRows) {
        const existing = await prisma.userIntegration.findUnique({
            where: { userId_provider: { userId: row.userId, provider: ALLCODEX_PROVIDER } },
        });
        if (existing) {
            console.log(`User ${row.userId}: already has "${ALLCODEX_PROVIDER}" row, deleting "${CORE_PROVIDER}" row`);
            await prisma.userIntegration.delete({ where: { userId_provider: { userId: row.userId, provider: CORE_PROVIDER } } });
            continue;
        }
        const plainToken = decrypt(row.encryptedToken);
        const newEncrypted = encryptCredential(plainToken);
        await prisma.userIntegration.update({
            where: { userId_provider: { userId: row.userId, provider: CORE_PROVIDER } },
            data: { provider: ALLCODEX_PROVIDER, encryptedToken: newEncrypted },
        });
        console.log(`User ${row.userId}: migrated "${CORE_PROVIDER}" → "${ALLCODEX_PROVIDER}"`);
    }
    console.log("Migration complete");
}

migrate().catch(console.error).finally(() => prisma.$disconnect());
