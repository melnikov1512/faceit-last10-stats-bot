/**
 * Точка входа для Google Cloud Function (HTTP Trigger)
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
const express = require('express');
const app = express();

app.use(express.json());

// Telegram webhook handler
app.post('/', (req, res) => {
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
});

// Обработчик для health check
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

// Запуск сервера на порту 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Telegram bot server запущен на порту ${PORT}`);
});