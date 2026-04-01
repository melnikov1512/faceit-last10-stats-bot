/**
 * Backfill playerIds in sent_match_notifications.
 *
 * For each notification document that is missing the playerIds field:
 * - Look up which players are subscribed to the notification's chatId
 * - Set playerIds = those subscribed player IDs
 *
 * This enables getRecentMatchIdsForPlayers() to find matches across chats.
 *
 * Run locally: node scripts/backfill-notification-playerids.js
 */

require('dotenv').config();
const { Firestore } = require('@google-cloud/firestore');
const config = require('../src/config');

const db = new Firestore(config.projectId ? { projectId: config.projectId } : {});
const notificationsCol = db.collection('sent_match_notifications');
const subscriptionsCol = db.collection('player_subscriptions');

async function buildChatToPlayerIds() {
    const snapshot = await subscriptionsCol.get();
    const chatToPlayerIds = new Map(); // chatId → Set<playerId>

    for (const doc of snapshot.docs) {
        const { playerId, subscribedChats = [] } = doc.data();
        if (!playerId) continue;
        for (const chatId of subscribedChats) {
            if (!chatToPlayerIds.has(chatId)) {
                chatToPlayerIds.set(chatId, new Set());
            }
            chatToPlayerIds.get(chatId).add(playerId);
        }
    }

    return chatToPlayerIds;
}

async function main() {
    console.log('Loading player_subscriptions...');
    const chatToPlayerIds = await buildChatToPlayerIds();
    console.log(`Found ${chatToPlayerIds.size} chats with subscriptions`);

    console.log('Loading sent_match_notifications...');
    const snapshot = await notificationsCol.get();
    console.log(`Found ${snapshot.docs.length} notification documents`);

    let updated = 0;
    let skipped = 0;

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();

        // Skip docs that already have a non-empty playerIds field
        if (Array.isArray(data.playerIds) && data.playerIds.length > 0) {
            skipped++;
            continue;
        }

        const chatId = data.chatId?.toString();
        if (!chatId) {
            console.warn(`  [SKIP] ${doc.id}: no chatId`);
            skipped++;
            continue;
        }

        const playerIds = [...(chatToPlayerIds.get(chatId) || [])];
        if (playerIds.length === 0) {
            console.warn(`  [SKIP] ${doc.id}: no subscribed players for chatId=${chatId}`);
            skipped++;
            continue;
        }

        console.log(`  [UPDATE] ${doc.id}: chatId=${chatId} playerIds=[${playerIds.join(', ')}]`);
        batch.update(doc.ref, { playerIds });
        updated++;
        batchCount++;

        // Firestore batch limit is 500
        if (batchCount === 500) {
            await batch.commit();
            batchCount = 0;
            console.log('  Committed batch of 500');
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
