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
    getSettings,
    saveSettings,
    isAdmin,
    getGateway,
    saveGateway,
    createOrder,
    getOrder,
    getAllOrders,
    getPendingOrders,
    updateOrderStatus
} = require("./utils/db");
const { getPricing, updatePrice, addPackage, deletePackage } = require("./utils/pricing");
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
async function isUserMember(ctx, userId) {
    const settings = getSettings();
    if (!settings.force_join_enabled || !settings.force_channel_username) {
        return true;
    }
    try {
        const member = await ctx.telegram.getChatMember(settings.force_channel_username, userId);
        const allowed = ["creator", "administrator", "member", "restricted"];
        return allowed.includes(member.status);
    } catch (err) {
        return true;
    }
}

// ─── Send Force Join Message ─────────────────────────────────────────────────
async function sendForceJoinPrompt(ctx) {
    const settings = getSettings();
    const channelLink = settings.force_channel_link || `https://t.me/${settings.force_channel_username?.replace("@", "")}`;
    const msg = `
⚠️ <b>चैनल जॉइन करना ज़रूरी है / CHANNEL JOIN REQUIRED</b> ⚠️
━━━━━━━━━━━━━━━━━━━━━━
Bot का उपयोग करने के लिए पहले हमारा <b>Official Telegram Channel</b> जॉइन करें:

📢 <b>Official Channel:</b> ${settings.force_channel_username}

👇 <b>नीचे दिए गए Link से चैनल Join करें, फिर 'Verify' बटन दबाएं:</b>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.url("📢 Official Channel Join करें", channelLink)],
            [Markup.button.callback("✅ Verify / Joined (सत्यापित करें)", "verify_channel_join")]
        ]).reply_markup
    });
}

// ─── Main Keyboard Helper ────────────────────────────────────────────────────
function getMainKeyboard() {
    return Markup.keyboard([
        ["🔓 FF ID Unban", "📊 FF ID Info"],
        ["💳 Add Balance", "👤 Status"]
    ]).resize();
}

// ─── Send Home Screen ────────────────────────────────────────────────────────
async function sendHomeScreen(ctx) {
    const user = ctx.from;
    registerUser(user);

    const welcomeMsg = `
👋 <b>नमस्ते / Welcome, ${user.first_name || "Player"}!</b> 🔥

<b>Free Fire Official Multi-Utility Bot</b> में आपका स्वागत है! 🎮

━━━━━━━━━━━━━━━━━━━━━━
📋 <b>Commands & Guide (निर्देश):</b>
▸ <code>/get &lt;uid&gt;</code> — Quick Player Info निकालने के लिए
▸ <code>/unban</code> — FF ID Ban Audit & Unban प्रक्रिया
▸ <code>/info</code> — Player का Full Profile Info
▸ <code>/balance</code> — Wallet Balance व पैसे जोड़ें
▸ <code>/status</code> — आपका Bot Profile और Status
▸ <code>/regions</code> — Supported Server Regions
━━━━━━━━━━━━━━━━━━━━━━

👇 <b>नीचे दिए गए Buttons पर Tap करके शुरू करें:</b>
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
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) {
        return sendForceJoinPrompt(ctx);
    }
    return sendHomeScreen(ctx);
});

// ─── Verify Channel Callback ─────────────────────────────────────────────────
bot.action("verify_channel_join", async (ctx) => {
    await ctx.answerCbQuery();
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) {
        return ctx.reply("❌ <b>आपने अभी तक चैनल जॉइन नहीं किया है!</b>\n\nकृपया पहले Official Channel जॉइन करें, फिर 'Verify' बटन पर क्लिक करें।", {
            parse_mode: "HTML"
        });
    }
    await ctx.reply("🎉 <b>सत्यापन सफल / Verification Successful!</b>\nआपका स्वागत है!", { parse_mode: "HTML" });
    return sendHomeScreen(ctx);
});

// ─── Feature 1: FF ID Unban ──────────────────────────────────────────────────
async function handleUnbanRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    userStates.set(ctx.from.id, { mode: "UNBAN" });

    return ctx.reply(
        "🔓 <b>FF ID BAN AUDIT & UNBAN</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n🎮 <b>कृपया अपनी Free Fire Game UID भेजें:</b>\n\n<i>(उदाहरण / Example: <code>2540951574</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel (रद्द करें)", "cancel_action")]
            ]).reply_markup
        }
    );
}

bot.hears("🔓 FF ID Unban", handleUnbanRequest);
bot.command("unban", handleUnbanRequest);

// ─── Feature 2: FF ID Info ───────────────────────────────────────────────────
async function handleInfoRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    userStates.set(ctx.from.id, { mode: "INFO" });

    return ctx.reply(
        "📊 <b>FF ID PROFILE LOOKUP</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n🔍 <b>कृपया जिस Account की पूरी Info चाहिए, उसकी UID भेजें:</b>\n\n<i>(उदाहरण / Example: <code>2540951574</code>)</i>",
        {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel (रद्द करें)", "cancel_action")]
            ]).reply_markup
        }
    );
}

bot.hears("📊 FF ID Info", handleInfoRequest);
bot.command("info", handleInfoRequest);

// ─── Feature 3: Status ───────────────────────────────────────────────────────
async function handleStatusRequest(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const user = registerUser(ctx.from);
    const bal = getUserBalance(user.id);
    const msg = `
👤 <b>YOUR PROFILE & STATUS (उपयोगकर्ता प्रोफ़ाइल)</b>
━━━━━━━━━━━━━━━━━━━━━━
📛 <b>Name (नाम):</b> <b>${user.first_name || ""} ${user.last_name || ""}</b>
🏷️ <b>Username:</b> ${user.username || "None"}
🆔 <b>Telegram Chat ID:</b> <code>${user.id}</code>
💼 <b>Wallet Balance:</b> <b>₹${bal.toFixed(2)}</b>
📅 <b>Bot Joined On (शामिल हुए):</b> <code>${user.joined_formatted}</code>
📊 <b>Total Searches (कुल सर्च):</b> <b>${user.queries_count || 0}</b>
🛡️ <b>Status (स्थिति):</b> <b>✅ Verified Member (सत्यापित सदस्य)</b>
━━━━━━━━━━━━━━━━━━━━━━
⚡ <i>Bot is Active & Operational</i>
`;
    return ctx.reply(msg, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("💳 Add Balance / पैसे जोड़ें", "prompt_add_balance")]
        ]).reply_markup
    });
}

bot.hears("👤 Status", handleStatusRequest);
bot.command("status", handleStatusRequest);

// ─── Feature 4: Add Balance / Wallet ─────────────────────────────────────────
async function handleAddBalanceMenu(ctx) {
    const joined = await isUserMember(ctx, ctx.from.id);
    if (!joined) return sendForceJoinPrompt(ctx);

    const user = registerUser(ctx.from);
    const bal = getUserBalance(user.id);

    const msg = `
💳 <b>WALLET TOP-UP (वॉलेट रीचार्ज)</b>
━━━━━━━━━━━━━━━━━━━━━━
💼 <b>Current Balance (वर्तमान बैलेंस):</b> <b>₹${bal.toFixed(2)}</b>

बॉट वॉलेट में पैसे जोड़ने से आप बिना बार-बार QR स्कैन किए <b>1-Click में तुरंत</b> किसी भी ID को Unban कर सकते हैं!

👇 <b>पैसे जोड़ने के लिए नीचे दिए गए विकल्प चुनें:</b>
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
            Markup.button.callback("✏️ Enter Custom Amount (अन्य राशि)", "topup_amt_custom")
        ],
        [
            Markup.button.callback("❌ Cancel", "cancel_action")
        ]
    ]);

    return ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb.reply_markup });
}

bot.hears("💳 Add Balance", handleAddBalanceMenu);
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
    return ctx.reply("✏️ <b>कृपया वॉलेट में जोड़ने की राशि दर्ज करें (कम से कम ₹10):</b>\n\n*Example:* <code>150</code> या <code>350</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "cancel_action")]]).reply_markup
    });
});

async function generateWalletTopupQr(ctx, amount) {
    if (isNaN(amount) || amount < 10) {
        return ctx.reply("❌ राशि कम से कम ₹10 होनी चाहिए!");
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

    const upiId = gw.paytm.upi_id || "wantedmod52@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE UNBAN SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, amount, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  💳 <b>PAYTM WALLET TOP-UP (वॉलेट रीचार्ज)</b>
━━━━━━━━━━━━━━━━━━━━━━━

💰 <b>Top-up Amount (जोड़ने की राशि):</b> <b>₹${amount}</b>
🔐 <b>Order Reference:</b> <code>${order.id}</code>
💳 <b>Payee UPI VPA:</b> <code>${upiId}</code>
⏱️ <b>Validity:</b> 15 Minutes

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>Payment Instructions (निर्देश):</b>
1️⃣ <b>Paytm, Google Pay, PhonePe</b> या किसी भी UPI ऐप से यह QR स्कैन करें।
2️⃣ <b>ठीक ₹${amount}</b> का भुगतान करें।
3️⃣ भुगतान के तुरंत बाद नीचे <b>[🔄 Verify Top-up]</b> दबाएं।

⚡ <b>Auto-Verify:</b> भुगतान पुष्टि होते ही पैसे तुरंत आपके वॉलेट में जुड़ जाएंगे!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Verify Top-up (भुगतान जांचें)", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ Cancel", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── /regions ────────────────────────────────────────────────────────────────
bot.command("regions", async (ctx) => {
    const regions = Object.entries(REGION_MAP)
        .map(([code, label]) => `• <code>${code.toUpperCase()}</code> → ${label}`)
        .join("\n");
    ctx.reply(`🌍 <b>Supported Server Regions (सर्वर क्षेत्र):</b>\n\n${regions}\n\n📌 <b>Example:</b> <code>/get 2540951574 ind</code>`, {
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
        return ctx.reply("❌ <b>उपयोग निर्देश / Usage:</b> <code>/get &lt;uid&gt; [region]</code>\n\n*Example:* <code>/get 2540951574</code>", {
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
    await ctx.reply("❌ <b>Action रद्द कर दिया गया है।</b>", {
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
⚠️ <b>ज़रूरी सूचना / IMPORTANT NOTICE:</b>
━━━━━━━━━━━━━━━━━━━━━━
📌 <b>Payment complete होने के तुरंत बाद</b> Unban Process शुरू हो जाता है।
⚠️ <b>ध्यान दें (PLEASE NOTE):</b> Payment के बाद लगभग <b>30 से 40 मिनट तक</b> अपनी Free Fire ID को <b>Login न करें!</b>
❌ <b>अन्यथा Unban Process Fail हो जाएगा</b> और ID रिकवर नहीं होगी।
━━━━━━━━━━━━━━━━━━━━━━

❓ <b>आपका Account कितने दिनों के लिए Ban है? सही विकल्प (Option) चुनें, नहीं तो Unban Process Fail हो जाएगा:</b>
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
📋 <b>चयनित पैकेज / SELECTED PACKAGE:</b>
━━━━━━━━━━━━━━━━━━━━━━
🆔 <b>Free Fire UID:</b> <code>${ffUid}</code>
🛡️ <b>Ban Category:</b> <b>${pkg.label}</b>
💰 <b>Payable Amount:</b> <b>₹${pkg.price}</b>
💼 <b>Your Wallet Balance:</b> <b>₹${userBal.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━

⚡ <b>आपके पास पर्याप्त वॉलेट बैलेंस उपलब्ध है!</b>
आप सीधे Wallet से तुरंत भुगतान कर सकते हैं या Paytm QR कोड स्कैन करके:
`;
        return ctx.reply(askMsg, {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback(`⚡ Pay from Wallet (तुरंत Unban ₹${pkg.price})`, `pay_wallet_${pkgKey}_${ffUid}`)],
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
        return ctx.reply("❌ आपके वॉलेट में पर्याप्त बैलेंस नहीं है। कृपया QR Code से भुगतान करें।", {
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
    return ctx.reply(`✅ <b>₹${pkg.price} आपके वॉलेट से काट लिए गए हैं!</b>\n💼 शेष वॉलेट बैलेंस: <b>₹${remainingBal.toFixed(2)}</b>\n\n🎉 Unban प्रक्रिया शुरू हो चुकी है!`, {
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

    const upiId = gw.paytm.upi_id || "wantedmod52@paytm";
    const merchantName = gw.paytm.merchant_name || "FREE FIRE UNBAN SERVICES";
    const upiUri = makeUpiUri(upiId, merchantName, pkg.price, order.id);

    const caption = `
━━━━━━━━━━━━━━━━━━━━━━━
  💳 <b>PAYTM SECURE PAYMENT (सुरक्षित भुगतान)</b>
━━━━━━━━━━━━━━━━━━━━━━━

💰 <b>Amount Payable (कुल राशि):</b> <b>₹${pkg.price}</b>
🆔 <b>Free Fire UID:</b> <code>${ffUid}</code>
🛡️ <b>Ban Category (पैकेज):</b> <b>${pkg.label}</b>
🔐 <b>Order Reference:</b> <code>${order.id}</code>
💳 <b>Payee UPI VPA:</b> <code>${upiId}</code>
⏱️ <b>Validity:</b> 15 Minutes

━━━━━━━━━━━━━━━━━━━━━━━
📝 <b>Payment Instructions (भुगतान निर्देश):</b>
1️⃣ <b>Paytm, Google Pay, PhonePe, BHIM</b> या किसी भी UPI ऐप से ऊपर का QR Code स्कैन करें।
2️⃣ <b>ठीक ₹${pkg.price}</b> का भुगतान करें (कम या ज्यादा न करें)।
3️⃣ Remarks/Note में कोई बदलाव न करें।
4️⃣ भुगतान के बाद नीचे <b>[🔄 Verify Payment]</b> पर टैप करें।

⚡ <b>Automated Verification:</b>
Payment होते ही Unban प्रक्रिया बैकएंड में शुरू हो जाएगी!
`;

    const markup = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Verify Payment (भुगतान जांचें)", `check_pay_${order.id}`)],
        [Markup.button.callback("❌ Cancel Order (रद्द करें)", `cancel_pay_${order.id}`)]
    ]).reply_markup;

    return await sendQrPhoto(ctx, upiUri, caption, markup);
}

// ─── Manual Payment Verification Button ──────────────────────────────────────
bot.action(/^check_pay_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const order = getOrder(orderId);

    if (!order) {
        return ctx.answerCbQuery("❌ Order नहीं मिला!", { show_alert: true });
    }

    if (order.status === "PAID") {
        return ctx.answerCbQuery("✅ यह Payment पहले ही Verify हो चुका है!", { show_alert: true });
    }

    await ctx.answerCbQuery("🔍 Paytm सर्वर से Payment स्टेटस चेक किया जा रहा है...");

    const gw = getGateway();
    if (gw.paytm.mid && gw.paytm.merchant_key) {
        const result = await verifyPaytmStatus(gw.paytm.mid, gw.paytm.merchant_key, orderId);
        if (result.success) {
            await handleSuccessfulPayment(ctx.telegram, order, result.txnId);
            return ctx.reply(`🎉 <b>Payment Verified Successfully!</b>\n\n🆔 Order ID: <code>${orderId}</code>\n💰 Amount: <b>₹${order.amount}</b>\n\n✅ आपका अनुरोध Process में है!`, {
                parse_mode: "HTML"
            });
        } else if (result.pending) {
            return ctx.reply(`⏳ <b>Payment अभी Pending है!</b>\n\nअगर आपने भुगतान कर दिया है तो बैंक/UPI सेटलमेंट में 10 से 30 सेकंड का समय लग सकता है।\nकृपया 15 सेकंड बाद पुनः <b>[🔄 Verify Payment]</b> दबाएं।`, {
                parse_mode: "HTML"
            });
        } else {
            return ctx.reply(`⚠️ <b>Payment पुष्टि नहीं हो पाई!</b>\n\nस्टेटस: <code>${result.status || "NOT_RECEIVED"}</code>\nयदि पैसे कट गए हैं, तो कृपया कुछ देर इंतज़ार करें या Admin से संपर्क करें।`, {
                parse_mode: "HTML"
            });
        }
    } else {
        return ctx.reply(`⏳ <b>Payment Verification In Progress...</b>\n\n🆔 Order: <code>${orderId}</code>\n💰 Amount: <b>₹${order.amount}</b>\n\nPayment पुष्टि होते ही आपका वॉलेट/ऑर्डर अपडेट हो जाएगा।`, {
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
    await ctx.reply(`❌ <b>Order #${orderId} रद्द कर दिया गया है।</b>`, {
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
            const supportLink = settings.support_link || "https://t.me/wantedmod52";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>WALLET TOP-UP SUCCESSFUL / रीचार्ज सफल!</b>
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>आपके वॉलेट में पैसे सफलतापूर्वक जुड़ गए हैं!</b>

💰 <b>Amount Credited:</b> <b>₹${order.amount}</b>
💼 <b>Updated Wallet Balance:</b> <b>₹${newBal.toFixed(2)}</b>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
⏱️ <b>Date & Time:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚡ <i>अब आप इस बैलेंस से किसी भी Free Fire ID को तुरंत Unban कर सकते हैं!</i>

💬 <b>यदि कोई सहायता चाहिए, तो नीचे Support बटन पर टैप करें:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 Support से बात करें (Contact Support)", supportLink)]
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

    } else {
        // ─── FF ID Unban Flow ────────────────────────────────────────────────
        // 1. Notify Customer
        try {
            const supportLink = settings.support_link || "https://t.me/wantedmod52";
            const userMsg = `
━━━━━━━━━━━━━━━━━━━━━━━
  🎉 <b>PAYMENT CONFIRMED & VERIFIED!</b>
━━━━━━━━━━━━━━━━━━━━━━━

✅ <b>आपका भुगतान सफलतापूर्वक प्राप्त हो गया है!</b>

🆔 <b>Free Fire UID:</b> <code>${order.ff_uid}</code>
🛡️ <b>Package:</b> <b>${order.package_label}</b>
💰 <b>Amount Paid:</b> <b>₹${order.amount}</b>
🧾 <b>Order Ref:</b> <code>${order.id}</code>
⏱️ <b>Date & Time:</b> <code>${updatedOrder?.paid_formatted}</code>

━━━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>अति आवश्यक सूचना / CRITICAL NOTICE:</b>
📌 Unban Process बैकएंड में शुरू हो चुका है।
🚫 <b>अगले 30 से 40 मिनट तक अपनी Free Fire ID को बिल्कुल भी Login न करें!</b>
❌ यदि आपने बीच में Login किया तो Unban Process निरस्त (Fail) हो जाएगा।
━━━━━━━━━━━━━━━━━━━━━━━

💬 <b>यदि कोई समस्या या सहायता चाहिए, तो नीचे दिए गए बटन पर टैप करके Support से बात करें:</b>
`;
            await telegram.sendMessage(order.user_id, userMsg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.url("💬 Support से बात करें (Contact Support)", supportLink)]
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
        return ctx.reply("❌ <b>Invalid UID!</b>\nUID केवल अंकों (5-15 Digits) में होनी चाहिए।\n\n<i>(उदाहरण: <code>2540951574</code>)</i>", {
            parse_mode: "HTML",
        });
    }

    incrementQueries(ctx.from.id);

    try { await ctx.sendChatAction("typing"); } catch { }

    const loadingMsg = await ctx.reply(`⏳ <b>Loading... डेटा लोड किया जा रहा है</b>\n\n🆔 <b>UID:</b> <code>${uid}</code>\n🌍 <b>Server:</b> <code>${region}</code>\n\n🔍 Server से Player Data फेच हो रहा है, कृपया थोड़ा इंतज़ार करें...`, {
        parse_mode: "HTML",
    });

    try {
        const result = await getPlayerInfo(uid, region);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }

        if (!result.success) {
            return ctx.reply(`❌ <b>Failed to Fetch Info / डेटा नहीं मिला</b>\n\n${result.error}`, { parse_mode: "HTML" });
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
                [Markup.button.callback("🔍 Check Another UID (दूसरी ID चेक करें)", "prompt_info")]
            ]).reply_markup
        });

    } catch (err) {
        console.error("Info query error:", err.message);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }
        ctx.reply("⚠️ Player डिटेल्स फेच करते समय त्रुटि आई। कृपया थोड़ी देर बाद पुनः प्रयास करें।");
    }
}

// ─── Helper: Execute Unban Verification Query (With Clean Loading Indicator) ─
async function executeUnbanQuery(ctx, uid, region = "IND") {
    if (!/^\d{5,15}$/.test(uid)) {
        return ctx.reply("❌ <b>Invalid UID!</b>\nUID केवल अंकों (5-15 Digits) में होनी चाहिए।\n\n<i>(उदाहरण: <code>2540951574</code>)</i>", {
            parse_mode: "HTML",
        });
    }

    incrementQueries(ctx.from.id);

    try { await ctx.sendChatAction("typing"); } catch { }

    const loadingMsg = await ctx.reply(`⏳ <b>Loading... Ban Status चेक किया जा रहा है</b>\n\n🆔 <b>UID:</b> <code>${uid}</code>\n🔍 Server से Player Data फेच हो रहा है, कृपया थोड़ा इंतज़ार करें...`, {
        parse_mode: "HTML",
    });

    try {
        const result = await getPlayerInfo(uid, region);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id); } catch { }

        if (!result.success) {
            return ctx.reply(`❌ <b>Player Not Found / खिलाड़ी नहीं मिला</b>\n\n${result.error}`, { parse_mode: "HTML" });
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
        ctx.reply("⚠️ Ban Status ऑडिट करते समय त्रुटि आई। कृपया थोड़ी देर बाद पुनः प्रयास करें।");
    }
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
            Markup.button.callback("💰 Packages & Prices", "adm_prices")
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
            Markup.button.callback("❌ Close Admin Panel", "adm_close")
        ]
    ]);
}

bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("⛔ <b>Access Denied!</b>\nयह कमांड केवल बॉट Admin के लिए उपलब्ध है।", {
            parse_mode: "HTML"
        });
    }

    adminStates.delete(ctx.from.id);

    const msg = `
👑 <b>WANTED BOT — ADMIN CONTROL PANEL</b>
━━━━━━━━━━━━━━━━━━━━━━━
नमस्ते Admin! यहाँ से आप Bot के सभी Features, Channels, Prices और Paytm Gateway को Live कंट्रोल कर सकते हैं:

👇 <b>कंट्रोल करने के लिए नीचे कोई विकल्प चुनें:</b>
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
👑 <b>WANTED BOT — ADMIN CONTROL PANEL</b>
━━━━━━━━━━━━━━━━━━━━━━━
कृपया वह सेक्शन चुनें जिसे आप मैनेज करना चाहते हैं:
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
🛡️ <b>Force Join Status:</b> <b>${s.force_join_enabled ? "🟢 ON (सक्रिय)" : "🔴 OFF (बंद)"}</b>
🏷️ <b>Channel Username:</b> <code>${s.force_channel_username || "Not Set"}</code>
🔗 <b>Channel Link:</b> <code>${s.force_channel_link || "Not Set"}</code>
💬 <b>Support Link:</b> <code>${s.support_link || "https://t.me/wantedmod52"}</code>
━━━━━━━━━━━━━━━━━━━━━━
<i>Note: Force Join काम करने के लिए Bot का चैनल में Admin होना ज़रूरी है।</i>
`;
    const kb = Markup.inlineKeyboard([
        [
            Markup.button.callback("✏️ Set Channel Link", "adm_set_link"),
            Markup.button.callback("✏️ Set Username", "adm_set_user")
        ],
        [
            Markup.button.callback("💬 Set Support Link", "adm_set_support"),
            Markup.button.callback(s.force_join_enabled ? "🔴 Turn OFF Force Join" : "🟢 Turn ON Force Join", "adm_toggle_force")
        ],
        [
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
    return ctx.reply("💬 <b>कृपया नया Support Link भेजें:</b>\n\n*Example:* <code>https://t.me/wantedmod52</code>", {
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
    return ctx.reply("🔗 <b>कृपया नया Channel Link भेजें:</b>\n\n*Example:* <code>https://t.me/yourchannel</code>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Cancel", "adm_channels")]]).reply_markup
    });
});

bot.action("adm_set_user", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "SET_CHANNEL_USER" });
    return ctx.reply("🏷️ <b>कृपया नया Channel Username भेजें (@ के साथ):</b>\n\n*Example:* <code>@yourchannel</code>", {
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
✏️ <b>नया पैकेज जोड़ने या Price बदलने के लिए नीचे Button चुनें:</b>
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
    return ctx.editMessageText("✏️ <b>किस पैकेज का Price बदलना चाहते हैं? चुनें:</b>", {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(rows).reply_markup
    });
});

bot.action(/^adm_chgprice_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const key = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { action: "EDIT_PRICE", key: key });
    return ctx.reply(`💰 <b>${key}</b> का नया Price (केवल संख्या / Numbers) भेजें:\n\n*Example:* <code>199</code>`, {
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
कृपया नीचे दिए गए Format में पैकेज की जानकारी भेजें:

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
    return ctx.editMessageText("🗑️ <b>किस पैकेज को Delete करना चाहते हैं? चुनें:</b>", {
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
🟢 <b>Gateway Status:</b> <b>${p.enabled ? "ACTIVE (सक्रिय)" : "DISABLED (बंद)"}</b>
🤖 <b>Auto-Verification:</b> <b>${p.auto_verify ? "🟢 ON (स्वचालित)" : "⚪ OFF (मैनुअल)"}</b>

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
कृपया नीचे दिए गए Format में एक-एक Line में जानकारी भेजें:

<code>Paytm MID: YOUR_MID
Merchant Key: YOUR_KEY
Paytm UPI ID: your@paytm
Merchant Name: Your Store Name</code>

ℹ️ <b>Notes:</b>
• <b>Paytm UPI ID</b> instant UPI QR Code बनाने के लिए काम आता है।
• <b>Paytm MID & Key</b> auto-verification & instant status check के लिए उपयोग होते हैं।
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

    return ctx.reply("📢 <b>BROADCAST ANNOUNCEMENT</b>\n\nवह Message भेजें जो आप सभी Bot Users को भेजना चाहते हैं (HTML supported):\n\n*Cancel करने के लिए नीचे टैप करें:*", {
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
👥 <b>RECENT USERS DIRECTORY (हाल ही के यूज़र्स)</b>
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
✏️ <b>Price बदलने का तरीका:</b>
<code>/setprice &lt;type&gt; &lt;amount&gt;</code>

<b>उदाहरण / Example:</b>
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
        return ctx.reply("⛔ केवल Admin ही Price बदल सकता है!");
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) {
        return ctx.reply("❌ <b>उपयोग / Usage:</b> <code>/setprice &lt;key&gt; &lt;amount&gt;</code>\n\n*Example:* <code>/setprice 3day 99</code>\n\nCheck all keys: <code>/prices</code>", {
            parse_mode: "HTML"
        });
    }

    const key = parts[1].toLowerCase();
    const amount = parseInt(parts[2]);

    if (isNaN(amount) || amount <= 0) {
        return ctx.reply("❌ Amount मान्य संख्या (Valid Number) होनी चाहिए!");
    }

    const success = updatePrice(key, amount);
    if (success) {
        return ctx.reply(`✅ <b>Price Update हो गया!</b>\n\n<b>${key}</b> का नया Price: <b>₹${amount}</b>`, {
            parse_mode: "HTML"
        });
    } else {
        return ctx.reply(`❌ Invalid key: <code>${key}</code>\n\nKeys देखने के लिए <code>/prices</code> लिखें।`, {
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
            return ctx.reply(`✅ <b>Channel Link अपडेट हो गया!</b>\n\n🔗 ${text}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "SET_CHANNEL_USER") {
            const s = getSettings();
            s.force_channel_username = text.startsWith("@") ? text : `@${text}`;
            s.force_join_enabled = true;
            saveSettings(s);
            return ctx.reply(`✅ <b>Channel Username अपडेट हो गया!</b>\n\n🏷️ ${s.force_channel_username}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "SET_SUPPORT_LINK") {
            const s = getSettings();
            s.support_link = text;
            saveSettings(s);
            return ctx.reply(`✅ <b>Support Link अपडेट हो गया!</b>\n\n💬 ${text}`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Channel & Support Settings", "adm_channels")]]).reply_markup
            });
        }

        if (adminState.action === "EDIT_PRICE") {
            const key = adminState.key;
            const amt = parseInt(text);
            if (isNaN(amt) || amt <= 0) {
                return ctx.reply("❌ कृपया एक मान्य संख्या (Valid Number) दर्ज करें!");
            }
            updatePrice(key, amt);
            return ctx.reply(`✅ <b>${key}</b> का नया Price <b>₹${amt}</b> सेट हो गया!`, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Prices List", "adm_prices")]]).reply_markup
            });
        }

        if (adminState.action === "ADD_PACKAGE") {
            const parts = text.split("|").map((p) => p.trim());
            if (parts.length < 3) {
                return ctx.reply("❌ Invalid format! कृपया <code>KEY | LABEL | PRICE</code> में भेजें।", { parse_mode: "HTML" });
            }
            const [k, lbl, prc] = parts;
            addPackage(k.toLowerCase(), lbl, prc);
            return ctx.reply(`✅ <b>नया पैकेज जुड़ गया!</b>\n\n🏷️ <b>${lbl}</b> (${k})\n💰 <b>₹${prc}</b>`, {
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

            return ctx.reply(`✅ <b>Paytm Configuration सुरक्षित रूप से Save हो गया!</b>\n\n🆔 MID: <code>${gw.paytm.mid ? gw.paytm.mid.slice(0, 4) + "****" : "Not Set"}</code>\n💳 UPI ID: <code>${gw.paytm.upi_id}</code>\n🏷️ Name: <b>${gw.paytm.merchant_name}</b>`, {
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
            await ctx.reply(`📢 <b>Broadcast Background में शुरू हो चुका है!</b>\n\n👥 <b>Total Users:</b> ${userIds.length}\n⚡ बॉट सामान्य रूप से सभी काम करता रहेगा और बिल्कुल नहीं रुकेगा।\nकार्य पूर्ण होते ही आपको अंतिम रिपोर्ट मिल जाएगी।`, {
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
                    await bot.telegram.sendMessage(adminChatId, `✅ <b>Broadcast Report (प्रसारण रिपोर्ट):</b>\n\n📨 कुल सफल (Sent): <b>${sent}</b>\n❌ विफल/Blocked: <b>${failed}</b>\n👥 कुल यूज़र्स: <b>${userIds.length}</b>`, {
                        parse_mode: "HTML"
                    });
                } catch (reportErr) {
                    console.error("Broadcast report failed:", reportErr.message);
                }
            });

            return;
        }
    }

    // Ignore persistent menu buttons in text router
    if (["🔓 FF ID Unban", "📊 FF ID Info", "💳 Add Balance", "👤 Status"].includes(text)) {
        return;
    }

    // 2. Process User Conversation States
    const userState = userStates.get(ctx.from.id);
    if (userState) {
        userStates.delete(ctx.from.id);

        if (userState.mode === "WALLET_CUSTOM_AMOUNT") {
            const amt = parseInt(text);
            if (isNaN(amt) || amt < 10) {
                return ctx.reply("❌ कृपया एक मान्य संख्या दर्ज करें (कम से कम ₹10)!");
            }
            return generateWalletTopupQr(ctx, amt);
        }

        const parts = text.split(/\s+/);
        const uid = parts[0];
        const settings = getSettings();
        const region = (parts[1] || settings.default_region || "IND").toUpperCase();

        if (userState.mode === "UNBAN") {
            return executeUnbanQuery(ctx, uid, region);
        } else if (userState.mode === "INFO") {
            return executeFullInfoQuery(ctx, uid, region);
        }
    }

    // 3. Direct numeric UID entered without clicking menu
    if (/^\d{5,15}$/.test(text)) {
        return executeFullInfoQuery(ctx, text, "IND");
    }

    return ctx.reply("❓ कृपया नीचे दिए गए Buttons का उपयोग करें या <code>/help</code> लिखें।", {
        parse_mode: "HTML"
    });
});

// Error handling
bot.catch((err) => {
    console.error("Bot unhandled error:", err.message);
});

// ─── 24/7 Cloud Web Health Server (For Render / Railway / Cloud Hosting) ──────
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
        <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
                <h1>🤖 Free Fire Official Info Bot</h1>
                <p style="color: #4ade80; font-size: 18px;">✅ Bot is Active & Running 24/7 on Clo/p>
                <p>Telegram: <b>@freefireofficialinfo_bot</b></p>
            </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`🌐 24/7 Cloud Health Server listening on port ${PORT}`);
});

// Launch Bot
(async () => {
    try {
        console.log("🚀 Starting Free Fire Info Bot v5.1 (Wallet + Loading + Reliable QR)...");
        const me = await bot.telegram.getMe();
        console.log(`✅ Bot LIVE: @${me.username} (ID: ${me.id})`);
        await bot.launch();
    } catch (err) {
        console.error("❌ Bot launch error:", err.message);
    }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
