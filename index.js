export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Telegram Barker Bot is running successfully!", { status: 200 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response("Invalid JSON", { status: 400 });
    }

    const message = body.message || body.edited_message;
    if (!message) {
      return new Response("OK", { status: 200 });
    }

    const chat = message.chat || {};
    const chatId = chat.id;
    const user = message.from || {};
    const userId = user.id;
    const text = (message.text || "").trim();

    if (!chatId) {
      return new Response("OK", { status: 200 });
    }

    const kvKey = `chat_${chatId}_users`;
    let storedUsersRaw = await env.KV.get(kvKey);
    let usersDict = storedUsersRaw ? JSON.parse(storedUsersRaw) : {};

    const leftMember = message.left_chat_member;
    if (leftMember) {
      const leftUserId = String(leftMember.id);
      if (usersDict[leftUserId]) {
        delete usersDict[leftUserId];
        await env.KV.put(kvKey, JSON.stringify(usersDict));
      }
      return new Response("OK", { status: 200 });
    }

    if (!userId || user.is_bot) {
      return new Response("OK", { status: 200 });
    }

    const firstName = user.first_name || "User";
    usersDict[String(userId)] = { id: userId, name: firstName };

    const keys = Object.keys(usersDict);
    if (keys.length > 500) {
      delete usersDict[keys[0]];
    }

    await env.KV.put(kvKey, JSON.stringify(usersDict));

    const botToken = env.BOT_TOKEN || "8862778494:AAEZhxIsr4gVRGR1bnh7w2OATnZI5sSw3Tg";

    if (text.toLowerCase().startsWith("/barker")) {
      const isAdmin = await checkIfAdmin(botToken, chatId, userId);
      if (!isAdmin) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "❌ Команда /barker доступна только администраторам чата.",
          message.message_id
        );
        return new Response("OK", { status: 200 });
      }

      const comment = text.slice("/barker".length).trim() || "Внимание!";
      const availableUsers = Object.values(usersDict);

      if (availableUsers.length === 0) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "⚠️ В базе пока нет участников. Напишите что-нибудь в чат для накопления базы!",
          message.message_id
        );
        return new Response("OK", { status: 200 });
      }

      const mentions = availableUsers.map(u => {
        const safeName = escapeHtml(u.name);
        return `<a href="tg://user?id=${u.id}">${safeName}</a>`;
      });

      // Исправленный шаблон строки: теперь комментарий подставляется корректно
      const responseText = `<b>${escapeHtml(comment)}</b>\n\nПингуем всех: ` + mentions.join(", ");
      
      await sendTelegramMessage(botToken, chatId, responseText, message.message_id);
    }

    return new Response("OK", { status: 200 });
  }
};

async function checkIfAdmin(token, chatId, userId) {
  const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${chatId}&user_id=${userId}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      const status = data.result?.status;
      return status === "creator" || status === "administrator";
    }
  } catch (e) {}
  return false;
}

async function sendTelegramMessage(token, chatId, text, replyToMessageId) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
