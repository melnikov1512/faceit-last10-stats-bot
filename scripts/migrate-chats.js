#!/usr/bin/env node
/**
 * Migration script: upgrades chats collection from
 *   players: ["s1mple", "NiKo"]
 * to
 *   players: [{ id: "uuid", nickname: "s1mple" }, ...]
 *
 * Also preserves already-migrated entries (objects) — idempotent.
 * Skips players not found on FACEIT and logs a warning.
 *
 * Run: node scripts/migrate-chats.js
 * Or:  npm run migrate
 */
require('dotenv').config();
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const config = require('../src/config');

const BASE_URL = 'https://open.faceit.com/data/v4';
const GAME = 'cs2';

async function resolveNicknameToPlayer(apiKey, nickname) {
    try {
        const response = await axios.get(`${BASE_URL}/players`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            params: { nickname, game: GAME },
        });
        return { id: response.data.player_id, nickname: response.data.nickname };
    } catch (error) {
        console.warn(`  ⚠️  Player "${nickname}" not found on FACEIT: ${error.message}`);
        return null;
    }
}

async function migrateChats() {
    const apiKey = config.faceit_api_key;
    if (!apiKey) {
        console.error('❌ FACEIT_API_KEY is not configured');
        throw new Error('FACEIT_API_KEY is not configured');
    }

    const dbOptions = config.projectId ? { projectId: config.projectId } : {};
    const db = new Firestore(dbOptions);
    const chatCollection = db.collection('chats');

    const snapshot = await chatCollection.get();
    if (snapshot.empty) {
        console.log('[migrate-chats] No chats found, nothing to migrate');
        return;
    }

    console.log(`[migrate-chats] Found ${snapshot.size} chat(s) to check`);

    for (const doc of snapshot.docs) {
        const chatId = doc.id;
        const data = doc.data();
        const players = data.players || [];

        const oldPlayers = players.filter(p => typeof p === 'string');
        const newPlayers = players.filter(p => typeof p === 'object' && p !== null && p.id);

        if (oldPlayers.length === 0) {
            console.log(`[migrate-chats] Chat ${chatId}: already up to date, skipping`);
            continue;
        }

        console.log(`[migrate-chats] Chat ${chatId}: migrating ${oldPlayers.length} player(s)...`);

        const resolved = [];
        for (const nickname of oldPlayers) {
            const player = await resolveNicknameToPlayer(apiKey, nickname);
            if (player) {
                resolved.push(player);
                console.log(`[migrate-chats]   ✅ "${nickname}" → id: ${player.id}`);
            } else {
                console.warn(`[migrate-chats]   ⚠️  Skipping "${nickname}" — could not resolve`);
            }
        }

        const updatedPlayers = [...newPlayers, ...resolved];
        await doc.ref.update({ players: updatedPlayers });
        console.log(`[migrate-chats] Chat ${chatId}: done (${updatedPlayers.length}/${players.length} players migrated)`);
    }

    console.log('[migrate-chats] ✅ Migration complete');
}

// Run standalone
if (require.main === module) {
    migrateChats().catch(err => {
        console.error('[migrate-chats] ❌ Migration failed:', err);
        process.exit(1);
    });
}

module.exports = { migrateChats };
