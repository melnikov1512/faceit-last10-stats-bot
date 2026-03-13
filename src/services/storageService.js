const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');

const dbOptions = config.projectId ? { projectId: config.projectId } : {};
console.log(`Initializing Firestore with project ID: ${config.projectId || 'ad-hoc'}`);

const db = new Firestore(dbOptions);
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
    getPlayers
};