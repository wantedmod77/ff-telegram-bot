const { Telegraf, Markup } = require("telegraf");
const config = require("./config");
const { getPlayerInfo, formatFullInfo, formatUnbanPreview, REGION_MAP } = require("./utils/ffApi");
const {
    registerUser,
    getUser,
    getUserBalance,
    addBalance,
    deductBalance,
    incrementQueries,
    loadUsers,
    setChannelVerified,
    isChannelVerified,
    getSettings,
    saveSettings,
    isAdmin,
    getGateway,
    saveGateway,
    createOrder,
    getOrder,
    getAllOrders,
    getPendingOrders,
    updateOrderStatus,
    saveSession,
    getSession,
    deleteSession,
    loadSessions
} = require("./utils/db");
const { getPricing, updatePrice, addPackage, deletePackage } = require("./utils/pricing");
const { getLikePlans, addLikePlan, updateLikePlanPrice, deleteLikePlan } = require("./utils/likePlans");
const { getGloryPlans, addGloryPlan, updateGloryPlanPrice, deleteGloryPlan } = require("./utils/gloryPlans");
const { makeUpiUri, sendQrPhoto, verifyPaytmStatus } = require("./utils/paytm");

const bot = new Telegraf(config.BOT_TOKEN);

// In-memory conversation states for users and admins
const userStates = new Map();
const adminStates = new Map();

// Logging middleware
bot.use(async (ctx, next) => {
    const user = ctx.from;
    const text = ctx.message?.text || ctx.updateType;
    if (user) {
        console.log(`[${new Date().toLocaleTimeString()}] @${user?.username || user?.id}: ${text}`);
    }
    return next();
});

// ─── Channel Membership Check ────────────────────────────────────────────────
async function getUnjoinedChannels(ctx, userId) {
    const settings = getSettings();
    if (!settings.force_join_enabled) return [];

    // Check if user has already verified through the bot
    if (isChannelVerified(userId)) {
        return [];
    }

    const channels = settings.force_channels || [];
    if (channels.length === 0) {
        if (!settings.force_channel_username) return [];
        channels.push({
            id: settings.force_channel_username,
            name: "ᴏꜰꜰɪᴄɪᴀʟ ᴄʜᴀɴɴᴇʟ",
            link: settings.force_channel_link || `https://t.me/${settings.force_channel_username.replace("@", "")}`
        });
    }

    const unjoined = [];
    const allowed = ["creator", "administrator", "member", "restricted"];

    for (const ch of channels) {
        if (ch.id && String(ch.id).startsWith("-100")) {
            try {
                const member = await ctx.telegram.getChatMember(ch.id, userId);
                if (!allowed.includes(member.status)) {
                    unjoined.push(ch);
                }
            } catch (err) {
                // If bot cannot read chat, force user to verify via the button
                unjoined.push(ch);
            }
        } else {
            unjoined.push(ch);
        }
    }
    return unjoined;
}

async function isUserMember(ctx, userId) {
    const unjoined = await getUnjoinedChannels(ctx, userId);
    return unjoined.length === 0;
}

// ─── Send Force Join Message ─────────────────────────────────────────────────
async function sendForceJoinPrompt(ctx, unjoinedList = null) {
    const settings = getSettings();
    const channels = (unjoinedList && unjoinedList.length > 0)
        ? unjoinedList
        : (settings.force_channels && settings.force_channels.length > 0 ? settings.force_channels : [
            { name: "ᴄʜᴀɴɴᴇʟ 1", link: "https://t.me/+jQCo6BU0zAhjZTc1" },
            { name: "ᴄʜᴀɴɴᴇʟ 2", link: "https://t.me/+MTbKlQKhEYY4MTNl" },
            { name: "ᴄʜᴀɴɴᴇʟ 3", link: "https://t.me/+4Im9de-6xdxmMjI1" }
        ]);

    let channelButtons = channels.map((ch, idx) => [
        Markup.button.url(`📢 ᴊᴏɪɴ ${ch.name || `ᴄʜᴀɴɴᴇʟ ${idx + 1}`}`, ch.link)
    ]);
    channelButtons.push([Markup.button.callback("✅ ᴠᴇʀɪꜰʏ / ᴊᴏɪɴᴇᴅ", "verify_channel_join")]);

    const msg = `
⚠️ <b>ᴄʜᴀɴɴᴇʟ ᴊᴏɪɴ ʀᴇǫᴜɪʀᴇᴅ</b> ⚠️
━━━━━━━━━━━━━━━━━━━━━━
ʙᴏᴛ ᴋᴏ ᴜꜱᴇ ᴋᴀʀɴᴇ ᴋᴇ ʟɪʏᴇ <b>ʜᴀᴍᴀʀᴇ ꜱᴀʙʜɪ ᴏꜰꜰɪᴄɪᴀʟ ᴄʜᴀɴɴᴇʟꜱ</b> ᴊᴏɪɴ ᴋᴀʀɴᴀ ᴢᴀʀᴏᴏʀɪ ʜᴀɪ!

👇 <b>ɴᴇᴇᴄʜᴇ ᴅɪʏᴇ ɢᴀʏᴇ ᴄʜᴀɴɴᴇʟꜱ ᴋᴏ ᴊᴏɪɴ ᴋᴀʀᴇɪɴ, ꜰɪʀ 'ᴠᴇʀɪꜰʏ' ᴅᴀʙᴀʏᴇɪɴ:</b>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(channelButtons).reply_markup
    });
}

// ─── Main Keyboard Helper ────────────────────────────────────────────────────
function getMainKeyboard() {
    return Markup.keyboard([
        ["🎮 ꜰʀᴇᴇ ꜰɪʀᴇ ʟɪᴋᴇ 🔥"],
        ["🛡️ ɢᴜɪʟᴅ ɢʟᴏʀʏ ⚡"],
        ["🔓 ꜰꜰ ɪᴅ ᴜɴʙᴀɴ", "📊 ꜰꜰ ɪᴅ ɪɴꜰᴏ"],
        ["💳 ᴀᴅᴅ ʙᴀʟᴀɴᴄᴇ", "👤 ᴍʏ ᴡᴀʟʟᴇᴛ"]
    ]).resize();
}

// ─── Send Home Screen ────────────────────────────────────────────────────────
async function sendHomeScreen(ctx) {
    const user = ctx.from;
    const userData = registerUser(user);
    const bal = getUserBalance(user.id);

    const welcomeMsg = `
👋 <b>ᴡᴇʟᴄᴏᴍᴇ, ${user.first_name || "Player"}!</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━
👤 <b>ɴᴀᴍᴇ:</b> <b>${user.first_name || ""} ${user.last_name || ""}</b>
🏷️ <b>ᴜꜱᴇʀɴᴀᴍᴇ:</b> ${user.username ? `@${user.username}` : "None"}
🆔 <b>ᴄʜᴀᴛ ɪᴅ:</b> <code>${user.id}</code>
📅 <b>ꜰɪʀꜱᴛ ꜱᴛᴀʀᴛ:</b> <code>${userData.joined_formatted || "Just Now"}</code>
💼 <b>ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ:</b> <b>₹${bal.toFixed(2)}</b>
🛡️ <b>ꜱᴛᴀᴛᴜꜱ:</b> <b>✅ ᴠᴇʀɪꜰɪᴇᴅ ᴍᴇᴍʙᴇʀ</b>
━━━━━━━━━━━━━━━━━━━━━━

🎮 <b>ʀᴀᴊ ᴄᴏᴅᴇʀ ꜰꜰ — ᴏꜰꜰɪᴄɪᴀʟ ᴍᴜʟᴛɪ-ᴜᴛɪʟɪᴛʏ ʙᴏᴛ</b>
⚡ <i>ꜱᴇʟᴇᴄᴛ ᴀɴ ᴏᴘᴛɪᴏɴ ꜰʀᴏᴍ ᴛʜᴇ ᴍᴇɴᴜ ʙᴇʟᴏᴡ:</i>
`;

    await ctx.reply(welcomeMsg, {
        parse_mode: "HTML",
        reply_markup: getMainKeyboard().reply_markup
    });
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
    userStates.delete(ctx.from.id);
    adminStates.delete(ctx.from.id);
    const unjoined = await getUnjoinedChannels(ctx, ctx.from.id);
    if (unjoined.length > 0) {
        return sendForceJoinPrompt(ctx, unjoined);
    }
    return sendHomeScreen(ctx);
});

// ─── Verify Channel Callback ─────────────────────────────────────────────────
bot.action("verify_channel_join", async (ctx) => {
    await ctx.answerCbQuery();
    setChannelVerified(ctx.from.id, true);
    await ctx.reply("🎉 <b>ᴠᴇʀɪꜰɪᴄᴀᴛɪᴏɴ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟ!</b>\nᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ ʙᴏᴛ!", { parse_mode: "HTML" });
    return sendHomeScreen(ctx);
});

// ─── Feature 1: FF ID Unban ──────────────────────────────────────────────────
async function handleUnbanRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const promptMsg = await ctx.reply(
        "🔓 <b>ғғ ɪᴅ ʙᴀɴ ᴀᴜᴅɪᴛ & ᴜɴʙᴀɴ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n🎮 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ʏᴏᴜʀ ғʀᴇᴇ ғɪʀᴇ ᴜɪᴅ:</b>\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>2540951574</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        }
    );

    userStates.set(ctx.from.id, { mode: "UNBAN", promptMsgId: promptMsg.message_id });
}

bot.hears(["🔓 FF ID Unban", "🔓 ꜰꜰ ɪᴅ ᴜɴʙᴀɴ"], handleUnbanRequest);
bot.command("unban", handleUnbanRequest);

// ─── Feature: Free Fire Like ─────────────────────────────────────────────────
async function handleLikeRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const promptMsg = await ctx.reply(
        "🎮 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ʟɪᴋᴇ sᴇʀᴠɪᴄᴇ</b> 🔥\n━━━━━━━━━━━━━━━━━━━━━━\n\n🎯 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ʏᴏᴜʀ ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ:</b>\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>2540951574</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        }
    );

    userStates.set(ctx.from.id, { mode: "LIKE", promptMsgId: promptMsg.message_id });
}

bot.hears("🎮 ꜰʀᴇᴇ ꜰɪʀᴇ ʟɪᴋᴇ 🔥", handleLikeRequest);
bot.command("like", handleLikeRequest);

// ─── Feature: Guild Glory ────────────────────────────────────────────────────
async function handleGloryRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const promptMsg = await ctx.reply(
        "🛡️ <b>ɢᴜɪʟᴅ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ sᴇʀᴠɪᴄᴇ</b> ⚡\n━━━━━━━━━━━━━━━━━━━━━━\n\n🏰 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ʏᴏᴜʀ ɢᴜɪʟᴅ ᴜɪᴅ / ɪᴅ:</b>\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>3015482910</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        }
    );

    userStates.set(ctx.from.id, { mode: "GLORY", promptMsgId: promptMsg.message_id });
}

bot.hears(["🛡️ ɢᴜɪʟᴅ ɢʟᴏʀʏ ⚡", "Guild Glory", "ɢᴜɪʟᴅ ɢʟᴏʀʏ"], handleGloryRequest);
bot.command("glory", handleGloryRequest);

// ─── Feature 2: FF ID Info ───────────────────────────────────────────────────
async function handleInfoRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const promptMsg = await ctx.reply(
        "📊 <b>ғғ ɪᴅ ᴘʀᴏғɪʟᴇ ʟᴏᴏᴋᴜᴘ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n🔍 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴛʜᴇ ғʀᴇᴇ ғɪʀᴇ ᴜɪᴅ:</b>\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>2540951574</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        }
    );

    userStates.set(ctx.from.id, { mode: "INFO", promptMsgId: promptMsg.message_id });
}

bot.hears(["📊 FF ID Info", "📊 ꜰꜰ ɪᴅ ɪɴꜰᴏ"], handleInfoRequest);
bot.command("info", handleInfoRequest);

// ─── Feature 3: Status ───────────────────────────────────────────────────────
async function handleStatusRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const user = registerUser(ctx.from);
    const bal = getUserBalance(user.id);
    const msg = `
👤 <b>ʏᴏᴜʀ ᴘʀᴏғɪʟᴇ & sᴛᴀᴛᴜs</b>
━━━━━━━━━━━━━━━━━━━━━━
📛 <b>ɴᴀᴍᴇ:</b> <b>${user.first_name || ""} ${user.last_name || ""}</b>
🏷️ <b>Username:</b> ${user.username || "None"}
🆔 <b>ᴛᴇʟᴇɢʀᴀᴍ ɪᴅ:</b> <code>${user.id}</code>
💼 <b>ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ:</b> <b>₹${bal.toFixed(2)}</b>
📅 <b>ᴊᴏɪɴᴇᴅ ᴅᴀᴛᴇ:</b> <code>${user.joined_formatted}</code>
📊 <b>ᴛᴏᴛᴀʟ sᴇᴀʀᴄʜᴇs:</b> <b>${user.queries_count || 0}</b>
🛡️ <b>sᴛᴀᴛᴜs:</b> <b>✅ ᴠᴇʀɪғɪᴇᴅ ᴍᴇᴍʙᴇʀ</b>
━━━━━━━━━━━━━━━━━━━━━━
⚡ <i>ʙᴏᴛ ɪs ᴀᴄᴛɪᴠᴇ & ᴏᴘᴇʀᴀᴛɪᴏɴᴀʟ 24/7</i>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("💳 ᴀᴅᴅ ʙᴀʟᴀɴᴄᴇ", "prompt_add_balance")]
        ]).reply_markup
    });
}

// ─── Garena Ban Login Features (Exact Clone of @GarenaBanLoginBot) ───────────

// 1. BAN LOGIN
async function handleBanLoginRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    userStates.set(ctx.from.id, { mode: "WAITING_BAN_TOKEN" });

    const s = getSettings();
    const linkPlayPc = s.link_play_game_pc || "https://t.me/RajCoderFf";
    const link30Day = s.link_30_day_ban || "https://t.me/freefireofficialinfoupdates";
    const linkHowToken = s.link_how_to_get_token || "https://t.me/RajCoderFf";
    const linkInsta = s.link_follow_instagram || "https://t.me/RajCoderFf";

    const msg = `RAJ CODER FF\nBAN LOGIN\n\nACCESS TOKEN CAN BE USED TO LOGIN TO YOUR BANNED GAME ACCOUNT AND CHECK YOUR GAME PROFILE.\n\nPLEASE SEND YOUR <b>ACCESS TOKEN</b> TO CREATE A NEW SESSION.\n\n📝 <b>Send your access token below:</b>\n\n⚠️ <i>Type /cancel to cancel.</i>`;

    const inlineKb = Markup.inlineKeyboard([
        [Markup.button.url("PLAY GAME WITH PC LOGO ↗", linkPlayPc)],
        [Markup.button.url("30 DAY BAN FF ACCOUNT ↗", link30Day)],
        [Markup.button.url("HOW TO GET ACCESS TOKEN ↗", linkHowToken)],
        [Markup.button.url("FOLLOW INSTAGRAM ↗", linkInsta)]
    ]);

    return ctx.reply(msg, { parse_mode: "HTML", reply_markup: inlineKb.reply_markup });
}

// 2. STOP SESSION
async function handleStopSessionRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const session = getSession(ctx.from.id);
    if (!session) {
        return ctx.reply("RAJ CODER FF\nSTOP SESSION\n\n⚠️ <b>No active session found to stop.</b>", {
            parse_mode: "HTML",
            reply_markup: getMainKeyboard().reply_markup
        });
    }

    deleteSession(ctx.from.id);
    return ctx.reply("RAJ CODER FF\nSTOP SESSION\n\n✅ <b>Your active session has been stopped and cleared successfully.</b>", {
        parse_mode: "HTML",
        reply_markup: getMainKeyboard().reply_markup
    });
}

// 3. STATUS (Ban Login Session Status)
async function handleSessionStatusRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const session = getSession(ctx.from.id);
    if (!session) {
        return ctx.reply("RAJ CODER FF\nSESSION STATUS\n\n❌ <b>No Active Session Found.</b>\n\nUse <b>BAN LOGIN</b> to create a new session.", {
            parse_mode: "HTML",
            reply_markup: getMainKeyboard().reply_markup
        });
    }

    const msg = `RAJ CODER FF\nSESSION STATUS\n\n✅ <b>Active Session Details:</b>\n• <b>Session ID:</b> <code>${session.sessionId}</code>\n• <b>Status:</b> 🟢 ACTIVE\n• <b>Created At:</b> <code>${session.created_formatted}</code>\n• <b>Server URL:</b> <code>${session.serverLoginUrl}</code>\n\n<i>To stop this session, tap STOP SESSION below.</i>`;

    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: getMainKeyboard().reply_markup
    });
}

// 4. ABOUT THIS BOT
async function handleAboutThisBotRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const session = getSession(ctx.from.id);
    if (!session) {
        return ctx.reply("RAJ CODER FF\nABOUT THIS BOT\n\n<b>INVALID TOKEN</b>", {
            parse_mode: "HTML",
            reply_markup: getMainKeyboard().reply_markup
        });
    }

    const msg = `RAJ CODER FF\nABOUT THIS BOT\n\n✅ <b>ACTIVE SESSION TOKEN:</b>\n• <b>Session ID:</b> <code>${session.sessionId}</code>\n• <b>Server Login URL:</b> <code>${session.serverLoginUrl}</code>\n• <b>Status:</b> 🟢 ACTIVE\n• <b>Created At:</b> <code>${session.created_formatted}</code>`;

    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: getMainKeyboard().reply_markup
    });
}

// Register Listeners
bot.hears("BAN LOGIN", handleBanLoginRequest);
bot.command("banlogin", handleBanLoginRequest);

bot.hears("STOP SESSION", handleStopSessionRequest);
bot.command("stopsession", handleStopSessionRequest);

bot.hears("STATUS", handleSessionStatusRequest);

bot.hears("ABOUT THIS BOT", handleAboutThisBotRequest);
bot.command("about", handleAboutThisBotRequest);

bot.hears(["👤 My Wallet", "👤 ᴍʏ ᴡᴀʟʟᴇᴛ"], handleStatusRequest);
bot.hears("👤 Status", handleStatusRequest);
bot.command("status", handleStatusRequest);

// ─── Feature 4: Add Balance / Wallet ─────────────────────────────────────────
async function handleAddBalanceMenu(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const user = registerUser(ctx.from);
    const bal = getUserBalance(user.id);

    const msg = `
💳 <b>ᴡᴀʟʟᴇᴛ ᴛᴏᴘ-ᴜᴘ</b>
━━━━━━━━━━━━━━━━━━━━━━
💼 <b>ᴄᴜʀʀᴇɴᴛ ʙᴀʟᴀɴᴄᴇ:</b> <b>₹${bal.toFixed(2)}</b>

ᴀᴅᴅ ᴍᴏɴᴇʏ ᴛᴏ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ғᴏʀ ɪɴsᴛᴀɴᴛ 1-ᴄʟɪᴄᴋ ᴜɴʙᴀɴ ᴘᴀʏᴍᴇɴᴛs!

👇 <b>sᴇʟᴇᴄᴛ ᴀɴ ᴀᴍᴏᴜɴᴛ ʙᴇʟᴏᴡ:</b>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("⚡ ₹50", "topup_amt_50"),
            Markup.button.callback("⚡ ₹100", "topup_amt_100"),
            Markup.button.callback("⚡ ₹200", "topup_amt_200")
        ],
        [
            Markup.button.callback("⚡ ₹500", "topup_amt_500"),
            Markup.button.callback("⚡ ₹1000", "topup_amt_1000")
        ],
        [
            Markup.button.callback("✏️ ᴇɴᴛᴇʀ ᴄᴜsᴛᴏᴍ ᴀᴍᴏᴜɴᴛ", "topup_amt_custom")
        ],
        [
            Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")
        ]
    ]);

    return ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
}

bot.hears(["💳 Add Balance", "💳 ᴀᴅᴅ ʙᴀʟᴀɴᴄᴇ"], handleAddBalanceMenu);
bot.command("balance", handleAddBalanceMenu);
bot.action("prompt_add_balance", async (ctx) => {
    await ctx.answerCbQuery();
    return handleAddBalanceMenu(ctx);
});

// Top-up Amount Handler
bot.action(/^topup_amt_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1]);
    return generateWalletTopupQr(ctx, amount);
});

bot.action("topup_amt_custom", async (ctx) => {
    await ctx.answerCbQuery();
    userStates.set(ctx.from.id, { mode: "WALLET_CUSTOM_AMOUNT" });
    return ctx.reply("✏️ <b>ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴀᴍᴏᴜɴᴛ ᴛᴏ ᴀᴅᴅ (ᴍɪɴɪᴍᴜᴍ ₹10):</b>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>150</code> ᴏʀ <code>350</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "cancel_action")]]).reply_markup
    });
});

async function generateWalletTopupQr(ctx, amount) {
    if (isNaN(amount) || amount < 10) {
        return ctx.reply("❌ ᴀᴍᴏᴜɴᴛ ᴍᴜsᴛ ʙᴇ ᴀᴛ ʟᴇᴀsᴛ ₹10!");
    }

    try { await ctx.sendChatAction("upload_photo"); } catch { }

    const user = ctx.from;
    registerUser(user);
    const gw = getGateway();

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Player",
        ffUid: "WALLET_TOPUP",
        pkgKey: "topup",
        pkgLabel: "Wallet Balance Top-up",
        amount: amount,
        purpose: "wallet"
    });

    const upiId = gw.paytm.upi_id || "rajcoderff@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE UNBAN SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, amount, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  💳 <b>ᴘᴀʏᴛᴍ ᴡᴀʟʟᴇᴛ ᴛᴏᴘ-ᴜᴘ</b>
━━━━━━━━━━━━━━━━━━━━━━━

💰 <b>ᴛᴏᴘ-ᴜᴘ ᴀᴍᴏᴜɴᴛ:</b> <b>₹${amount}</b>
🔐 <b>Order Reference:</b> <code>${order.id}</code>
💳 <b>Payee UPI VPA:</b> <code>${upiId}</code>
⏱️ <b>Validity:</b> 15 Minutes

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>ᴘᴀʏᴍᴇɴᴛ ɪɴsᴛʀᴜᴄᴛɪᴏɴs:</b>
1️⃣ sᴄᴀɴ ᴛʜɪs ǫʀ ᴜsɪɴɢ <b>ᴘᴀʏᴛᴍ, ɢᴏᴏɢʟᴇ ᴘᴀʏ, ᴘʜᴏɴᴇᴘᴇ</b> ᴏʀ ᴀɴʏ ᴜᴘɪ ᴀᴘᴘ.
2️⃣ ᴘᴀʏ <b>ᴇxᴀᴄᴛʟʏ ₹${amount}</b>.
3️⃣ ᴀғᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ, ᴛᴀᴘ <b>[🔄 ᴠᴇʀɪғʏ ᴛᴏᴘ-ᴜᴘ]</b> ʙᴇʟᴏᴡ.

⚡ <b>ᴀᴜᴛᴏ-ᴠᴇʀɪғʏ:</b> ᴍᴏɴᴇʏ ᴡɪʟʟ ʙᴇ ᴀᴅᴅᴇᴅ ɪɴsᴛᴀɴᴛʟʏ ᴛᴏ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 ᴠᴇʀɪғʏ ᴛᴏᴘ-ᴜᴘ", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ Cancel", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── /regions ────────────────────────────────────────────────────────────────
bot.command("regions", async (ctx) => {
    const regions = Object.entries(REGION_MAP)
        .map(([code, label]) => `• <code>${code.toUpperCase()}</code> → ${label}`)
        .join("\n");
    ctx.reply(`🌍 <b>sᴜᴘᴘᴏʀᴛᴇᴅ sᴇʀᴠᴇʀ ʀᴇɢɪᴏɴs:</b>\n\n${regions}\n\n📌 <b>ᴇxᴀᴍᴘʟᴇ:</b> <code>/get 2540951574 ind</code>`, {
        parse_mode: "HTML",
    });
});

// ─── /get Command ────────────────────────────────────────────────────────────
bot.command("get", async (ctx) => {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const parts = ctx.message.text.trim().split(/\s+/);
    const args = parts.slice(1);

    if (args.length < 1) {
        return ctx.reply("❌ <b>ᴜsᴀɢᴇ:</b> <code>/get &lt;uid&gt; [region]</code>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>/get 2540951574</code>", {
            parse_mode: "HTML",
            reply_to_message_id: ctx.message.message_id,
        });
    }

    const uid = args[0];
    const settings = getSettings();
    const region = (args[1] || settings.default_region || "IND").toUpperCase();

    return executeFullInfoQuery(ctx, uid, region);
});

// ─── Cancel Action Callback ──────────────────────────────────────────────────
bot.action("cancel_action", async (ctx) => {
    userStates.delete(ctx.from.id);
    await ctx.answerCbQuery("Cancelled");
    await ctx.reply("❌ <b>ᴀᴄᴛɪᴏɴ ᴄᴀɴᴄᴇʟʟᴇᴅ.</b>", {
        parse_mode: "HTML",
        reply_markup: getMainKeyboard().reply_markup
    });
});

// ─── Unban YES Button Callback (With Hindi + English Mix) ────────────────────
bot.action(/^unban_yes_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.match[1];
    const prices = getPricing();

    const noteMsg = `
⚠️ <b>ɪᴍᴘᴏʀᴛᴀɴᴛ ɴᴏᴛɪᴄᴇ:</b>
━━━━━━━━━━━━━━━━━━━━━━
📌 <b>ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss sᴛᴀʀᴛs ɪᴍᴍᴇᴅɪᴀᴛᴇʟʏ</b> ᴀғᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ ᴄᴏᴍᴘʟᴇᴛɪᴏɴ.
⚠️ <b>ᴘʟᴇᴀsᴇ ɴᴏᴛᴇ:</b> ᴅᴏ ɴᴏᴛ ʟᴏɢɪɴ ᴛᴏ ʏᴏᴜʀ ғʀᴇᴇ ғɪʀᴇ ɪᴅ ғᴏʀ <b>30 ᴛᴏ 40 ᴍɪɴᴜᴛᴇs</b> ᴀғᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ!
❌ <b>ᴏᴛʜᴇʀᴡɪsᴇ ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss ᴡɪʟʟ ғᴀɪʟ</b> ᴀɴᴅ ᴀᴄᴄᴏᴜɴᴛ ᴡᴏɴ'ᴛ ʙᴇ ʀᴇᴄᴏᴠᴇʀᴇᴅ.
━━━━━━━━━━━━━━━━━━━━━━

❓ <b>ʜᴏᴡ ʟᴏɴɢ ɪs ʏᴏᴜʀ ᴀᴄᴄᴏᴜɴᴛ ʙᴀɴɴᴇᴅ ғᴏʀ? sᴇʟᴇᴄᴛ ᴛʜᴇ ᴄᴏʀʀᴇᴄᴛ ᴏᴘᴛɪᴏɴ ᴏᴛʜᴇʀᴡɪsᴇ ᴜɴʙᴀɴ ᴡɪʟʟ ғᴀɪʟ:</b>
`;

    const buttonRows = [];
    for (const [key, pkg] of Object.entries(prices)) {
        buttonRows.push([
            Markup.button.callback(`⏱️ ${pkg.label} — Pay ₹${pkg.price}`, `pkg_${key}_${uid}`)
        ]);
    }
    buttonRows.push([Markup.button.callback("❌ Cancel", "cancel_action")]);

    await ctx.reply(noteMsg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttonRows).reply_markup
    });
});

// ─── Free Fire Like Plan Selection & Payment ─────────────────────────────────
bot.action(/^like_choose_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.match[1];
    const plans = getLikePlans();

    const noteMsg = `
🎮 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ʟɪᴋᴇ ᴘʟᴀɴꜱ</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ:</b> <code>${uid}</code>

⚡ <b>ꜱᴇʟᴇᴄᴛ ʏᴏᴜʀ ᴅᴇꜱɪʀᴇᴅ ʟɪᴋᴇ ᴘᴀᴄᴋᴀɢᴇ:</b>
<i>(ʟɪᴋᴇꜱ ᴡɪʟʟ ʙᴇ ᴅᴇʟɪᴠᴇʀᴇᴅ ᴅᴀɪʟʏ ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ!)</i>
━━━━━━━━━━━━━━━━━━━━━━
`;

    const buttonRows = [];
    for (const [key, plan] of Object.entries(plans)) {
        buttonRows.push([
            Markup.button.callback(`🔥 ${plan.label || `${plan.days} ᴅᴀʏꜱ — ${plan.likes} ʟɪᴋᴇꜱ (₹${plan.price})`}`, `like_pkg_${key}_${uid}`)
        ]);
    }
    buttonRows.push([Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]);

    await ctx.reply(noteMsg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttonRows).reply_markup
    });
});

bot.action(/^like_pkg_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const plans = getLikePlans();
    const plan = plans[planKey] || { label: "1 Day Like", price: 25, days: 1, likes: "220+" };
    const user = ctx.from;
    registerUser(user);

    const userBal = getUserBalance(user.id);

    if (userBal >= plan.price) {
        const askMsg = `
📋 <b>ꜱᴇʟᴇᴄᴛᴇᴅ ʟɪᴋᴇ ᴘʟᴀɴ:</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ:</b> <code>${ffUid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${plan.label}</b>
💰 <b>ᴘᴀʏᴀʙʟᴇ ᴀᴍᴏᴜɴᴛ:</b> <b>₹${plan.price}</b>
💼 <b>ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ:</b> <b>₹${userBal.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━

⚡ <b>ʏᴏᴜ ʜᴀᴠᴇ ꜱᴜꜰꜰɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ!</b>
ʏᴏᴜ ᴄᴀɴ ᴘᴀʏ ɪɴꜱᴛᴀɴᴛʟʏ ꜰʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ᴏʀ ꜱᴄᴀɴ ᴘᴀʏᴛᴍ ǫʀ ᴄᴏᴅᴇ:
`;
        return ctx.reply(askMsg, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback(`⚡ ᴘᴀʏ ꜰʀᴏᴍ ᴡᴀʟʟᴇᴛ (₹${plan.price})`, `like_pay_wallet_${planKey}_${ffUid}`)],
                [Markup.button.callback(`💳 ᴘᴀʏ ᴠɪᴀ ᴘᴀʏᴛᴍ ǫʀ (₹${plan.price})`, `like_pay_qr_${planKey}_${ffUid}`)],
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        });
    }

    return generateLikeQrPayment(ctx, planKey, ffUid, plan);
});

bot.action(/^like_pay_wallet_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const plans = getLikePlans();
    const plan = plans[planKey] || { label: "1 Day Like", price: 25, days: 1, likes: "220+" };
    const user = ctx.from;

    const remainingBal = deductBalance(user.id, plan.price);
    if (remainingBal === false) {
        return ctx.reply("❌ ɪɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ. ᴘʟᴇᴀꜱᴇ ᴘᴀʏ ᴠɪᴀ ǫʀ ᴄᴏᴅᴇ.", {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("💳 ᴘᴀʏ ᴠɪᴀ ǫʀ", `like_pay_qr_${planKey}_${ffUid}`)]]).reply_markup
        });
    }

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: ffUid,
        pkgKey: planKey,
        pkgLabel: plan.label,
        amount: plan.price,
        days: plan.days,
        likes: plan.likes,
        purpose: "like"
    });

    await handleSuccessfulPayment(ctx.telegram, order, "WALLET_BALANCE");
    return ctx.reply(`✅ <b>₹${plan.price} ᴅᴇᴅᴜᴄᴛᴇᴅ ꜰʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ!</b>\n💼 ʀᴇᴍᴀɪɴɪɴɢ ʙᴀʟᴀɴᴄᴇ: <b>₹${remainingBal.toFixed(2)}</b>\n\n🎉 ʏᴏᴜʀ ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ ʜᴀꜱ ʙᴇᴇɴ ᴀᴅᴅᴇᴅ ꜰᴏʀ ʟɪᴋᴇ ᴅᴇʟɪᴠᴇʀʏ!`, {
        parse_mode: "HTML"
    });
});

bot.action(/^like_pay_qr_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const plans = getLikePlans();
    const plan = plans[planKey] || { label: "1 Day Like", price: 25, days: 1, likes: "220+" };
    return generateLikeQrPayment(ctx, planKey, ffUid, plan);
});

async function generateLikeQrPayment(ctx, planKey, ffUid, plan) {
    try { await ctx.sendChatAction("upload_photo"); } catch { }
    const user = ctx.from;
    const gw = getGateway();

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: ffUid,
        pkgKey: planKey,
        pkgLabel: plan.label,
        amount: plan.price,
        days: plan.days,
        likes: plan.likes,
        purpose: "like"
    });

    const upiId = gw.paytm.upi_id || "rajcoderff@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, plan.price, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎮 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ʟɪᴋᴇ ᴘᴀʏᴍᴇɴᴛ</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━━

🆔 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ:</b> <code>${ffUid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${plan.label}</b>
💰 <b>ᴀᴍᴏᴜɴᴛ ᴛᴏ ᴘᴀʏ:</b> <b>₹${plan.price}</b>
🔐 <b>ᴏʀᴅᴇʀ ʀᴇꜰᴇʀᴇɴᴄᴇ:</b> <code>${order.id}</code>
💳 <b>ᴘᴀʏᴇᴇ ᴜᴘɪ:</b> <code>${upiId}</code>
⏱️ <b>ᴠᴀʟɪᴅɪᴛʏ:</b> 15 ᴍɪɴᴜᴛᴇꜱ

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>ᴘᴀʏᴍᴇɴᴛ ɪɴꜱᴛʀᴜᴄᴛɪᴏɴꜱ:</b>
1️⃣ ꜱᴄᴀɴ ᴛʜɪꜱ ǫʀ ᴄᴏᴅᴇ ᴜꜱɪɴɢ <b>ᴘᴀʏᴛᴍ, ɢᴏᴏɢʟᴇ ᴘᴀʏ, ᴘʜᴏɴᴇᴘᴇ</b> ᴏʀ ᴀɴʏ ᴜᴘɪ ᴀᴘᴘ.
2️⃣ ᴘᴀʏ <b>ᴇxᴀᴄᴛʟʏ ₹${plan.price}</b>.
3️⃣ ᴀꜰᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ, ᴛᴀᴘ <b>[🔄 ᴠᴇʀɪꜰʏ ᴘᴀʏᴍᴇɴᴛ]</b> ʙᴇʟᴏᴡ.

⚡ <b>ᴀᴜᴛᴏ-ᴠᴇʀɪꜰʏ:</b> ʏᴏᴜʀ ᴜɪᴅ ᴡɪʟʟ ʙᴇ ᴀᴄᴛɪᴠᴀᴛᴇᴅ ɪɴꜱᴛᴀɴᴛʟʏ ꜰᴏʀ ʟɪᴋᴇꜱ!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 ᴠᴇʀɪꜰʏ ᴘᴀʏᴍᴇɴᴛ", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── Guild Glory Plan Selection & Payment ────────────────────────────────────
bot.action(/^glory_choose_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const guildUid = ctx.match[1];
    const plans = getGloryPlans();

    const noteMsg = `
🛡️ <b>ɢᴜɪʟᴅ ɢʟᴏʀʏ ᴘʟᴀɴꜱ</b> ⚡
━━━━━━━━━━━━━━━━━━━━━━
🏰 <b>ɢᴜɪʟᴅ ᴜɪᴅ:</b> <code>${guildUid}</code>

⚡ <b>ꜱᴇʟᴇᴄᴛ ʏᴏᴜʀ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ ᴘᴀᴄᴋᴀɢᴇ:</b>
<i>(ʙᴏᴛꜱ ᴡɪʟʟ ʙᴇ ᴀꜱꜱɪɢɴᴇᴅ ᴛᴏ ʙᴏᴏꜱᴛ ʏᴏᴜʀ ɢᴜɪʟᴅ ɢʟᴏʀʏ!)</i>
━━━━━━━━━━━━━━━━━━━━━━
`;

    const buttonRows = [];
    for (const [key, plan] of Object.entries(plans)) {
        buttonRows.push([
            Markup.button.callback(`🛡️ ${plan.label || `${plan.bots} ʙᴏᴛ — ${plan.glory} ɢʟᴏʀʏ (₹${plan.price})`}`, `glory_pkg_${key}_${guildUid}`)
        ]);
    }
    buttonRows.push([Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]);

    await ctx.reply(noteMsg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttonRows).reply_markup
    });
});

bot.action(/^glory_pkg_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const guildUid = ctx.match[2];
    const plans = getGloryPlans();
    const plan = plans[planKey] || { label: "1 Bot Glory", price: 250, bots: 1, glory: "2400" };
    const user = ctx.from;
    registerUser(user);

    const userBal = getUserBalance(user.id);

    if (userBal >= plan.price) {
        const askMsg = `
📋 <b>ꜱᴇʟᴇᴄᴛᴇᴅ ɢᴜɪʟᴅ ɢʟᴏʀʏ ᴘʟᴀɴ:</b>
━━━━━━━━━━━━━━━━━━━━━━
🏰 <b>ɢᴜɪʟᴅ ᴜɪᴅ:</b> <code>${guildUid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${plan.label}</b>
💰 <b>ᴘᴀʏᴀʙʟᴇ ᴀᴍᴏᴜɴᴛ:</b> <b>₹${plan.price}</b>
💼 <b>ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ:</b> <b>₹${userBal.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━

⚡ <b>ʏᴏᴜ ʜᴀᴠᴇ ꜱᴜꜰꜰɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ!</b>
ʏᴏᴜ ᴄᴀɴ ᴘᴀʏ ɪɴꜱᴛᴀɴᴛʟʏ ꜰʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ᴏʀ ꜱᴄᴀɴ ᴘᴀʏᴛᴍ ǫʀ ᴄᴏᴅᴇ:
`;
        return ctx.reply(askMsg, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback(`⚡ ᴘᴀʏ ꜰʀᴏᴍ ᴡᴀʟʟᴇᴛ (₹${plan.price})`, `glory_pay_wallet_${planKey}_${guildUid}`)],
                [Markup.button.callback(`💳 ᴘᴀʏ ᴠɪᴀ ᴘᴀʏᴛᴍ ǫʀ (₹${plan.price})`, `glory_pay_qr_${planKey}_${guildUid}`)],
                [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
            ]).reply_markup
        });
    }

    return generateGloryQrPayment(ctx, planKey, guildUid, plan);
});

bot.action(/^glory_pay_wallet_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const guildUid = ctx.match[2];
    const plans = getGloryPlans();
    const plan = plans[planKey] || { label: "1 Bot Glory", price: 250, bots: 1, glory: "2400" };
    const user = ctx.from;

    const remainingBal = deductBalance(user.id, plan.price);
    if (remainingBal === false) {
        return ctx.reply("❌ ɪɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ. ᴘʟᴇᴀꜱᴇ ᴘᴀʏ ᴠɪᴀ ǫʀ ᴄᴏᴅᴇ.", {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("💳 ᴘᴀʏ ᴠɪᴀ ǫʀ", `glory_pay_qr_${planKey}_${guildUid}`)]]).reply_markup
        });
    }

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: guildUid,
        pkgKey: planKey,
        pkgLabel: plan.label,
        amount: plan.price,
        bots: plan.bots,
        glory: plan.glory,
        purpose: "glory"
    });

    await handleSuccessfulPayment(ctx.telegram, order, "WALLET_BALANCE");
    return ctx.reply(`✅ <b>₹${plan.price} ᴅᴇᴅᴜᴄᴛᴇᴅ ꜰʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ!</b>\n💼 ʀᴇᴍᴀɪɴɪɴɢ ʙᴀʟᴀɴᴄᴇ: <b>₹${remainingBal.toFixed(2)}</b>\n\n🎉 ʏᴏᴜʀ ɢᴜɪʟᴅ ᴜɪᴅ ʜᴀꜱ ʙᴇᴇɴ ᴀᴅᴅᴇᴅ ꜰᴏʀ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ!`, {
        parse_mode: "HTML"
    });
});

bot.action(/^glory_pay_qr_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planKey = ctx.match[1];
    const guildUid = ctx.match[2];
    const plans = getGloryPlans();
    const plan = plans[planKey] || { label: "1 Bot Glory", price: 250, bots: 1, glory: "2400" };
    return generateGloryQrPayment(ctx, planKey, guildUid, plan);
});

async function generateGloryQrPayment(ctx, planKey, guildUid, plan) {
    try { await ctx.sendChatAction("upload_photo"); } catch { }
    const user = ctx.from;
    const gw = getGateway();

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: guildUid,
        pkgKey: planKey,
        pkgLabel: plan.label,
        amount: plan.price,
        bots: plan.bots,
        glory: plan.glory,
        purpose: "glory"
    });

    const upiId = gw.paytm.upi_id || "rajcoderff@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, plan.price, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  🛡️ <b>ɢᴜɪʟᴅ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ ᴘᴀʏᴍᴇɴᴛ</b> ⚡
━━━━━━━━━━━━━━━━━━━━━━━

🏰 <b>ɢᴜɪʟᴅ ᴜɪᴅ:</b> <code>${guildUid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${plan.label}</b>
💰 <b>ᴀᴍᴏᴜɴᴛ ᴛᴏ ᴘᴀʏ:</b> <b>₹${plan.price}</b>
🔐 <b>ᴏʀᴅᴇʀ ʀᴇꜰᴇʀᴇɴᴄᴇ:</b> <code>${order.id}</code>
💳 <b>ᴘᴀʏᴇᴇ ᴜᴘɪ:</b> <code>${upiId}</code>
⏱️ <b>ᴠᴀʟɪᴅɪᴛʏ:</b> 15 ᴍɪɴᴜᴛᴇꜱ

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>ᴘᴀʏᴍᴇɴᴛ ɪɴꜱᴛʀᴜᴄᴛɪᴏɴꜱ:</b>
1️⃣ ꜱᴄᴀɴ ᴛʜɪꜱ ǫʀ ᴄᴏᴅᴇ ᴜꜱɪɴɢ <b>ᴘᴀʏᴛᴍ, ɢᴏᴏɢʟᴇ ᴘᴀʏ, ᴘʜᴏɴᴇᴘᴇ</b> ᴏʀ ᴀɴʏ ᴜᴘɪ ᴀᴘᴘ.
2️⃣ ᴘᴀʏ <b>ᴇxᴀᴄᴛʟʏ ₹${plan.price}</b>.
3️⃣ ᴀꜰᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ, ᴛᴀᴘ <b>[🔄 ᴠᴇʀɪꜰʏ ᴘᴀʏᴍᴇɴᴛ]</b> ʙᴇʟᴏᴡ.

⚡ <b>ᴀᴜᴛᴏ-ᴠᴇʀɪꜰʏ:</b> ʏᴏᴜʀ ɢᴜɪʟᴅ ᴡɪʟʟ ʙᴇ ᴀᴅᴅᴇᴅ ɪɴꜱᴛᴀɴᴛʟʏ ꜰᴏʀ ɢʟᴏʀʏ!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 ᴠᴇʀɪꜰʏ ᴘᴀʏᴍᴇɴᴛ", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── Package Selection -> Check Wallet or Show Paytm QR ──────────────────────
bot.action(/^pkg_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pkgKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const prices = getPricing();
    const pkg = prices[pkgKey] || { label: pkgKey, price: 99 };
    const user = ctx.from;
    registerUser(user);

    const userBal = getUserBalance(user.id);

    // If user has enough wallet balance, offer 1-click Wallet Pay!
    if (userBal >= pkg.price) {
        const askMsg = `
📋 <b>sᴇʟᴇᴄᴛᴇᴅ ᴘᴀᴄᴋᴀɢᴇ:</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>Free Fire UID:</b> <code>${ffUid}</code>
🛡️ <b>Ban Category:</b> <b>${pkg.label}</b>
💰 <b>Payable Amount:</b> <b>₹${pkg.price}</b>
💼 <b>Your Wallet Balance:</b> <b>₹${userBal.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━

⚡ <b>ʏᴏᴜ ʜᴀᴠᴇ sᴜғғɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ!</b>
ʏᴏᴜ ᴄᴀɴ ᴘᴀʏ ɪɴsᴛᴀɴᴛʟʏ ғʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ ᴏʀ sᴄᴀɴ ᴘᴀʏᴛᴍ ǫʀ ᴄᴏᴅᴇ:
`;
        return ctx.reply(askMsg, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback(`⚡ ᴘᴀʏ ғʀᴏᴍ ᴡᴀʟʟᴇᴛ (ɪɴsᴛᴀɴᴛ ᴜɴʙᴀɴ ₹${pkg.price})`, `pay_wallet_${pkgKey}_${ffUid}`)],
                [Markup.button.callback(`💳 Pay via Paytm QR Code (₹${pkg.price})`, `pay_qr_${pkgKey}_${ffUid}`)],
                [Markup.button.callback("❌ Cancel", "cancel_action")]
            ]).reply_markup
        });
    }

    // Direct QR generation if wallet balance is less
    return generateUnbanQrPayment(ctx, pkgKey, ffUid, pkg);
});

// Pay from Wallet Callback (1-Click Instant Unban)
bot.action(/^pay_wallet_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pkgKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const prices = getPricing();
    const pkg = prices[pkgKey] || { label: pkgKey, price: 99 };
    const user = ctx.from;

    const remainingBal = deductBalance(user.id, pkg.price);
    if (remainingBal === false) {
        return ctx.reply("❌ ɪɴsᴜғғɪᴄɪᴇɴᴛ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ. ᴘʟᴇᴀsᴇ ᴘᴀʏ ᴠɪᴀ ǫʀ ᴄᴏᴅᴇ.", {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback("💳 Pay via Paytm QR", `pay_qr_${pkgKey}_${ffUid}`)]]).reply_markup
        });
    }

    // Create completed order
    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: ffUid,
        pkgKey: pkgKey,
        pkgLabel: pkg.label,
        amount: pkg.price,
        purpose: "unban"
    });

    await handleSuccessfulPayment(ctx.telegram, order, "WALLET_BALANCE");
    return ctx.reply(`✅ <b>₹${pkg.price} ᴅᴇᴅᴜᴄᴛᴇᴅ ғʀᴏᴍ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ!</b>\n💼 ʀᴇᴍᴀɪɴɪɴɢ ʙᴀʟᴀɴᴄᴇ: <b>₹${remainingBal.toFixed(2)}</b>\n\n🎉 ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss ʜᴀs ʙᴇᴇɴ sᴛᴀʀᴛᴇᴅ!`, {
        parse_mode: "HTML"
    });
});

// Force Paytm QR callback
bot.action(/^pay_qr_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pkgKey = ctx.match[1];
    const ffUid = ctx.match[2];
    const prices = getPricing();
    const pkg = prices[pkgKey] || { label: pkgKey, price: 99 };
    return generateUnbanQrPayment(ctx, pkgKey, ffUid, pkg);
});

async function generateUnbanQrPayment(ctx, pkgKey, ffUid, pkg) {
    try { await ctx.sendChatAction("upload_photo"); } catch { }
    const user = ctx.from;
    const gw = getGateway();

    const order = createOrder({
        userId: user.id,
        username: user.username ? `@${user.username}` : "No username",
        firstName: user.first_name || "Customer",
        ffUid: ffUid,
        pkgKey: pkgKey,
        pkgLabel: pkg.label,
        amount: pkg.price,
        purpose: "unban"
    });

    const upiId = gw.paytm.upi_id || "rajcoderff@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE UNBAN SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, pkg.price, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  💳 <b>ᴘᴀʏᴛᴍ sᴇᴄᴜʀᴇ ᴘᴀʏᴍᴇɴᴛ</b>
━━━━━━━━━━━━━━━━━━━━━━━

💰 <b>ᴀᴍᴏᴜɴᴛ ᴘᴀʏᴀʙʟᴇ:</b> <b>₹${pkg.price}</b>
🆔 <b>Free Fire UID:</b> <code>${ffUid}</code>
🛡️ <b>ʙᴀɴ ᴄᴀᴛᴇɢᴏʀʏ:</b> <b>${pkg.label}</b>
🔐 <b>Order Reference:</b> <code>${order.id}</code>
💳 <b>Payee UPI VPA:</b> <code>${upiId}</code>
⏱️ <b>Validity:</b> 15 Minutes

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>ᴘᴀʏᴍᴇɴᴛ ɪɴsᴛʀᴜᴄᴛɪᴏɴs:</b>
1️⃣ sᴄᴀɴ ᴛʜᴇ ǫʀ ᴄᴏᴅᴇ ᴜsɪɴɢ <b>ᴘᴀʏᴛᴍ, ɢᴏᴏɢʟᴇ ᴘᴀʏ, ᴘʜᴏɴᴇᴘᴇ</b> ᴏʀ ᴀɴʏ ᴜᴘɪ ᴀᴘᴘ.
2️⃣ ᴘᴀʏ <b>ᴇxᴀᴄᴛʟʏ ₹${pkg.price}</b>.
3️⃣ ᴅᴏ ɴᴏᴛ ᴄʜᴀɴɢᴇ ʀᴇᴍᴀʀᴋs ᴏʀ ɴᴏᴛᴇ.
4️⃣ ᴀғᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ, ᴛᴀᴘ <b>[🔄 ᴠᴇʀɪғʏ ᴘᴀʏᴍᴇɴᴛ]</b> ʙᴇʟᴏᴡ.

⚡ <b>Automated Verification:</b>
ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss ᴡɪʟʟ sᴛᴀʀᴛ ɪᴍᴍᴇᴅɪᴀᴛᴇʟʏ ᴀғᴛᴇʀ ᴘᴀʏᴍᴇɴᴛ!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 ᴠᴇʀɪғʏ ᴘᴀʏᴍᴇɴᴛ", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ ᴏʀᴅᴇʀ", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── Manual Payment Verification Button ──────────────────────────────────────
bot.action(/^check_pay_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = getOrder(orderId);

    if (!order) {
        return ctx.answerCbQuery("❌ ᴏʀᴅᴇʀ ɴᴏᴛ ғᴏᴜɴᴅ!", { show_alert: true });
    }

    if (order.status === "PAID") {
        return ctx.answerCbQuery("✅ ᴛʜɪs ᴘᴀʏᴍᴇɴᴛ ɪs ᴀʟʀᴇᴀᴅʏ ᴠᴇʀɪғɪᴇᴅ!", { show_alert: true });
    }

    await ctx.answerCbQuery("🔍 ᴄʜᴇᴄᴋɪɴɢ ᴘᴀʏᴍᴇɴᴛ sᴛᴀᴛᴜs ғʀᴏᴍ ᴘᴀʏᴛᴍ...");

    const gw = getGateway();
    if (gw.paytm.mid && gw.paytm.merchant_key) {
        const result = await verifyPaytmStatus(gw.paytm.mid, gw.paytm.merchant_key, orderId);
        if (result.success) {
            await handleSuccessfulPayment(ctx.telegram, order, result.txnId);
            return ctx.reply(`🎉 <b>Payment Verified Successfully!</b>\n\n🆔 Order ID: <code>${orderId}</code>\n💰 Amount: <b>₹${order.amount}</b>\n\n✅ ʏᴏᴜʀ ʀᴇǫᴜᴇsᴛ ɪs ʙᴇɪɴɢ ᴘʀᴏᴄᴇssᴇᴅ!`, {
                parse_mode: "HTML"
            });
        } else if (result.pending) {
            return ctx.reply(`⏳ <b>ᴘᴀʏᴍᴇɴᴛ ɪs sᴛɪʟʟ ᴘᴇɴᴅɪɴɢ!</b>\n\nɪғ ʏᴏᴜ ʜᴀᴠᴇ ᴘᴀɪᴅ, ʙᴀɴᴋ sᴇᴛᴛʟᴇᴍᴇɴᴛ ᴍᴀʏ ᴛᴀᴋᴇ 10-30 sᴇᴄᴏɴᴅs.\nᴘʟᴇᴀsᴇ ᴛᴀᴘ <b>[🔄 ᴠᴇʀɪғʏ ᴘᴀʏᴍᴇɴᴛ]</b> ᴀɢᴀɪɴ ᴀғᴛᴇʀ 15 sᴇᴄᴏɴᴅs.`, {
                parse_mode: "HTML"
            });
        } else {
            return ctx.reply(`⚠️ <b>ᴘᴀʏᴍᴇɴᴛ ɴᴏᴛ ᴄᴏɴғɪʀᴍᴇᴅ!</b>\n\nsᴛᴀᴛᴜs: <code>${result.status || "NOT_RECEIVED"}</code>\nɪғ ᴍᴏɴᴇʏ ᴡᴀs ᴅᴇᴅᴜᴄᴛᴇᴅ, ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ ᴏʀ ᴄᴏɴᴛᴀᴄᴛ ᴀᴅᴍɪɴ.`, {
                parse_mode: "HTML"
            });
        }
    } else {
        return ctx.reply(`⏳ <b>ᴘᴀʏᴍᴇɴᴛ ᴠᴇʀɪғɪᴄᴀᴛɪᴏɴ ɪɴ ᴘʀᴏɢʀᴇss...</b>\n\n🆔 ᴏʀᴅᴇʀ: <code>${orderId}</code>\n💰 ᴀᴍᴏᴜɴᴛ: <b>₹${order.amount}</b>\n\nʏᴏᴜʀ ᴏʀᴅᴇʀ ᴡɪʟʟ ʙᴇ ᴜᴘᴅᴀᴛᴇᴅ ᴜᴘᴏɴ ᴄᴏɴғɪʀᴍᴀᴛɪᴏɴ.`, {
            parse_mode: "HTML"
        });
    }
});

// ─── Cancel Order Callback ───────────────────────────────────────────────────
bot.action(/^cancel_pay_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    updateOrderStatus(orderId, "CANCELLED");
    await ctx.answerCbQuery("Order Cancelled");
    try { await ctx.deleteMessage(); } catch { }
    await ctx.reply(`❌ <b>ᴏʀᴅᴇʀ #${orderId} ᴄᴀɴᴄᴇʟʟᴇᴅ.</b>`, {
        parse_mode: "HTML"
    });
});

// ─── Handle Successful Payment & Notify Admin ────────────────────────────────
async function handleSuccessfulPayment(telegram, order, txnId = "") {
    if (order.status === "PAID") return; // Already processed

    const updatedOrder = updateOrderStatus(order.id, "PAID", { txn_id: txnId });
    const settings = getSettings();
    const adminIds = settings.admin_ids || [7994736557];

    if (order.purpose === "wallet") {
        // ─── Wallet Top-up Flow ──────────────────────────────────────────────
        const newBal = addBalance(order.user_id, order.amount);

        // 1. Notify Customer
        try {
            const supportLink = settings.support_link || "https://t.me/RajCoderFf";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>ᴡᴀʟʟᴇᴛ ᴛᴏᴘ-ᴜᴘ sᴜᴄᴄᴇssғᴜʟ!</b>
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>ᴍᴏɴᴇʏ ʜᴀs ʙᴇᴇɴ sᴜᴄᴄᴇssғᴜʟʟʏ ᴄʀᴇᴅɪᴛᴇᴅ ᴛᴏ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ!</b>

💰 <b>Amount Credited:</b> <b>₹${order.amount}</b>
💼 <b>Updated Wallet Balance:</b> <b>₹${newBal.toFixed(2)}</b>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
⏱️ <b>Date & Time:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚡ <i>ʏᴏᴜ ᴄᴀɴ ɴᴏᴡ ᴜsᴇ ᴛʜɪs ʙᴀʟᴀɴᴄᴇ ᴛᴏ ɪɴsᴛᴀɴᴛʟʏ ᴜɴʙᴀɴ ᴀɴʏ ғʀᴇᴇ ғɪʀᴇ ɪᴅ!</i>

💬 <b>ɪғ ʏᴏᴜ ɴᴇᴇᴅ ᴀssɪsᴛᴀɴᴄᴇ, ᴛᴀᴘ sᴜᴘᴘᴏʀᴛ ʙᴇʟᴏᴡ:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ", supportLink)]
                ]).reply_markup
            });
        } catch (err) { }

        // 2. Alert Admin
        for (const adminId of adminIds) {
            try {
                const adminAlert = `
━━━━━━━━━━━━━━━━━━━━━━━
  🚨 <b>WALLET TOP-UP PAYMENT RECEIVED</b>
━━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Customer:</b> ${order.first_name} (${order.username})
🆔 <b>Telegram Chat ID:</b> <code>${order.user_id}</code>

💰 <b>Amount Credited:</b> <b>₹${order.amount}</b>
💼 <b>New Wallet Balance:</b> <b>₹${newBal.toFixed(2)}</b>
💳 <b>Gateway:</b> <code>PAYTM</code>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
${txnId ? `🔖 <b>Txn ID:</b> <code>${txnId}</code>\n` : ""}⏱️ <b>Payment Time:</b> <code>${updatedOrder?.paid_formatted}</code>
━━━━━━━━━━━━━━━━━━━━━━━
`;
                await telegram.sendMessage(adminId, adminAlert, { parse_mode: "HTML" });
            } catch (adminErr) { }
        }

        } else if (order.purpose === "like") {
        // ─── Free Fire Like Flow ─────────────────────────────────────────────
        // 1. Notify Customer
        try {
            const supportLink = settings.support_link || "https://t.me/RajCoderFf";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>ʟɪᴋᴇ ᴏʀᴅᴇʀ ᴀᴄᴛɪᴠᴀᴛᴇᴅ!</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>ʏᴏᴜʀ ᴘᴀʏᴍᴇɴᴛ ʜᴀꜱ ʙᴇᴇɴ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ ᴠᴇʀɪꜰɪᴇᴅ!</b>

🆔 <b>ꜰʀᴇᴇ ꜰɪʀᴇ ᴜɪᴅ:</b> <code>${order.ff_uid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${order.package_label}</b>
📅 <b>ᴅᴜʀᴀᴛɪᴏɴ:</b> <b>${order.days || 1} ᴅᴀʏꜱ</b>
👍 <b>ᴛᴏᴛᴀʟ ʟɪᴋᴇꜱ:</b> <b>${order.likes || "220+"}</b>
💰 <b>ᴀᴍᴏᴜɴᴛ ᴘᴀɪᴅ:</b> <b>₹${order.amount}</b>
🧾 <b>ᴏʀᴅᴇʀ ʀᴇꜰ:</b> <code>${order.id}</code>
⏱️ <b>ᴅᴀᴛᴇ & ᴛɪᴍᴇ:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>ꜱᴛᴀᴛᴜꜱ:</b> ʏᴏᴜʀ ᴜɪᴅ ʜᴀꜱ ʙᴇᴇɴ ᴀᴅᴅᴇᴅ ᴛᴏ ᴛʜᴇ ʟɪᴋᴇ ꜱᴇʀᴠᴇʀ! ʟɪᴋᴇꜱ ᴡɪʟʟ ʙᴇ ꜱᴇɴᴛ ᴅᴀɪʟʏ ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ!
━━━━━━━━━━━━━━━━━━━━━━━

💬 <b>ɪꜰ ʏᴏᴜ ꜰᴀᴄᴇ ᴀɴʏ ɪꜱꜱᴜᴇꜱ, ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ ʙᴇʟᴏᴡ:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ", supportLink)]
                ]).reply_markup
            });
        } catch (err) { }

        // 2. Alert Admin
        for (const adminId of adminIds) {
            try {
                const adminAlert = `
━━━━━━━━━━━━━━━━━━━━━━━
  🚨 <b>NEW LIKE ORDER PAYMENT RECEIVED</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Customer:</b> ${order.first_name} (${order.username})
🆔 <b>Telegram Chat ID:</b> <code>${order.user_id}</code>

🎮 <b>Free Fire UID:</b> <code>${order.ff_uid}</code>
⚡ <b>Like Plan:</b> <b>${order.package_label}</b>
📅 <b>Duration:</b> <b>${order.days || 1} Day(s)</b>
👍 <b>Likes Target:</b> <b>${order.likes || "220+"}</b>
💰 <b>Amount Received:</b> <b>₹${order.amount}</b>
💳 <b>Method:</b> <code>${txnId === "WALLET_BALANCE" ? "WALLET BALANCE" : "PAYTM UPI"}</code>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
${txnId && txnId !== "WALLET_BALANCE" ? `🔖 <b>Txn ID:</b> <code>${txnId}</code>\n` : ""}⏱️ <b>Payment Time:</b> <code>${updatedOrder?.paid_formatted}</code>
━━━━━━━━━━━━━━━━━━━━━━━
`;
                await telegram.sendMessage(adminId, adminAlert, { parse_mode: "HTML" });
            } catch (adminErr) { }
        }

    } else if (order.purpose === "glory") {
        // ─── Guild Glory Flow ────────────────────────────────────────────────
        // 1. Notify Customer
        try {
            const supportLink = settings.support_link || "https://t.me/RajCoderFf";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>ɢᴜɪʟᴅ ɢʟᴏʀʏ ᴏʀᴅᴇʀ ᴀᴄᴛɪᴠᴀᴛᴇᴅ!</b> 🛡️⚡
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>ʏᴏᴜʀ ᴘᴀʏᴍᴇɴᴛ ʜᴀꜱ ʙᴇᴇɴ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ ᴠᴇʀɪꜰɪᴇᴅ!</b>

🏰 <b>ɢᴜɪʟᴅ ᴜɪᴅ:</b> <code>${order.ff_uid}</code>
⚡ <b>ᴘʟᴀɴ:</b> <b>${order.package_label}</b>
🤖 <b>ʙᴏᴛꜱ ᴀꜱꜱɪɢɴᴇᴅ:</b> <b>${order.bots || 1} ʙᴏᴛ(ꜱ)</b>
📈 <b>ɢʟᴏʀʏ ᴛᴀʀɢᴇᴛ:</b> <b>${order.glory || "2400"} ɢʟᴏʀʏ</b>
💰 <b>ᴀᴍᴏᴜɴᴛ ᴘᴀɪᴅ:</b> <b>₹${order.amount}</b>
🧾 <b>ᴏʀᴅᴇʀ ʀᴇꜰ:</b> <code>${order.id}</code>
⏱️ <b>ᴅᴀᴛᴇ & ᴛɪᴍᴇ:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>ꜱᴛᴀᴛᴜꜱ:</b> ʏᴏᴜʀ ɢᴜɪʟᴅ ʜᴀꜱ ʙᴇᴇɴ ᴀᴅᴅᴇᴅ ᴛᴏ ᴛʜᴇ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ ꜱʏꜱᴛᴇᴍ! ʙᴏᴛꜱ ᴡɪʟʟ ꜱᴛᴀʀᴛ ᴘᴜꜱʜɪɴɢ ɢʟᴏʀʏ!
━━━━━━━━━━━━━━━━━━━━━━━

💬 <b>ɪꜰ ʏᴏᴜ ꜰᴀᴄᴇ ᴀɴʏ ɪꜱꜱᴜᴇꜱ, ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ ʙᴇʟᴏᴡ:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 ᴄᴏɴᴛᴀᴄᴛ ꜱᴜᴘᴘᴏʀᴛ", supportLink)]
                ]).reply_markup
            });
        } catch (err) { }

        // 2. Alert Admin
        for (const adminId of adminIds) {
            try {
                const adminAlert = `
━━━━━━━━━━━━━━━━━━━━━━━
  🚨 <b>NEW GUILD GLORY ORDER RECEIVED</b> 🛡️⚡
━━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Customer:</b> ${order.first_name} (${order.username})
🆔 <b>Telegram Chat ID:</b> <code>${order.user_id}</code>

🏰 <b>Guild UID:</b> <code>${order.ff_uid}</code>
⚡ <b>Glory Plan:</b> <b>${order.package_label}</b>
🤖 <b>Bots Count:</b> <b>${order.bots || 1} Bot(s)</b>
📈 <b>Glory Target:</b> <b>${order.glory || "2400"} Glory</b>
💰 <b>Amount Received:</b> <b>₹${order.amount}</b>
💳 <b>Method:</b> <code>${txnId === "WALLET_BALANCE" ? "WALLET BALANCE" : "PAYTM UPI"}</code>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
${txnId && txnId !== "WALLET_BALANCE" ? `🔖 <b>Txn ID:</b> <code>${txnId}</code>\n` : ""}⏱️ <b>Payment Time:</b> <code>${updatedOrder?.paid_formatted}</code>
━━━━━━━━━━━━━━━━━━━━━━━
`;
                await telegram.sendMessage(adminId, adminAlert, { parse_mode: "HTML" });
            } catch (adminErr) { }
        }

} else {
        // ─── FF ID Unban Flow ────────────────────────────────────────────────
        // 1. Notify Customer
        try {
            const supportLink = settings.support_link || "https://t.me/RajCoderFf";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>ᴘᴀʏᴍᴇɴᴛ ᴄᴏɴғɪʀᴍᴇᴅ & ᴠᴇʀɪғɪᴇᴅ!</b>
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>ʏᴏᴜʀ ᴘᴀʏᴍᴇɴᴛ ʜᴀs ʙᴇᴇɴ sᴜᴄᴄᴇssғᴜʟʟʏ ʀᴇᴄᴇɪᴠᴇᴅ!</b>

🆔 <b>Free Fire UID:</b> <code>${order.ff_uid}</code>
🛡️ <b>Package:</b> <b>${order.package_label}</b>
💰 <b>Amount Paid:</b> <b>₹${order.amount}</b>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
⏱️ <b>Date & Time:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>ᴄʀɪᴛɪᴄᴀʟ ɴᴏᴛɪᴄᴇ:</b>
📌 ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss ʜᴀs ʙᴇᴇɴ sᴛᴀʀᴛᴇᴅ ɪɴ ʙᴀᴄᴋᴇɴᴅ.
🚫 <b>ᴅᴏ ɴᴏᴛ ʟᴏɢɪɴ ᴛᴏ ʏᴏᴜʀ ғʀᴇᴇ ғɪʀᴇ ɪᴅ ғᴏʀ ᴛʜᴇ ɴᴇxᴛ 30 ᴛᴏ 40 ᴍɪɴᴜᴛᴇs!</b>
❌ ɪғ ʏᴏᴜ ʟᴏɢɪɴ ɪɴ ʙᴇᴛᴡᴇᴇɴ, ᴛʜᴇ ᴜɴʙᴀɴ ᴘʀᴏᴄᴇss ᴡɪʟʟ ғᴀɪʟ.
━━━━━━━━━━━━━━━━━━━━━━━

💬 <b>ɪғ ʏᴏᴜ ғᴀᴄᴇ ᴀɴʏ ɪssᴜᴇs, ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ ʙᴇʟᴏᴡ:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ", supportLink)]
                ]).reply_markup
            });
        } catch (err) { }

        // 2. Alert Admin
        for (const adminId of adminIds) {
            try {
                const adminAlert = `
━━━━━━━━━━━━━━━━━━━━━━━
  🚨 <b>PAYMENT RECEIVED NOTIFICATION</b>
━━━━━━━━━━━━━━━━━━━━━━━

👤 <b>Customer:</b> ${order.first_name} (${order.username})
🆔 <b>Telegram Chat ID:</b> <code>${order.user_id}</code>

🎮 <b>Free Fire UID:</b> <code>${order.ff_uid}</code>
🛡️ <b>Ban Category:</b> <b>${order.package_label}</b>
💰 <b>Amount Received:</b> <b>₹${order.amount}</b>
💳 <b>Method:</b> <code>${txnId === "WALLET_BALANCE" ? "WALLET BALANCE" : "PAYTM UPI"}</code>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
${txnId && txnId !== "WALLET_BALANCE" ? `🔖 <b>Txn ID:</b> <code>${txnId}</code>\n` : ""}⏱️ <b>Payment Time:</b> <code>${updatedOrder?.paid_formatted}</code>
━━━━━━━━━━━━━━━━━━━━━━━
`;
                await telegram.sendMessage(adminId, adminAlert, { parse_mode: "HTML" });
            } catch (adminErr) { }
        }
    }
}

// ─── Automated Background Payment Verifier ───────────────────────────────────
setInterval(async () => {
    try {
        const gw = getGateway();
        if (!gw.paytm.enabled || !gw.paytm.auto_verify || !gw.paytm.mid || !gw.paytm.merchant_key) {
            return;
        }

        const pending = getPendingOrders();
        for (const order of pending) {
            try {
                const res = await verifyPaytmStatus(gw.paytm.mid, gw.paytm.merchant_key, order.id);
                if (res.success) {
                    console.log(`[Auto-Verifier] Order ${order.id} verified automatically!`);
                    await handleSuccessfulPayment(bot.telegram, order, res.txnId);
                }
            } catch (vErr) { }
            await new Promise((r) => setTimeout(r, 400));
        }
    } catch (loopErr) { }
}, 12000); // Check every 12 seconds

// ─── Helper: Execute Full Info Query (With Clean Loading Indicator) ──────────
async function executeFullInfoQuery(ctx, uid, region = "IND") {
    if (!/^\d{5,15}$/.test(uid)) {
        return ctx.reply("❌ <b>ɪɴᴠᴀʟɪᴅ ᴜɪᴅ!</b>\nᴜɪᴅ ᴍᴜsᴛ ʙᴇ 5-15 ᴅɪɢɪᴛs ᴏɴʟʏ.\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>2540951574</code>)</i>", {
            parse_mode: "HTML",
        });
    }

    incrementQueries(ctx.from.id);

    try { await ctx.sendChatAction("typing"); } catch { }

    const loadingMsg = await ctx.reply(`⏳ <b>ʟᴏᴀᴅɪɴɢ ᴘʟᴀʏᴇʀ ᴅᴇᴛᴀɪʟs...</b>\n\n🆔 <b>ᴜɪᴅ:</b> <code>${uid}</code>\n🌍 <b>sᴇʀᴠᴇʀ:</b> <code>${region}</code>\n\n🔍 ғᴇᴛᴄʜɪɴɢ ᴘʟᴀʏᴇʀ ᴅᴀᴛᴀ ғʀᴏᴍ sᴇʀᴠᴇʀ, ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ...`, {
        parse_mode: "HTML",
    });

    try {
        const result = await getPlayerInfo(uid, region);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }

        if (!result.success) {
            return ctx.reply(`❌ <b>ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ ɪɴғᴏ</b>\n\n${result.error}`, { parse_mode: "HTML" });
        }

        const formatted = formatFullInfo(result.data, uid, region);

        // Send banner photo first if available
        if (formatted.bannerUrl) {
            try {
                await ctx.replyWithPhoto(formatted.bannerUrl);
            } catch (imgErr) { }
        }

        // Send full text in one clean message
        await ctx.reply(formatted.text, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("🔍 ᴄʜᴇᴄᴋ ᴀɴᴏᴛʜᴇʀ ᴜɪᴅ", "prompt_info")]
            ]).reply_markup
        });

    } catch (err) {
        console.error("Info query error:", err.message);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }
        ctx.reply("⚠️ ᴇʀʀᴏʀ ғᴇᴛᴄʜɪɴɢ ᴘʟᴀʏᴇʀ ᴅᴇᴛᴀɪʟs. ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.");
    }
}

// ─── Helper: Execute Unban Verification Query (With Clean Loading Indicator) ─
async function executeUnbanQuery(ctx, uid, region = "IND") {
    if (!/^\d{5,15}$/.test(uid)) {
        return ctx.reply("❌ <b>ɪɴᴠᴀʟɪᴅ ᴜɪᴅ!</b>\nᴜɪᴅ ᴍᴜsᴛ ʙᴇ 5-15 ᴅɪɢɪᴛs ᴏɴʟʏ.\n\n<i>(ᴇxᴀᴍᴘʟᴇ: <code>2540951574</code>)</i>", {
            parse_mode: "HTML",
        });
    }

    incrementQueries(ctx.from.id);

    try { await ctx.sendChatAction("typing"); } catch { }

    const loadingMsg = await ctx.reply(`⏳ <b>ʟᴏᴀᴅɪɴɢ ʙᴀɴ sᴛᴀᴛᴜs...</b>\n\n🆔 <b>ᴜɪᴅ:</b> <code>${uid}</code>\n🔍 ғᴇᴛᴄʜɪɴɢ ᴘʟᴀʏᴇʀ ᴅᴀᴛᴀ ғʀᴏᴍ sᴇʀᴠᴇʀ, ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ...`, {
        parse_mode: "HTML",
    });

    try {
        const result = await getPlayerInfo(uid, region);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }

        if (!result.success) {
            return ctx.reply(`❌ <b>ᴘʟᴀʏᴇʀ ɴᴏᴛ ғᴏᴜɴᴅ</b>\n\n${result.error}`, { parse_mode: "HTML" });
        }

        const preview = formatUnbanPreview(result.data, uid, region);

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("YES", `unban_yes_${uid}`)]
        ]);

        if (preview.bannerUrl) {
            try {
                await ctx.replyWithPhoto(preview.bannerUrl);
            } catch (e) { }
        }

        await ctx.reply(preview.text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        });

    } catch (err) {
        console.error("Unban query error:", err.message);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }
        ctx.reply("⚠️ ᴇʀʀᴏʀ ᴀᴜᴅɪᴛɪɴɢ ʙᴀɴ sᴛᴀᴛᴜs. ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.");
    }
}

async function executeLikeQuery(ctx, uid, region = "IND") {
    incrementQueries(ctx.from.id);
    const loadingMsg = await ctx.reply("🔍 <b>ꜰᴇᴛᴄʜɪɴɢ ᴘʟᴀʏᴇʀ ᴘʀᴏꜰɪʟᴇ...</b> <i>ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ...</i>", {
        parse_mode: "HTML"
    });

    try {
        const result = await getPlayerInfo(uid, region);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }

        if (!result.success) {
            return ctx.reply(`❌ <b>ᴘʟᴀʏᴇʀ ɴᴏᴛ ꜰᴏᴜɴᴅ</b>\n\n${result.error}`, { parse_mode: "HTML" });
        }

        const preview = formatUnbanPreview(result.data, uid, region);

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔥 ɢᴇᴛ ʟɪᴋᴇꜱ ɴᴏᴡ", `like_choose_${uid}`)],
            [Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]
        ]);

        if (preview.bannerUrl) {
            try {
                await ctx.replyWithPhoto(preview.bannerUrl);
            } catch (e) { }
        }

        await ctx.reply(preview.text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        });

    } catch (err) {
        console.error("Like query error:", err.message);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }
        ctx.reply("⚠️ ᴇʀʀᴏʀ ꜰᴇᴛᴄʜɪɴɢ ᴘʟᴀʏᴇʀ. ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.");
    }
}

async function executeGloryQuery(ctx, guildUid) {
    incrementQueries(ctx.from.id);
    const plans = getGloryPlans();

    const msg = `
🏰 <b>ɢᴜɪʟᴅ ᴠᴇʀɪꜰɪᴇᴅ &amp; ʀᴇᴀᴅʏ!</b> 🛡️
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>ɢᴜɪʟᴅ ᴜɪᴅ:</b> <code>${guildUid}</code>

⚡ <b>ꜱᴇʟᴇᴄᴛ ʏᴏᴜʀ ɢʟᴏʀʏ ʙᴏᴏꜱᴛ ᴘᴀᴄᴋᴀɢᴇ:</b>
<i>(ʙᴏᴛꜱ ᴡɪʟʟ ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ᴊᴏɪɴ ᴏʀ ᴘᴜꜱʜ ɢʟᴏʀʏ ᴛᴏ ʏᴏᴜʀ ɢᴜɪʟᴅ!)</i>
━━━━━━━━━━━━━━━━━━━━━━
`;

    const buttonRows = [];
    for (const [key, plan] of Object.entries(plans)) {
        buttonRows.push([
            Markup.button.callback(`🛡️ ${plan.label || `${plan.bots} ʙᴏᴛ — ${plan.glory} ɢʟᴏʀʏ (₹${plan.price})`}`, `glory_pkg_${key}_${guildUid}`)
        ]);
    }
    buttonRows.push([Markup.button.callback("❌ ᴄᴀɴᴄᴇʟ", "cancel_action")]);

    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(buttonRows).reply_markup
    });
}

// ─── Callback for 'Check Another UID' ────────────────────────────────────────
bot.action("prompt_info", async (ctx) => {
    await ctx.answerCbQuery();
    return handleInfoRequest(ctx);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ADMIN CONTROL PANEL & COMMANDS (/admin) ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function renderAdminMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("📢 Channel & Force Join", "adm_channels"),
            Markup.button.callback("💰 Unban Prices", "adm_prices")
        ],
        [
            Markup.button.callback("🔥 Like Plans Setup", "adm_like_plans"),
            Markup.button.callback("🛡️ Guild Glory Setup", "adm_glory_plans")
        ],
        [
            Markup.button.callback("⚡ Paytm Gateway Setup", "adm_paytm"),
            Markup.button.callback("📊 Statistics & Orders", "adm_stats")
        ],
        [
            Markup.button.callback("📢 Broadcast Message", "adm_broadcast"),
            Markup.button.callback("👥 User Directory", "adm_users")
        ],
        [
            Markup.button.callback("❌ Close Panel", "adm_close")
        ]
    ]);
}

bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("⛔ <b>ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ!</b>\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ɪs ᴏɴʟʏ ғᴏʀ ʙᴏᴛ ᴀᴅᴍɪɴ.", {
            parse_mode: "HTML"
        });
    }

    adminStates.delete(ctx.from.id);

    const msg = `
👑 <b>RAJ CODER FF — ADMIN CONTROL PANEL</b>
━━━━━━━━━━━━━━━━━━━━━━━
ᴡᴇʟᴄᴏᴍᴇ ᴀᴅᴍɪɴ! ғʀᴏᴍ ʜᴇʀᴇ ʏᴏᴜ ᴄᴀɴ ᴍᴀɴᴀɢᴇ ʙᴏᴛ ғᴇᴀᴛᴜʀᴇs, ᴄʜᴀɴɴᴇʟs, ᴘʀɪᴄᴇs ᴀɴᴅ ɢᴀᴛᴇᴡᴀʏ:

👇 <b>sᴇʟᴇᴄᴛ ᴀɴ ᴏᴘᴛɪᴏɴ ʙᴇʟᴏᴡ ᴛᴏ ᴍᴀɴᴀɢᴇ:</b>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: renderAdminMenuKeyboard().reply_markup
    });
});

// Admin Menu Main Callback
bot.action("adm_menu", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Denied", { show_alert: true });
    await ctx.answerCbQuery();
    adminStates.delete(ctx.from.id);

    const msg = `
👑 <b>RAJ CODER FF — ADMIN CONTROL PANEL</b>
━━━━━━━━━━━━━━━━━━━━━━━
ᴘʟᴇᴀsᴇ sᴇʟᴇᴄᴛ ᴛʜᴇ sᴇᴄᴛɪᴏɴ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ᴍᴀɴᴀɢᴇ:
`;
    return ctx.editMessageText(msg, {
        parse_mode: "HTML",
        reply_markup: renderAdminMenuKeyboard().reply_markup
    });
});

bot.action("adm_close", async (ctx) => {
    await ctx.answerCbQuery("Closed");
    adminStates.delete(ctx.from.id);
    return ctx.deleteMessage();
});

// ─── 1. Channel & Force Join Management ──────────────────────────────────────
bot.action("adm_channels", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Denied");
    await ctx.answerCbQuery();

    const s = getSettings();
    const msg = `
📢 <b>CHANNEL & SUPPORT SETTINGS</b>
━━━━━━━━━━━━━━━━━━━━━━
🛡️ <b>Force Join Status:</b> <b>${s.force_join_enabled ? "🟢 ON (ACTIVE)" : "🔴 OFF (DISABLED)"}</b>
🏷️ <b>Channel Username:</b> <code>${s.force_channel_username || "Not Set"}</code>
🔗 <b>Channel Link:</b> <code>${s.force_channel_link || "Not Set"}</code>
💬 <b>Support Link:</b> <code>${s.support_link || "https://t.me/RajCoderFf"}</code>
🌐 <b>Ban Server URL:</b> <code>${s.server_login_base_url || "http://109.71.252.111:30008/"}</code>
━━━━━━━━━━━━━━━━━━━━━━
<i>ɴᴏᴛᴇ: ʙᴏᴛ ᴍᴜsᴛ ʙᴇ ᴀɴ ᴀᴅᴍɪɴ ɪɴ ᴛʜᴇ ᴄʜᴀɴɴᴇʟ ғᴏʀ ғᴏʀᴄᴇ ᴊᴏɪɴ ᴛᴏ ᴡᴏʀᴋ.</i>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("✏️ Set Channel Link", "adm_set_link"),
            Markup.button.callback("✏️ Set Username", "adm_set_user")
        ],
        [
            Markup.button.callback("💬 Set Support Link", "adm_set_support"),
            Markup.button.callback("🌐 Set Server URL", "adm_set_server_url")
        ],
        [
            Markup.button.callback(s.force_join_enabled ? "🔴 Turn OFF Force Join" : "🟢 Turn ON Force Join", "adm_toggle_force"),
            Markup.button.callback("🗑️ Clear / Reset Channel", "adm_clear_chan")
        ],
        [
            Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")
        ]
    ]);

    return ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
});

bot.action("adm_set_support", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SET_SUPPORT_LINK" });
    return ctx.reply("💬 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ɴᴇᴡ sᴜᴘᴘᴏʀᴛ ʟɪɴᴋ:</b>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>https://t.me/RajCoderFf</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_channels")]]).reply_markup
    });
});

bot.action("adm_set_server_url", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SET_SERVER_URL" });
    return ctx.reply("🌐 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ɴᴇᴡ sᴇʀᴠᴇʀ ʙᴀsᴇ ᴜʀʟ ғᴏʀ ʙᴀɴ ʟᴏɢɪɴ:</b>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>https://ff-telegram-bot-1t2u.onrender.com/</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_channels")]]).reply_markup
    });
});

bot.action("adm_toggle_force", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const s = getSettings();
    s.force_join_enabled = !s.force_join_enabled;
    saveSettings(s);
    await ctx.answerCbQuery(`Force Join ${s.force_join_enabled ? "Enabled" : "Disabled"}`);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_channels" } });
});

bot.action("adm_set_link", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SET_CHANNEL_LINK" });
    return ctx.reply("🔗 <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ɴᴇᴡ ᴄʜᴀɴɴᴇʟ ʟɪɴᴋ:</b>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>https://t.me/yourchannel</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_channels")]]).reply_markup
    });
});

bot.action("adm_set_user", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SET_CHANNEL_USER" });
    return ctx.reply("🏷️ <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ɴᴇᴡ ᴄʜᴀɴɴᴇʟ ᴜsᴇʀɴᴀᴍᴇ (ᴡɪᴛʜ @):</b>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>@yourchannel</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_channels")]]).reply_markup
    });
});

bot.action("adm_clear_chan", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const s = getSettings();
    s.force_channel_username = "";
    s.force_channel_link = "";
    s.force_join_enabled = false;
    saveSettings(s);
    await ctx.answerCbQuery("Channel settings cleared!");
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_channels" } });
});

// ─── 2. Packages & Pricing Management ────────────────────────────────────────
bot.action("adm_prices", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const prices = getPricing();
    const list = Object.entries(prices)
        .map(([k, v]) => `• <b>${k}</b> (${v.label}): <b>₹${v.price}</b>`)
        .join("\n");

    const msg = `
💰 <b>UNBAN PACKAGES & PRICING</b>
━━━━━━━━━━━━━━━━━━━━━━
${list || "<i>No packages defined</i>"}
━━━━━━━━━━━━━━━━━━━━━━
✏️ <b>ᴄʜᴏᴏsᴇ ᴀ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ ᴛᴏ ᴀᴅᴅ ᴏʀ ᴇᴅɪᴛ ᴘᴀᴄᴋᴀɢᴇs:</b>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("✏️ Change Price", "adm_pick_price_edit"),
            Markup.button.callback("➕ Add Package", "adm_prompt_add_pkg")
        ],
        [
            Markup.button.callback("🗑️ Delete Package", "adm_pick_pkg_del")
        ],
        [
            Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")
        ]
    ]);

    return ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
});

bot.action("adm_pick_price_edit", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const prices = getPricing();
    const rows = [];
    for (const [k, v] of Object.entries(prices)) {
        rows.push([Markup.button.callback(`✏️ ${v.label} (₹${v.price})`, `adm_chgprice_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_prices")]);
    return ctx.editMessageText("✏️ <b>sᴇʟᴇᴄᴛ ᴀ ᴘᴀᴄᴋᴀɢᴇ ᴛᴏ ᴇᴅɪᴛ ᴘʀɪᴄᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_chgprice_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "EDIT_PRICE", key: key });
    return ctx.reply(`💰 sᴇɴᴅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> (ɴᴜᴍʙᴇʀs ᴏɴʟʏ):\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>199</code>`, {
        parse_mode: "HTML"
    });
});

bot.action("adm_prompt_add_pkg", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "ADD_PACKAGE" });
    const msg = `
➕ <b>ADD NEW UNBAN PACKAGE</b>
━━━━━━━━━━━━━━━━━━━━━━
ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴘᴀᴄᴋᴀɢᴇ ɪɴғᴏʀᴍᴀᴛɪᴏɴ ɪɴ ᴛʜᴇ ғᴏʟʟᴏᴡɪɴɢ ғᴏʀᴍᴀᴛ:

<code>KEY | LABEL | PRICE</code>

*Example:*
<code>1day | 1 Day Ban | 49</code>
<code>15day | 15 Day Ban | 349</code>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_prices")]]).reply_markup
    });
});

bot.action("adm_pick_pkg_del", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const prices = getPricing();
    const rows = [];
    for (const [k, v] of Object.entries(prices)) {
        rows.push([Markup.button.callback(`🗑️ ${v.label}`, `adm_dopkgdel_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_prices")]);
    return ctx.editMessageText("🗑️ <b>sᴇʟᴇᴄᴛ ᴀ ᴘᴀᴄᴋᴀɢᴇ ᴛᴏ ᴅᴇʟᴇᴛᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_dopkgdel_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    deletePackage(key);
    await ctx.answerCbQuery(`Package ${key} deleted!`, { show_alert: true });
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_prices" } });
});

// ─── 2.5 Like Plans Management (/admin) ──────────────────────────────────────
bot.action("adm_like_plans", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const plans = getLikePlans();
    const list = Object.entries(plans)
        .map(([k, v]) => `• <b>${k}</b>: ${v.days} Day(s) | ${v.likes} Likes | <b>₹${v.price}</b>`)
        .join("\n");

    const msg = `
🔥 <b>FREE FIRE LIKE PLANS CONFIGURATION</b>
━━━━━━━━━━━━━━━━━━━━━━
${list || "<i>No like plans defined</i>"}
━━━━━━━━━━━━━━━━━━━━━━
✏️ <b>ᴄʜᴏᴏsᴇ ᴀ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ ᴛᴏ ᴍᴀɴᴀɢᴇ ᴘʟᴀɴs:</b>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("✏️ Edit Price", "adm_like_edit_price"),
            Markup.button.callback("➕ Add Plan", "adm_like_prompt_add")
        ],
        [
            Markup.button.callback("🗑️ Delete Plan", "adm_like_pick_del")
        ],
        [
            Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")
        ]
    ]);

    return ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
});

bot.action("adm_like_edit_price", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const plans = getLikePlans();
    const rows = [];
    for (const [k, v] of Object.entries(plans)) {
        rows.push([Markup.button.callback(`✏️ ${v.label}`, `adm_likechgprice_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_like_plans")]);
    return ctx.editMessageText("✏️ <b>sᴇʟᴇᴄᴛ ᴀ ʟɪᴋᴇ ᴘʟᴀɴ ᴛᴏ ᴇᴅɪᴛ ᴘʀɪᴄᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_likechgprice_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "EDIT_LIKE_PRICE", key: key });
    return ctx.reply(`💰 sᴇɴᴅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> (ɴᴜᴍʙᴇʀs ᴏɴʟʏ):\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>35</code>`, {
        parse_mode: "HTML"
    });
});

bot.action("adm_like_prompt_add", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "ADD_LIKE_PLAN" });
    const msg = `
➕ <b>ADD NEW LIKE PLAN</b>
━━━━━━━━━━━━━━━━━━━━━━
ᴘʟᴇᴀsᴇ sᴇɴᴅ ʟɪᴋᴇ ᴘʟᴀɴ ɪɴғᴏʀᴍᴀᴛɪᴏɴ ɪɴ ᴛʜᴇ ғᴏʟʟᴏᴡɪɴɢ ғᴏʀᴍᴀᴛ:

<code>KEY | DAYS | LIKES | PRICE</code>

*Examples:*
<code>1day | 1 | 220+ | 25</code>
<code>5day | 5 | 1100+ | 100</code>
<code>30day | 30 | 6600+ | 450</code>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_like_plans")]]).reply_markup
    });
});

bot.action("adm_like_pick_del", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const plans = getLikePlans();
    const rows = [];
    for (const [k, v] of Object.entries(plans)) {
        rows.push([Markup.button.callback(`🗑️ ${v.label}`, `adm_dolikedel_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_like_plans")]);
    return ctx.editMessageText("🗑️ <b>sᴇʟᴇᴄᴛ ᴀ ʟɪᴋᴇ ᴘʟᴀɴ ᴛᴏ ᴅᴇʟᴇᴛᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_dolikedel_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    deleteLikePlan(key);
    await ctx.answerCbQuery(`Like Plan ${key} deleted!`, { show_alert: true });
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_like_plans" } });
});

// ─── 2.6 Guild Glory Plans Management (/admin) ───────────────────────────────
bot.action("adm_glory_plans", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const plans = getGloryPlans();
    const list = Object.entries(plans)
        .map(([k, v]) => `• <b>${k}</b>: ${v.bots} Bot(s) | ${v.glory} Glory | <b>₹${v.price}</b>`)
        .join("\n");

    const msg = `
🛡️ <b>GUILD GLORY PLANS CONFIGURATION</b>
━━━━━━━━━━━━━━━━━━━━━━
${list || "<i>No glory plans defined</i>"}
━━━━━━━━━━━━━━━━━━━━━━
✏️ <b>ᴄʜᴏᴏsᴇ ᴀ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ ᴛᴏ ᴍᴀɴᴀɢᴇ ᴘʟᴀɴs:</b>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("✏️ Edit Price", "adm_glory_edit_price"),
            Markup.button.callback("➕ Add Plan", "adm_glory_prompt_add")
        ],
        [
            Markup.button.callback("🗑️ Delete Plan", "adm_glory_pick_del")
        ],
        [
            Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")
        ]
    ]);

    return ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
});

bot.action("adm_glory_edit_price", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const plans = getGloryPlans();
    const rows = [];
    for (const [k, v] of Object.entries(plans)) {
        rows.push([Markup.button.callback(`✏️ ${v.label}`, `adm_glorychgprice_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_glory_plans")]);
    return ctx.editMessageText("✏️ <b>sᴇʟᴇᴄᴛ ᴀ ɢʟᴏʀʏ ᴘʟᴀɴ ᴛᴏ ᴇᴅɪᴛ ᴘʀɪᴄᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_glorychgprice_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "EDIT_GLORY_PRICE", key: key });
    return ctx.reply(`💰 sᴇɴᴅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> (ɴᴜᴍʙᴇʀs ᴏɴʟʏ):\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>300</code>`, {
        parse_mode: "HTML"
    });
});

bot.action("adm_glory_prompt_add", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "ADD_GLORY_PLAN" });
    const msg = `
➕ <b>ADD NEW GUILD GLORY PLAN</b>
━━━━━━━━━━━━━━━━━━━━━━
ᴘʟᴇᴀsᴇ sᴇɴᴅ ɢʟᴏʀʏ ᴘʟᴀɴ ɪɴғᴏʀᴍᴀᴛɪᴏɴ ɪɴ ᴛʜᴇ ғᴏʟʟᴏᴡɪɴɢ ғᴏʀᴍᴀᴛ:

<code>KEY | BOTS | GLORY | PRICE</code>

*Examples:*
<code>1bot | 1 | 2400 | 250</code>
<code>3bot | 3 | 7200 | 650</code>
<code>10bot | 10 | 24000 | 2000</code>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_glory_plans")]]).reply_markup
    });
});

bot.action("adm_glory_pick_del", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const plans = getGloryPlans();
    const rows = [];
    for (const [k, v] of Object.entries(plans)) {
        rows.push([Markup.button.callback(`🗑️ ${v.label}`, `adm_doglorydel_${k}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", "adm_glory_plans")]);
    return ctx.editMessageText("🗑️ <b>sᴇʟᴇᴄᴛ ᴀ ɢʟᴏʀʏ ᴘʟᴀɴ ᴛᴏ ᴅᴇʟᴇᴛᴇ:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_doglorydel_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    deleteGloryPlan(key);
    await ctx.answerCbQuery(`Glory Plan ${key} deleted!`, { show_alert: true });
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_glory_plans" } });
});

// ─── 3. Paytm Gateway Management ─────────────────────────────────────────────
bot.action("adm_paytm", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const gw = getGateway();
    const p = gw.paytm;
    const midMasked = p.mid ? p.mid.slice(0, 4) + "••••••••" : "Not Set";
    const keyMasked = p.merchant_key ? "••••••••••••" : "Not Set";

    const msg = `
⚡ <b>PAYTM GATEWAY CONFIGURATION</b>
━━━━━━━━━━━━━━━━━━━━━━
🟢 <b>Gateway Status:</b> <b>${p.enabled ? "ACTIVE" : "DISABLED"}</b>
🤖 <b>Auto-Verification:</b> <b>${p.auto_verify ? "🟢 ON (AUTO)" : "⚪ OFF (MANUAL)"}</b>

🆔 <b>Paytm MID:</b> <code>${midMasked}</code>
🔑 <b>Merchant Key:</b> <code>${keyMasked}</code>
💳 <b>Paytm UPI ID:</b> <code>${p.upi_id || "Not Set"}</code>
🏷️ <b>Merchant Name:</b> <code>${p.merchant_name || "FREE FIRE UNBAN SERVICES"}</code>
━━━━━━━━━━━━━━━━━━━━━━
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("⚡ Configure Paytm Details", "adm_setup_paytm_prompt")
        ],
        [
            Markup.button.callback(p.auto_verify ? "⚪ Disable Auto-Verify" : "🟢 Enable Auto-Verify", "adm_toggle_autoverify"),
            Markup.button.callback(p.enabled ? "🔴 Disable Gateway" : "🟢 Enable Gateway", "adm_toggle_gw")
        ],
        [
            Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")
        ]
    ]);

    return ctx.editMessageText(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
});

bot.action("adm_toggle_autoverify", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const gw = getGateway();
    gw.paytm.auto_verify = !gw.paytm.auto_verify;
    saveGateway(gw);
    await ctx.answerCbQuery(`Auto-Verify: ${gw.paytm.auto_verify ? "ON" : "OFF"}`);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_paytm" } });
});

bot.action("adm_toggle_gw", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const gw = getGateway();
    gw.paytm.enabled = !gw.paytm.enabled;
    saveGateway(gw);
    await ctx.answerCbQuery(`Gateway: ${gw.paytm.enabled ? "Enabled" : "Disabled"}`);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callback_query, data: "adm_paytm" } });
});

bot.action("adm_setup_paytm_prompt", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SETUP_PAYTM" });

    const prompt = `
⚡ <b>PAYTM GATEWAY SETUP</b>
━━━━━━━━━━━━━━━━━━━━━━
ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴅᴇᴛᴀɪʟs ʟɪɴᴇ ʙʏ ʟɪɴᴇ ɪɴ ᴛʜᴇ ғᴏʟʟᴏᴡɪɴɢ ғᴏʀᴍᴀᴛ:

<code>Paytm MID: YOUR_MID
Merchant Key: YOUR_KEY
Paytm UPI ID: your@paytm
Merchant Name: Your Store Name</code>

ℹ️ <b>Notes:</b>
• <b>ᴘᴀʏᴛᴍ ᴜᴘɪ ɪᴅ</b> ɪs ᴜsᴇᴅ ᴛᴏ ɢᴇɴᴇʀᴀᴛᴇ ɪɴsᴛᴀɴᴛ ᴜᴘɪ ǫʀ ᴄᴏᴅᴇ.
• <b>ᴘᴀʏᴛᴍ ᴍɪᴅ & ᴋᴇʏ</b> ᴀʀᴇ ᴜsᴇᴅ ғᴏʀ ᴀᴜᴛᴏ-ᴠᴇʀɪғɪᴄᴀᴛɪᴏɴ & ɪɴsᴛᴀɴᴛ sᴛᴀᴛᴜs ᴄʜᴇᴄᴋ.
`;
    return ctx.reply(prompt, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_paytm")]]).reply_markup
    });
});

// ─── 4. Statistics & Orders ──────────────────────────────────────────────────
bot.action("adm_stats", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const users = loadUsers();
    const orders = getAllOrders();
    const totalUsers = Object.keys(users).length;
    let totalQueries = 0;
    for (const u of Object.values(users)) {
        totalQueries += (u.queries_count || 0);
    }

    const orderList = Object.values(orders);
    const paidOrders = orderList.filter((o) => o.status === "PAID");
    const pendingOrders = orderList.filter((o) => o.status === "PENDING");
    const totalRevenue = paidOrders.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const msg = `
📊 <b>BOT LIVE STATISTICS & REVENUE</b>
━━━━━━━━━━━━━━━━━━━━━━
👥 <b>Total Registered Users:</b> <b>${totalUsers}</b>
🔍 <b>Total UID Searches:</b> <b>${totalQueries}</b>

🧾 <b>Total Orders:</b> <b>${orderList.length}</b>
✅ <b>Paid / Verified Orders:</b> <b>${paidOrders.length}</b>
⏳ <b>Pending Orders:</b> <b>${pendingOrders.length}</b>
💰 <b>Total Verified Revenue:</b> <b>₹${totalRevenue.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━
🟢 <b>System Status:</b> Operational & Active
`;
    return ctx.editMessageText(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")]]).reply_markup
    });
});

// ─── 5. Broadcast Message (Non-blocking Backend Process) ─────────────────────
bot.action("adm_broadcast", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "BROADCAST" });

    return ctx.reply("📢 <b>ʙʀᴏᴀᴅᴄᴀsᴛ ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛ</b>\n\nsᴇɴᴅ ᴛʜᴇ ᴍᴇssᴀɢᴇ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ʙʀᴏᴀᴅᴄᴀsᴛ ᴛᴏ ᴀʟʟ ᴜsᴇʀs (ʜᴛᴍʟ sᴜᴘᴘᴏʀᴛᴇᴅ):\n\n*ᴛᴀᴘ ʙᴇʟᴏᴡ ᴛᴏ ᴄᴀɴᴄᴇʟ:*", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_menu")]]).reply_markup
    });
});

// ─── 6. User Directory ───────────────────────────────────────────────────────
bot.action("adm_users", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();

    const users = Object.values(loadUsers()).slice(-20).reverse();
    const lines = users.map((u, i) => `${i + 1}. <code>${u.id}</code> | ${u.first_name || "User"} (${u.username}) | Bal: ₹${(u.balance || 0).toFixed(2)}`);

    const msg = `
👥 <b>ʀᴇᴄᴇɴᴛ ᴜsᴇʀs ᴅɪʀᴇᴄᴛᴏʀʏ</b>
━━━━━━━━━━━━━━━━━━━━━━
${lines.join("\n") || "No users yet."}
━━━━━━━━━━━━━━━━━━━━━━
`;
    return ctx.editMessageText(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back to Admin Menu", "adm_menu")]]).reply_markup
    });
});

// ─── Admin Text Commands (/prices & /setprice) ──────────────────────────────
bot.command("prices", async (ctx) => {
    const prices = getPricing();
    const list = Object.entries(prices)
        .map(([k, v]) => `• <b>${k}</b> (${v.label}): <b>₹${v.price}</b>`)
        .join("\n");

    const msg = `
⚙️ <b>CURRENT UNBAN PRICING LIST:</b>
━━━━━━━━━━━━━━━━━━━━━━
${list}
━━━━━━━━━━━━━━━━━━━━━━
✏️ <b>ʜᴏᴡ ᴛᴏ ᴄʜᴀɴɢᴇ ᴘʀɪᴄᴇ:</b>
<code>/setprice &lt;type&gt; &lt;amount&gt;</code>

<b>ᴇxᴀᴍᴘʟᴇ:</b>
<code>/setprice 3day 99</code>
<code>/setprice 7day 199</code>
<code>/setprice 30day 499</code>
<code>/setprice 90day 899</code>
<code>/setprice permanent 999</code>
<code>/setprice blacklist 249</code>
`;
    return ctx.reply(msg, { parse_mode: "HTML" });
});

bot.command("setprice", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("⛔ ᴏɴʟʏ ᴀᴅᴍɪɴ ᴄᴀɴ ᴄʜᴀɴɢᴇ ᴘʀɪᴄᴇs!");
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) {
        return ctx.reply("❌ <b>ᴜsᴀɢᴇ:</b> <code>/setprice &lt;key&gt; &lt;amount&gt;</code>\n\n*ᴇxᴀᴍᴘʟᴇ:* <code>/setprice 3day 99</code>\n\nᴄʜᴇᴄᴋ ᴀʟʟ ᴋᴇʏs: <code>/prices</code>", {
            parse_mode: "HTML"
        });
    }

    const key = parts[1].toLowerCase();
    const amount = parseInt(parts[2]);

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ ᴀᴍᴏᴜɴᴛ ᴍᴜsᴛ ʙᴇ ᴀ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ!");
    }

    const success = updatePrice(key, amount);
    if (success) {
        return ctx.reply(`✅ <b>ᴘʀɪᴄᴇ ᴜᴘᴅᴀᴛᴇᴅ!</b>\n\nɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b>: <b>₹${amount}</b>`, {
            parse_mode: "HTML"
        });
    } else {
        return ctx.reply(`❌ ɪɴᴠᴀʟɪᴅ ᴋᴇʏ: <code>${key}</code>\n\nᴛʏᴘᴇ <code>/prices</code> ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴋᴇʏs.`, {
            parse_mode: "HTML"
        });
    }
});

// ─── Central Text Handler ────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    const adminState = adminStates.get(ctx.from.id);

    // 1. Process Admin State Inputs
    if (adminState && isAdmin(ctx.from.id)) {
        adminStates.delete(ctx.from.id);

        if (adminState.action === "SET_CHANNEL_LINK") {
            const s = getSettings();
            s.force_channel_link = text;
            s.force_join_enabled = true;
            saveSettings(s);
            return ctx.reply(`✅ <b>ᴄʜᴀɴɴᴇʟ ʟɪɴᴋ ᴜᴘᴅᴀᴛᴇᴅ!</b>\n\n🔗 ${text}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "SET_CHANNEL_USER") {
            const s = getSettings();
            s.force_channel_username = text.startsWith("@") ? text : `@${text}`;
            s.force_join_enabled = true;
            saveSettings(s);
            return ctx.reply(`✅ <b>ᴄʜᴀɴɴᴇʟ ᴜsᴇʀɴᴀᴍᴇ ᴜᴘᴅᴀᴛᴇᴅ!</b>\n\n🏷️ ${s.force_channel_username}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "SET_SUPPORT_LINK") {
            const s = getSettings();
            s.support_link = text;
            saveSettings(s);
            return ctx.reply(`✅ <b>sᴜᴘᴘᴏʀᴛ ʟɪɴᴋ ᴜᴘᴅᴀᴛᴇᴅ!</b>\n\n💬 ${text}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel & Support Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "SET_SERVER_URL") {
            const s = getSettings();
            s.server_login_base_url = text.trim();
            saveSettings(s);
            return ctx.reply(`✅ <b>ʙᴀɴ sᴇʀᴠᴇʀ ʙᴀsᴇ ᴜʀʟ ᴜᴘᴅᴀᴛᴇᴅ!</b>\n\n🌐 <code>${s.server_login_base_url}</code>`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel & Server Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "EDIT_PRICE") {
            const key = adminState.key;
            const amt = parseInt(text);
            if (isNaN(amt) || amt <= 0) {
                return ctx.reply("❌ ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴀ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ!");
            }
            updatePrice(key, amt);
            return ctx.reply(`✅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> sᴇᴛ ᴛᴏ <b>₹${amt}</b>!`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Prices List", "adm_prices")]]).reply_markup
            });
        }

        if (adminState.action === "EDIT_LIKE_PRICE") {
            const key = adminState.key;
            const amt = parseInt(text);
            if (isNaN(amt) || amt <= 0) {
                return ctx.reply("❌ ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴀ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ!");
            }
            updateLikePlanPrice(key, amt);
            return ctx.reply(`✅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> sᴇᴛ ᴛᴏ <b>₹${amt}</b>!`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Like Plans", "adm_like_plans")]]).reply_markup
            });
        }

        if (adminState.action === "ADD_LIKE_PLAN") {
            const parts = text.split("|").map((p) => p.trim());
            if (parts.length < 4) {
                return ctx.reply("❌ ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ! ᴘʟᴇᴀsᴇ sᴇɴᴅ ɪɴ <code>KEY | DAYS | LIKES | PRICE</code> ғᴏʀᴍᴀᴛ.\n\n*Example:* <code>1day | 1 | 220+ | 25</code>", { parse_mode: "HTML" });
            }
            const [k, dys, lks, prc] = parts;
            addLikePlan(k, dys, lks, prc);
            return ctx.reply(`✅ <b>ɴᴇᴡ ʟɪᴋᴇ ᴘʟᴀɴ ᴀᴅᴅᴇᴅ!</b>\n\n🏷️ <b>${k}</b>: ${dys} Days | ${lks} Likes\n💰 <b>₹${prc}</b>`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Like Plans", "adm_like_plans")]]).reply_markup
            });
        }

        if (adminState.action === "EDIT_GLORY_PRICE") {
            const key = adminState.key;
            const amt = parseInt(text);
            if (isNaN(amt) || amt <= 0) {
                return ctx.reply("❌ ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴀ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ!");
            }
            updateGloryPlanPrice(key, amt);
            return ctx.reply(`✅ ɴᴇᴡ ᴘʀɪᴄᴇ ғᴏʀ <b>${key}</b> sᴇᴛ ᴛᴏ <b>₹${amt}</b>!`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Glory Plans", "adm_glory_plans")]]).reply_markup
            });
        }

        if (adminState.action === "ADD_GLORY_PLAN") {
            const parts = text.split("|").map((p) => p.trim());
            if (parts.length < 4) {
                return ctx.reply("❌ ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ! ᴘʟᴇᴀsᴇ sᴇɴᴅ ɪɴ <code>KEY | BOTS | GLORY | PRICE</code> ғᴏʀᴍᴀᴛ.\n\n*Example:* <code>1bot | 1 | 2400 | 250</code>", { parse_mode: "HTML" });
            }
            const [k, bts, gly, prc] = parts;
            addGloryPlan(k, bts, gly, prc);
            return ctx.reply(`✅ <b>ɴᴇᴡ ɢʟᴏʀʏ ᴘʟᴀɴ ᴀᴅᴅᴇᴅ!</b>\n\n🏷️ <b>${k}</b>: ${bts} Bots | ${gly} Glory\n💰 <b>₹${prc}</b>`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Glory Plans", "adm_glory_plans")]]).reply_markup
            });
        }

        if (adminState.action === "ADD_PACKAGE") {
            const parts = text.split("|").map((p) => p.trim());
            if (parts.length < 3) {
                return ctx.reply("❌ ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ! ᴘʟᴇᴀsᴇ sᴇɴᴅ ɪɴ <code>KEY | LABEL | PRICE</code> ғᴏʀᴍᴀᴛ.", { parse_mode: "HTML" });
            }
            const [k, lbl, prc] = parts;
            addPackage(k.toLowerCase(), lbl, prc);
            return ctx.reply(`✅ <b>ɴᴇᴡ ᴘᴀᴄᴋᴀɢᴇ ᴀᴅᴅᴇᴅ!</b>\n\n🏷️ <b>${lbl}</b> (${k})\n💰 <b>₹${prc}</b>`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Prices List", "adm_prices")]]).reply_markup
            });
        }

        if (adminState.action === "SETUP_PAYTM") {
            const lines = text.split("\n");
            const values = {};
            for (const line of lines) {
                if (line.includes(":")) {
                    const [k, v] = line.split(":", 2);
                    values[k.trim().toLowerCase()] = v.trim();
                }
            }

            const gw = getGateway();
            if (values["paytm mid"] || values["mid"]) {
                gw.paytm.mid = values["paytm mid"] || values["mid"];
            }
            if (values["merchant key"] || values["key"]) {
                gw.paytm.merchant_key = values["merchant key"] || values["key"];
            }
            if (values["paytm upi id"] || values["upi id"] || values["upi"]) {
                gw.paytm.upi_id = values["paytm upi id"] || values["upi id"] || values["upi"];
            }
            if (values["merchant name"] || values["name"]) {
                gw.paytm.merchant_name = values["merchant name"] || values["name"];
            }
            gw.paytm.enabled = true;
            saveGateway(gw);

            return ctx.reply(`✅ <b>ᴘᴀʏᴛᴍ ᴄᴏɴғɪɢᴜʀᴀᴛɪᴏɴ sᴀᴠᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ!</b>\n\n🆔 MID: <code>${gw.paytm.mid ? gw.paytm.mid.slice(0, 4) + "****" : "Not Set"}</code>\n💳 UPI ID: <code>${gw.paytm.upi_id}</code>\n🏷️ Name: <b>${gw.paytm.merchant_name}</b>`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Paytm Settings", "adm_paytm")]]).reply_markup
            });
        }

        // Non-blocking Asynchronous Broadcast in Background
        if (adminState.action === "BROADCAST") {
            const users = loadUsers();
            const userIds = Object.keys(users);
            const broadcastText = text;
            const adminChatId = ctx.chat.id;

            // Immediately reply to admin so bot does not freeze or wait
            await ctx.reply(`📢 <b>ʙʀᴏᴀᴅᴄᴀsᴛ sᴛᴀʀᴛᴇᴅ ɪɴ ʙᴀᴄᴋɢʀᴏᴜɴᴅ!</b>\n\n👥 <b>ᴛᴏᴛᴀʟ ᴜsᴇʀs:</b> ${userIds.length}\n⚡ ʙᴏᴛ ᴡɪʟʟ ᴋᴇᴇᴘ ʀᴜɴɴɪɴɢ ɴᴏʀᴍᴀʟʟʏ ᴡɪᴛʜᴏᴜᴛ ɪɴᴛᴇʀʀᴜᴘᴛɪᴏɴ.\nʏᴏᴜ ᴡɪʟʟ ʀᴇᴄᴇɪᴠᴇ ᴀ ғɪɴᴀʟ ʀᴇᴘᴏʀᴛ ᴏɴᴄᴇ ᴄᴏᴍᴘʟᴇᴛᴇᴅ.`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Admin Menu", "adm_menu")]]).reply_markup
            });

            // Run in detached async background queue
            setImmediate(async () => {
                let sent = 0;
                let failed = 0;
                for (const uid of userIds) {
                    try {
                        await bot.telegram.sendMessage(uid, broadcastText, { parse_mode: "HTML" });
                        sent++;
                    } catch (e) {
                        failed++;
                    }
                    await new Promise((r) => setTimeout(r, 50)); // prevent flood limit
                }

                try {
                    await bot.telegram.sendMessage(adminChatId, `✅ <b>ʙʀᴏᴀᴅᴄᴀsᴛ ʀᴇᴘᴏʀᴛ:</b>\n\n📨 sᴇɴᴛ: <b>${sent}</b>\n❌ ғᴀɪʟᴇᴅ/ʙʟᴏᴄᴋᴇᴅ: <b>${failed}</b>\n👥 ᴛᴏᴛᴀʟ ᴜsᴇʀs: <b>${userIds.length}</b>`, {
                        parse_mode: "HTML"
                    });
                } catch (reportErr) {
                    console.error("Broadcast report failed:", reportErr.message);
                }
            });

            return;
        }
    }

    // 0. Cancel command
    if (text.toLowerCase() === "/cancel" || text === "❌ Cancel") {
        userStates.delete(ctx.from.id);
        adminStates.delete(ctx.from.id);
        return ctx.reply("❌ <b>Action Cancelled.</b>", {
            parse_mode: "HTML",
            reply_markup: getMainKeyboard().reply_markup
        });
    }

    // Ignore persistent menu buttons in text router
    if ([
        "BAN LOGIN", "STOP SESSION", "STATUS", "ABOUT THIS BOT",
        "🔓 FF ID Unban", "📊 FF ID Info", "💳 Add Balance", "👤 My Wallet", "👤 Status"
    ].includes(text)) {
        return;
    }

    // 2. Process User Conversation States
    const userState = userStates.get(ctx.from.id);
    if (userState) {
        userStates.delete(ctx.from.id);

        // A. Ban Login Token Submission
        if (userState.mode === "WAITING_BAN_TOKEN") {
            const token = text.trim();
            if (token.length < 10) {
                return ctx.reply("RAJ CODER FF\nBAN LOGIN\n\n❌ <b>INVALID ACCESS TOKEN!</b>\nToken is too short. Please send a valid Access Token.", {
                    parse_mode: "HTML",
                    reply_markup: getMainKeyboard().reply_markup
                });
            }

            // Use Telegram User ID as Session ID (Exact match with working bot)
            const sessionId = String(ctx.from.id);
            const s = getSettings();
            const baseServer = s.server_login_base_url || "http://78.154.103.31:9133/";
            const serverLoginUrl = `${baseServer.endsWith("/") ? baseServer : baseServer + "/"}${sessionId}/`;

            saveSession(ctx.from.id, { token, sessionId, serverLoginUrl });

            const configObj = { serverLoginUrl };
            const jsonStr = JSON.stringify(configObj, null, 2);

            const successMsg = `RAJ CODER FF\nBAN LOGIN — SESSION CREATED ✅\n\n<b>SESSION DETAILS:</b>\n• <b>Session ID:</b> <code>${sessionId}</code>\n• <b>Status:</b> 🟢 ACTIVE\n• <b>Server Login URL:</b>\n<code>${serverLoginUrl}</code>\n\n📁 <b>JSON Configuration:</b>\n<pre><code>${jsonStr}</code></pre>\n\nᴘʟᴀᴄᴇ ᴛʜɪs ғɪʟᴇ ɪɴ ʏᴏᴜʀ ɢᴀᴍᴇ ᴅɪʀᴇᴄᴛᴏʀʏ

ʜᴏᴡ ᴛᴏ ᴜsᴇ:
1. ᴅᴏᴡɴʟᴏᴀᴅ ᴛʜᴇ ғɪʟᴇ (localconfig.json)
2. ᴏᴘᴇɴ ᴛʜᴇ ғᴏʟᴅᴇʀ ᴡʜᴇʀᴇ ᴛʜᴇ ғɪʟᴇ ᴡᴀs ᴅᴏᴡɴʟᴏᴀᴅᴇᴅ
3. ᴄᴏᴘʏ ᴛʜᴇ ғɪʟᴇ
4. ɢᴏ ᴛᴏ: /storage/emulated/0/Android/data/com.dts.freefiremax/files/
5. ᴘᴀsᴛᴇ ᴛʜᴇ ғɪʟᴇ ɪɴᴛᴏ ᴛʜɪs ғᴏʟᴅᴇʀ
6. ᴏᴘᴇɴ ꜰʀᴇᴇ ꜰɪʀᴇ ᴏʀ ꜰʀᴇᴇ ꜰɪʀᴇ ᴍᴀx, ᴄʜᴏᴏsᴇ ᴀɴʏ ᴘʟᴀᴛꜰᴏʀᴍ ᴀɴᴅ ʟᴏɢɪɴ ᴛᴏ ʏᴏᴜʀ ɢᴀᴍᴇ ᴀᴄᴄᴏᴜɴᴛ
7. ᴏɴᴄᴇ ʟᴏɢɢᴇᴅ ɪɴ, ʏᴏᴜ ᴄᴀɴ ᴄʜᴇᴄᴋ ʏᴏᴜʀ ʙᴀɴɴᴇᴅ ɢᴀᴍᴇ ᴀᴄᴄᴏᴜɴᴛ ᴀɴᴅ ᴠɪᴇᴡ ʏᴏᴜʀ ɢᴀᴍᴇ ᴘʀᴏꜰɪʟᴇ

ɴᴏᴛᴇ: ᴛʜɪs ᴍᴇᴛʜᴏᴅ ᴡᴏʀᴋs ᴡɪᴛʜ ʙᴏᴛʜ ꜰʀᴇᴇ ꜰɪʀᴇ ᴀɴᴅ ꜰʀᴇᴇ ꜰɪʀᴇ ᴍᴀx.
ɪғ ʏᴏᴜ ғᴀᴄᴇ ᴀɴʏ ɪssᴜᴇs, ᴅᴍ @RajCoderFf`;

            await ctx.reply(successMsg, {
                parse_mode: "HTML",
                reply_markup: getMainKeyboard().reply_markup
            });

            try {
                await ctx.replyWithDocument({
                    source: Buffer.from(jsonStr, "utf-8"),
                    filename: "localconfig.json"
                }, {
                    caption: "📄 <b>ʟᴏᴄᴀʟᴄᴏɴғɪɢ.ᴊsᴏɴ</b> — ᴘʟᴀᴄᴇ ɪɴ <code>Android/data/com.dts.freefiremax/files/</code>",
                    parse_mode: "HTML"
                });
            } catch (e) {
                console.error("Error sending json document:", e.message);
            }
            return;
        }

        if (userState.mode === "WALLET_CUSTOM_AMOUNT") {
            const amt = parseInt(text);
            if (isNaN(amt) || amt < 10) {
                return ctx.reply("❌ ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴀ ᴠᴀʟɪᴅ ᴀᴍᴏᴜɴᴛ (ᴍɪɴɪᴍᴜᴍ ₹10)!");
            }
            return generateWalletTopupQr(ctx, amt);
        }

        const parts = text.split(/\s+/);
        const uid = parts[0];
        const settings = getSettings();
        const region = (parts[1] || settings.default_region || "IND").toUpperCase();

        // Auto-delete the prompt message ("Please send UID")
        if (userState.promptMsgId && ctx.chat) {
            try {
                await ctx.telegram.deleteMessage(ctx.chat.id, userState.promptMsgId);
            } catch (delErr) { }
        }

        if (userState.mode === "UNBAN") {
            return executeUnbanQuery(ctx, uid, region);
        } else if (userState.mode === "INFO") {
            return executeFullInfoQuery(ctx, uid, region);
        } else if (userState.mode === "LIKE") {
            return executeLikeQuery(ctx, uid, region);
        } else if (userState.mode === "GLORY") {
            return executeGloryQuery(ctx, uid);
        }
    }

    // 3. Direct numeric UID entered without clicking menu
    if (/^\d{5,15}$/.test(text)) {
        return executeFullInfoQuery(ctx, text, "IND");
    }

    return ctx.reply("❓ ᴘʟᴇᴀsᴇ ᴜsᴇ ᴛʜᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ ᴏʀ ᴛʏᴘᴇ <code>/help</code>.", {
        parse_mode: "HTML"
    });
});

// Error handling
bot.catch((err) => {
    console.error("Bot unhandled error:", err.message);
});

// ─── 24/7 Cloud Web Health Server & Dedicated Login Server ───────────────────
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    const url = req.url || "/";
    const match = url.match(/^\/(\d+)\/?$/);
    if (match) {
        const uid = match[1];
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(`<b> Server Active</b><br><b>Server URL:</b> <code>http://${req.headers.host}/${uid}/</code><br><br>👨‍💻 <b>Developed by @RajCoderFf</b>`);
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
        <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
                <h1>🤖 Free Fire Official Info Bot</h1>
                <p style="color: #4ade80; font-size: 18px;">✅ Bot & Server are Active 24/7 on Cloud</p>
                <p>Telegram: <b>@freefireofficialinfo_bot</b></p>
            </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`🌐 24/7 Cloud Health & Dedicated Login Server listening on port ${PORT}`);
});

// Launch Bot with Automatic Retry
async function startBotWithRetry(retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`🚀 Starting Free Fire Info Bot v5.2 (Attempt ${i + 1}/${retries})...`);
            const me = await bot.telegram.getMe();
            console.log(`✅ Bot LIVE: @${me.username} (ID: ${me.id})`);
            await bot.launch({ dropPendingUpdates: true });
            console.log("⚡ Telegram Polling started successfully!");
            return;
        } catch (err) {
            console.error(`❌ Bot launch error (Attempt ${i + 1}):`, err.message);
            if (i < retries - 1) {
                console.log(`⏳ Retrying in ${delay / 1000}s...`);
                await new Promise((r) => setTimeout(r, delay));
            } else {
                console.error("💥 All launch retries exhausted. Exiting so Render auto-restarts...");
                process.exit(1);
            }
        }
    }
}

startBotWithRetry();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
