const config = require('../config');
const { handleMatchEvent, handleMatchFinishedEvent } = require('../services/subscriptionService');

const SUPPORTED_EVENTS = new Set(['match_status_ready', 'match_status_finished']);

async function handleFaceitWebhook(req, res) {
    // Verify webhook secret
    const secret = config.faceit_webhook_secret;
    if (secret) {
        const incomingSecret = req.headers['x-faceit-webhook-secret'];
        if (incomingSecret !== secret) {
            console.warn('[FACEIT WEBHOOK] Unauthorized request — invalid secret');
            return res.sendStatus(401);
        }
    }

    const body = req.body;
    console.log('[FACEIT WEBHOOK] Received event:', JSON.stringify(body));

    const eventType = body?.event;
    if (!eventType || !SUPPORTED_EVENTS.has(eventType)) {
        // Acknowledge unsupported events without processing
        return res.sendStatus(200);
    }

    // Process asynchronously — respond 200 immediately so FACEIT won't retry
    res.sendStatus(200);

    try {
        if (eventType === 'match_status_ready') {
            await handleMatchEvent(body.payload);
        } else if (eventType === 'match_status_finished') {
            await handleMatchFinishedEvent(body.payload);
        }
    } catch (error) {
        console.error('[FACEIT WEBHOOK] Error handling event:', error);
    }
}

module.exports = { handleFaceitWebhook };
