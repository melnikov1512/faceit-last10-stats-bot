const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();
const chatCollection = db.collection('chats');

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
    
    // Add player to the array
    await docRef.set({
        players: Firestore.FieldValue.arrayUnion(playerNickname)
    }, { merge: true }); // Create if doesn't exist, merge players if exists
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
   
    // Remove player from the array
    await docRef.update({
        players: Firestore.FieldValue.arrayRemove(playerNickname)
    });
}

/**
 * Get the list of players for a chat
 * @param {string} chatId 
 * @returns {Promise<string[]>} Array of player nicknames
 */
async function getPlayers(chatId) {
    if (!chatId) return [];

    const doc = await chatCollection.doc(chatId.toString()).get();
    
    if (!doc.exists) {
        return [];
    }
    
    const data = doc.data();
    return data.players || [];
}


module.exports = {
    addPlayer,
    removePlayer,
    getPlayers
};
