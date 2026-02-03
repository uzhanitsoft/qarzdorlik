const TelegramBot = require('node-telegram-bot-api');

// Bot token from BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '8541441577:AAHoLs5ueSZG_2vURFWclrI7GFkw6t2NkA0';

// Mini App URL - Railway'ga deploy qilgandan keyin bu URL ni o'zgartiring!
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://your-app.up.railway.app/app';

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot ishga tushdi!');

// /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Foydalanuvchi';

    bot.sendMessage(chatId,
        `Assalomu alaykum, ${firstName}! 👋\n\n` +
        `📊 Qarzdorlik Dashboard'ga xush kelibsiz!\n\n` +
        `Bu bot orqali agent va qarzdorlar statistikasini ko'rishingiz mumkin.\n\n` +
        `👇 Quyidagi tugmani bosib dashboardni oching:`,
        {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '📊 Dashboard ochish',
                        web_app: { url: MINI_APP_URL }
                    }
                ]]
            }
        }
    );
});

// /help command
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `📖 Yordam\n\n` +
        `/start - Botni ishga tushirish\n` +
        `/stats - Qisqa statistika\n` +
        `/help - Yordam\n\n` +
        `Dashboard tugmasini bosib to'liq ma'lumotlarni ko'ring.`
    );
});

// /stats command - Quick stats from API
bot.onText(/\/stats/, async (msg) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const API_URL = MINI_APP_URL.replace('/app', '/api/data');
        const response = await fetch(API_URL);
        const data = await response.json();

        const stats = `📊 Tezkor statistika:\n\n` +
            `👥 Agentlar: ${data.agents?.length || 0}\n` +
            `👤 Qarzdorlar: ${data.totals?.totalDebtors || 0}\n` +
            `💵 USD: $${(data.totals?.totalUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}\n` +
            `💰 UZS: ${((data.totals?.totalUZS || 0) / 1000000).toFixed(1)}M\n\n` +
            `📅 Yangilangan: ${data.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString('uz-UZ') : 'Noma\'lum'}`;

        bot.sendMessage(msg.chat.id, stats);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Ma\'lumotlarni olishda xato. Server ishlamayaptimi?');
    }
});

console.log('✅ Bot tayyor! Telegram\'da /start buyrug\'ini yuboring.');
