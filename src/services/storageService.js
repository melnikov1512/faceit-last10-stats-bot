const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');

const dbOptions = config.projectId ? { projectId: config.projectId } : {};
console.log(`Initializing Firestore with project ID: ${config.projectId || 'ad-hoc'}`);

const db = new Firestore(dbOptions);
const chatCollection = db.collection('chats');
const playerSubscriptionsCollection = db.collection('player_subscriptions');
const sentMatchNotificationsCollection = db.collection('sent_match_notifications');
const activeMatchesCollection = db.collection('active_matches');

/**
 * Wraps a Firestore operation, converting the "database not found" error (code 5)
 * into a human-readable message so users know to create the database in Native Mode.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withFirestore(fn) {
    try {
        return await fn();
    } catch (error) {
        if (error.code === 5) {
            throw new Error(
                `Firestore database not found for project ${config.projectId}. ` +
                'Please create the database in Native Mode in the Google Cloud Console.'
            );
        }
        throw error;
    }
}

/**
 * Add a player to the chat's tracking list and store the chat name.
 * @param {string} chatId
 * @param {{ id: string, nickname: string }} player
 * @param {string|null} chatName
 */
async function addPlayer(chatId, { id, nickname }, chatName) {
    if (!chatId || !id || !nickname) {
        throw new Error('chatId, player.id and player.nickname are required');
    }
    const docRef = chatCollection.doc(chatId.toString());
    await withFirestore(async () => {
        const doc = await docRef.get();
        const players = doc.exists ? (doc.data().players || []) : [];
        if (players.some(p => p.id === id)) return;
        const update = { players: [...players, { id, nickname }] };
        if (chatName) update.name = chatName;
        await docRef.set(update, { merge: true });
    });
}

/**
 * Remove a player from the chat's tracking list by player ID.
 * @param {string} chatId
 * @param {string} playerId
 */
async function removePlayer(chatId, playerId) {
    if (!chatId || !playerId) {
        throw new Error('chatId and playerId are required');
    }
    const docRef = chatCollection.doc(chatId.toString());
    await withFirestore(async () => {
        const doc = await docRef.get();
        if (!doc.exists) return;
        const players = (doc.data().players || []).filter(p => p.id !== playerId);
        await docRef.update({ players });
    });
}

/**
 * Get the list of tracked players for a chat.
 * @param {string} chatId
 * @returns {Promise<Array<{ id: string, nickname: string }>>}
 */
async function getPlayers(chatId) {
    if (!chatId) return [];
    return withFirestore(async () => {
        const doc = await chatCollection.doc(chatId.toString()).get();
        if (!doc.exists) return [];
        return doc.data().players || [];
    });
}



/**
 * Subscribe a chat to match notifications for a player.
 * @param {string} chatId
 * @param {string} playerId  FACEIT player GUID
 * @param {string} nickname  FACEIT nickname (stored for display)
 */
async function subscribeChat(chatId, playerId, nickname) {
    const docRef = playerSubscriptionsCollection.doc(playerId);
    await docRef.set({
        nickname,
        playerId,
        subscribedChats: Firestore.FieldValue.arrayUnion(chatId.toString())
    }, { merge: true });
}

/**
 * Unsubscribe a chat from match notifications for a player.
 * @param {string} chatId
 * @param {string} playerId  FACEIT player GUID
 */
async function unsubscribeChat(chatId, playerId) {
    const docRef = playerSubscriptionsCollection.doc(playerId);
    const doc = await docRef.get();
    if (!doc.exists) return;

    await docRef.update({
        subscribedChats: Firestore.FieldValue.arrayRemove(chatId.toString())
    });
}

/**
 * Get all chat IDs subscribed to a player.
 * @param {string} playerId
 * @returns {Promise<string[]>}
 */
async function getSubscribedChats(playerId) {
    const doc = await playerSubscriptionsCollection.doc(playerId).get();
    if (!doc.exists) return [];
    return doc.data().subscribedChats || [];
}

/**
 * Get all player subscriptions for a chat.
 * @param {string} chatId
 * @returns {Promise<Array<{playerId: string, nickname: string}>>}
 */
async function getChatSubscriptions(chatId) {
    const snapshot = await playerSubscriptionsCollection
        .where('subscribedChats', 'array-contains', chatId.toString())
        .get();
    return snapshot.docs.map(doc => ({
        playerId: doc.data().playerId,
        nickname: doc.data().nickname
    }));
}

// ── Match notification deduplication ───────────────────────────────────────

/**
 * Check if a match notification was already sent to a chat.
 * @param {string} matchId
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function hasNotificationBeenSent(matchId, chatId) {
    const docId = `${matchId}_${chatId}`;
    const doc = await sentMatchNotificationsCollection.doc(docId).get();
    return doc.exists;
}

/**
 * Mark a match notification as sent to a chat.
 * @param {string} matchId
 * @param {string} chatId
 * @param {string[]} [playerIds] - FACEIT player IDs of subscribed players that triggered this notification
 */
async function markNotificationSent(matchId, chatId, playerIds = []) {
    const docId = `${matchId}_${chatId}`;
    await sentMatchNotificationsCollection.doc(docId).set({
        matchId,
        chatId: chatId.toString(),
        playerIds,
        sentAt: Firestore.Timestamp.now()
    });
}

/**
 * Check if a finish notification was already sent for a match+chat.
 * @param {string} matchId
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function hasFinishNotificationBeenSentForChat(matchId, chatId) {
    const docId = `${matchId}_${chatId}_finish`;
    const doc = await sentMatchNotificationsCollection.doc(docId).get();
    return doc.exists;
}

/**
 * Mark a finish notification as sent for a match+chat.
 * @param {string} matchId
 * @param {string} chatId
 * @param {string[]} [playerIds]
 */
async function markFinishNotificationSentForChat(matchId, chatId, playerIds = []) {
    const docId = `${matchId}_${chatId}_finish`;
    await sentMatchNotificationsCollection.doc(docId).set({
        matchId,
        chatId: chatId.toString(),
        playerIds,
        type: 'finish_chat',
        sentAt: Firestore.Timestamp.now(),
    });
}

/**
 * Find recent match IDs from sent_match_notifications where any of the given playerIds were involved.
 * Searches across all chats (not filtered by chatId).
 * Time filtering is done in memory to avoid requiring a composite Firestore index.
 * @param {string[]} playerIds
 * @param {number} sinceTs - Unix timestamp (seconds) lower bound for sentAt
 * @returns {Promise<string[]>} Unique match IDs
 */
async function getRecentMatchIdsForPlayers(playerIds, sinceTs) {
    if (!playerIds.length) return [];

    const sinceMs = sinceTs * 1000;

    // Firestore array-contains supports one value at a time — run queries in parallel
    const snapshots = await Promise.all(
        playerIds.map(playerId =>
            sentMatchNotificationsCollection
                .where('playerIds', 'array-contains', playerId)
                .get()
        )
    );

    const matchIds = new Set();
    for (const snap of snapshots) {
        for (const doc of snap.docs) {
            const data = doc.data();
            // Filter by time in memory — avoids composite index requirement
            const sentAtMs = data.sentAt?.toMillis?.() ?? 0;
            if (sentAtMs >= sinceMs && data.matchId) {
                matchIds.add(data.matchId);
            }
        }
    }
    return [...matchIds];
}

// ── Active matches tracking ────────────────────────────────────────────────

/**
 * Record a match as active for a chat (called when match-start notification is sent).
 * @param {string} chatId
 * @param {string} matchId
 */
async function storeActiveMatch(chatId, matchId) {
    const docId = `${chatId}_${matchId}`;
    await activeMatchesCollection.doc(docId).set({
        chatId: chatId.toString(),
        matchId,
        startedAt: Firestore.Timestamp.now(),
    });
}

/**
 * Get all stored active match IDs for a chat.
 * @param {string} chatId
 * @returns {Promise<string[]>}
 */
async function getActiveMatchIds(chatId) {
    const snapshot = await activeMatchesCollection
        .where('chatId', '==', chatId.toString())
        .get();
    return snapshot.docs.map(doc => doc.data().matchId);
}

/**
 * Remove a match from the active matches store (when it has finished or been cancelled).
 * @param {string} chatId
 * @param {string} matchId
 */
async function removeActiveMatch(chatId, matchId) {
    const docId = `${chatId}_${matchId}`;
    await activeMatchesCollection.doc(docId).delete();
}

module.exports = {
    addPlayer,
    removePlayer,
    getPlayers,
    // Subscriptions
    subscribeChat,
    unsubscribeChat,
    getSubscribedChats,
    getChatSubscriptions,
    // Match notification deduplication
    hasNotificationBeenSent,
    markNotificationSent,
    hasFinishNotificationBeenSentForChat,
    markFinishNotificationSentForChat,
    getRecentMatchIdsForPlayers,
    // Active matches tracking
    storeActiveMatch,
    getActiveMatchIds,
    removeActiveMatch,
};