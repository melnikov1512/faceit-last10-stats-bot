/**
 * Точка входа для Google Cloud Function (HTTP Trigger)
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
exports.telegramBot = (req, res) => {
    // Отсекаем все, кроме POST-запросов
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const update = req.body;
    // Логируем входящий объект для отладки в Google Cloud Logs
    console.log('Получено обновление:', JSON.stringify(update));

    const chatId = update.message?.chat?.id;
    const text = update.message?.text;

    // Если нет текста или ID чата, возвращаем 200, чтобы Telegram не дублировал запрос
    if (!chatId || !text) {
        return res.status(200).send('OK');
    }

    // Формируем Webhook Reply
    const replyPayload = {
        method: 'sendMessage',
        chat_id: chatId,
        text: `Вы сказали: "${text}". Бот работает в облаке!`
    };

    res.status(200).json(replyPayload);
};