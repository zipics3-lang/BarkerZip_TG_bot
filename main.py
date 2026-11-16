import json
import random
from js import Response, fetch as cf_fetch

async def on_fetch(request, env, ctx):
    if request.method != "POST":
        return Response.new("Telegram Ping Bot is running successfully!", status=200)

    try:
        body = await request.json()
    except Exception:
        return Response.new("Invalid JSON", status=400)

    message = body.get("message") or body.get("edited_message")
    if not message:
        return Response.new("OK", status=200)

    chat = message.get("chat", {})
    chat_id = chat.get("id")
    user = message.get("from", {})
    user_id = user.get("id")
    text = message.get("text", "").strip()

    if not chat_id:
        return Response.new("OK", status=200)

    kv_key = f"chat_{chat_id}_users"
    stored_users_raw = await env.KV.get(kv_key)
    users_dict = json.loads(stored_users_raw) if stored_users_raw else {}

    # Проверяем, не покинул ли участник чат
    left_member = message.get("left_chat_member")
    if left_member:
        left_user_id = str(left_member.get("id"))
        if left_user_id in users_dict:
            del users_dict[left_user_id]
            await env.KV.put(kv_key, json.dumps(users_dict))
        return Response.new("OK", status=200)

    if not user_id:
        return Response.new("OK", status=200)

    # Сохраняем / обновляем активного пользователя в базе чата
    first_name = user.get("first_name", "User")
    users_dict[str(user_id)] = {"id": user_id, "name": first_name}
    
    if len(users_dict) > 500:
        users_dict.pop(next(iter(users_dict)))
    
    await env.KV.put(kv_key, json.dumps(users_dict))

    bot_token = getattr(env, "BOT_TOKEN", "8862778494:AAEZhxIsr4gVRGR1bnh7w2OATnZI5sSw3Tg")

    # Обработка команды /ping
    if text.startswith("/ping"):
        is_admin = await check_is_admin(bot_token, chat_id, user_id)
        if not is_admin:
            await send_telegram_message(
                bot_token, 
                chat_id, 
                "❌ Команда /ping доступна только администраторам чата.", 
                message.get("message_id")
            )
            return Response.new("OK", status=200)

        comment = text[len("/ping"):].strip()
        if not comment:
            comment = "Внимание!"

        available_users = [u for uid, u in users_dict.items() if int(uid) != user_id]

        if len(available_users) == 0:
            await send_telegram_message(
                bot_token, 
                chat_id, 
                "⚠️ В базе пока нет других участников. Напишите что-нибудь в чат для накопления базы!", 
                message.get("message_id")
            )
            return Response.new("OK", status=200)

        selected_users = random.sample(available_users, min(5, len(available_users)))

        mentions = []
        for u in selected_users:
            safe_name = escape_html(u["name"])
            mentions.append(f'<a href="tg://user?id={u["id"]}">{safe_name}</a>')

        response_text = f"<b>{escape_html(comment)}</b>\n\nПингуем участников: " + ", ".join(mentions)

        await send_telegram_message(bot_token, chat_id, response_text, message.get("message_id"))

    return Response.new("OK", status=200)


async def check_is_admin(token, chat_id, user_id):
    url = f"https://api.telegram.org/bot{token}/getChatMember?chat_id={chat_id}&user_id={user_id}"
    try:
        res = await cf_fetch(url)
        data = await res.json()
        if data.get("ok"):
            status = data.get("result", {}).get("status")
            return status in ["creator", "administrator"]
    except Exception:
        pass
    return False


async def send_telegram_message(token, chat_id, text, reply_to_message_id=None):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    if reply_to_message_id:
        payload["reply_to_message_id"] = reply_to_message_id

    headers = {"Content-Type": "application/json"}
    await cf_fetch(url, method="POST", headers=headers, body=json.dumps(payload))


def escape_html(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
