const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendMessage(chatId, text, extra = {}) {
  return axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function sendPhoto(chatId, photo, caption = "", extra = {}) {
  return axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    chat_id: chatId,
    photo,
    caption,
    ...extra
  });
}

async function sendDocument(chatId, document, caption = "", extra = {}) {
  return axios.post(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
    chat_id: chatId,
    document,
    caption,
    ...extra
  });
}

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🛒 Buyurtma berish" }, { text: "💰 Balans" }],
        [{ text: "💳 Balans to‘ldirish" }, { text: "📦 Buyurtmalarim" }],
        [{ text: "♻️ Refill" }, { text: "❌ Cancel" }],
        [{ text: "📞 Yordam" }]
      ],
      resize_keyboard: true
    }
  };
}

function paymentKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💠 Click" }, { text: "💳 Kartadan kartaga" }],
        [{ text: "⬅️ Orqaga" }]
      ],
      resize_keyboard: true
    }
  };
}

module.exports = {
  sendMessage,
  sendPhoto,
  sendDocument,
  mainKeyboard,
  paymentKeyboard
};
