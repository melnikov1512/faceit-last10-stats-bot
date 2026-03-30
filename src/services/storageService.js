const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');

const dbOptions = config.projectId ? { projectId: config.projectId } : {};
console.log(`Initializing Firestore with project ID: ${config.projectId || 'ad-hoc'}`);

const db = new Firestore(dbOptions);
const chatCollection = db.collection('chats');
const playerSubscriptionsCollection = db.collection('player_subscriptions');
const sentMatchNotificationsCollection = db.collection('sent_match_notifications');

/**
 * Add a player to the chat's player list
 * @param {string} chatId 
 * @param {string} playerNickname 
 */
async function addPlayer(chatId, playerNickname) {
    if (!chatId || !playerNickname) {
        throw new Error('chatId and playerNickname are required');
    }

    const docRef = chatCollection.doc(chatId.toString());
    
    try {
        // Add player to the array
        await docRef.set({
            players: Firestore.FieldValue.arrayUnion(playerNickname)
        }, { merge: true }); // Create if doesn't exist, merge players if exists
    } catch (error) {
        if (error.code === 5) { // NOT_FOUND
            throw new Error(`Firestore database not found for project ${config.projectId}. Please create the database in Native Mode in the Google Cloud Console.`);
        }
        throw error;
    }
}

/**
 * Remove a player from the chat's player list
 * @param {string} chatId 
 * @param {string} playerNickname 
 */
async function removePlayer(chatId, playerNickname) {
    if (!chatId || !playerNickname) {
        throw new Error('chatId and playerNickname are required');
    }

    const docRef = chatCollection.doc(chatId.toString());
   
    try {
        // Remove player from the array
        await docRef.update({
            players: Firestore.FieldValue.arrayRemove(playerNickname)
        });
    } catch (error) {
        if (error.code === 5) {
             throw new Error(`Firestore database not found for project ${config.projectId}. Please create the database in Native Mode in the Google Cloud Console.`);
        }
        throw error;
    }
}

/**
 * Get the list of players for a chat
 * @param {string} chatId 
 * @returns {Promise<string[]>} Array of player nicknames
 */
async function getPlayers(chatId) {
    if (!chatId) return [];

    try {
        const doc = await chatCollection.doc(chatId.toString()).get();
        
        if (!doc.exists) {
            return [];
        }
        
        const data = doc.data();
        return data.players || [];
    } catch (error) {
         if (error.code === 5) {
             throw new Error(`Firestore database not found for project ${config.projectId}. Please create the database in Native Mode in the Google Cloud Console.`);
        }
        throw error;
    }
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
    markNotificationSent
};

// ── Subscription methods ────────────────────────────────────────────────────

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
 */
async function markNotificationSent(matchId, chatId) {
    const docId = `${matchId}_${chatId}`;
    await sentMatchNotificationsCollection.doc(docId).set({
        matchId,
        chatId: chatId.toString(),
        sentAt: Firestore.Timestamp.now()
    });
}