const fs = require("fs");
const path = require("path");
const config = require("../config");

const USERS_PATH = path.join(__dirname, "../data/users.json");
const SETTINGS_PATH = path.join(__dirname, "../data/settings.json");
const GATEWAY_PATH = path.join(__dirname, "../data/gateway.json");
const ORDERS_PATH = path.join(__dirname, "../data/orders.json");
const SESSIONS_PATH = path.join(__dirname, "../data/sessions.json");

// ─── Sessions ───────────────────────────────────────────────────────────────
function loadSessions() {
    try {
        if (!fs.existsSync(SESSIONS_PATH)) {
            fs.writeFileSync(SESSIONS_PATH, JSON.stringify({}, null, 2));
            return {};
        }
        const data = fs.readFileSync(SESSIONS_PATH, "utf8");
        return JSON.parse(data || "{}");
    } catch {
        return {};
    }
}

function saveSessions(sessions) {
    try {
        fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
    } catch (e) {
        console.error("Error saving sessions:", e);
    }
}

function getSession(userId) {
    const sessions = loadSessions();
    return sessions[String(userId)] || null;
}

function saveSession(userId, { token, sessionId, serverLoginUrl }) {
    const sessions = loadSessions();
    const id = String(userId);
    const now = new Date();
    sessions[id] = {
        userId: userId,
        token: token,
        sessionId: sessionId,
        serverLoginUrl: serverLoginUrl,
        created_at: now.toISOString(),
        created_formatted: now.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
            timeZone: "Asia/Kolkata",
        }),
    };
    saveSessions(sessions);
    return sessions[id];
}

function deleteSession(userId) {
    const sessions = loadSessions();
    const id = String(userId);
    if (sessions[id]) {
        delete sessions[id];
        saveSessions(sessions);
        return true;
    }
    return false;
}

// ─── Users ──────────────────────────────────────────────────────────────────
function loadUsers() {
    try {
        if (!fs.existsSync(USERS_PATH)) {
            fs.writeFileSync(USERS_PATH, JSON.stringify({}, null, 2));
            return {};
        }
        const data = fs.readFileSync(USERS_PATH, "utf8");
        return JSON.parse(data || "{}");
    } catch {
        return {};
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error("Error saving users db:", e);
    }
}

function registerUser(from) {
    const users = loadUsers();
    const id = String(from.id);
    if (!users[id]) {
        users[id] = {
            id: from.id,
            first_name: from.first_name || "",
            last_name: from.last_name || "",
            username: from.username ? `@${from.username}` : "None",
            balance: 0,
            joined_at: new Date().toISOString(),
            joined_formatted: new Date().toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
                timeZone: "Asia/Kolkata",
            }),
            queries_count: 0,
        };
        saveUsers(users);
    } else {
        let updated = false;
        if (users[id].balance === undefined) {
            users[id].balance = 0;
            updated = true;
        }
        if (from.username && users[id].username !== `@${from.username}`) {
            users[id].username = `@${from.username}`;
            updated = true;
        }
        if (from.first_name && users[id].first_name !== from.first_name) {
            users[id].first_name = from.first_name;
            updated = true;
        }
        if (updated) saveUsers(users);
    }
    return users[id];
}

function getUser(userId) {
    const users = loadUsers();
    return users[String(userId)] || null;
}

function getUserBalance(userId) {
    const users = loadUsers();
    const id = String(userId);
    return (users[id] && users[id].balance) ? parseFloat(users[id].balance) : 0;
}

function addBalance(userId, amount) {
    const users = loadUsers();
    const id = String(userId);
    if (!users[id]) return false;
    users[id].balance = parseFloat((parseFloat(users[id].balance || 0) + parseFloat(amount)).toFixed(2));
    saveUsers(users);
    return users[id].balance;
}

function deductBalance(userId, amount) {
    const users = loadUsers();
    const id = String(userId);
    if (!users[id]) return false;
    const current = parseFloat(users[id].balance || 0);
    const amt = parseFloat(amount);
    if (current < amt) return false;
    users[id].balance = parseFloat((current - amt).toFixed(2));
    saveUsers(users);
    return users[id].balance;
}

function incrementQueries(userId) {
    const users = loadUsers();
    const id = String(userId);
    if (users[id]) {
        users[id].queries_count = (users[id].queries_count || 0) + 1;
        saveUsers(users);
    }
}

// ─── Settings ───────────────────────────────────────────────────────────────
const defaultSettings = {
    admin_ids: [7994736557],
    force_channel_username: config.FORCE_CHANNEL_USERNAME || "@freefireofficialinfoupdates",
    force_channel_link: config.FORCE_CHANNEL_LINK || "https://t.me/freefireofficialinfoupdates",
    force_join_enabled: true,
    default_region: "IND",
    support_link: "https://t.me/RajCoderFf",
    server_login_base_url: "http://78.154.103.31:9133/",
    link_play_game_pc: "https://t.me/RajCoderFf",
    link_30_day_ban: "https://t.me/freefireofficialinfoupdates",
    link_how_to_get_token: "https://t.me/RajCoderFf",
    link_follow_instagram: "https://t.me/RajCoderFf"
};

function getSettings() {
    try {
        if (!fs.existsSync(SETTINGS_PATH)) {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
            return defaultSettings;
        }
        const data = fs.readFileSync(SETTINGS_PATH, "utf8");
        return { ...defaultSettings, ...JSON.parse(data || "{}") };
    } catch {
        return defaultSettings;
    }
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        return true;
    } catch (e) {
        console.error("Error saving settings:", e);
        return false;
    }
}

function isAdmin(userId) {
    const s = getSettings();
    const numericId = parseInt(userId);
    return (s.admin_ids && s.admin_ids.includes(numericId)) || (config.ADMIN_IDS && config.ADMIN_IDS.includes(numericId));
}

// ─── Gateway ────────────────────────────────────────────────────────────────
const defaultGateway = {
    paytm: {
        enabled: true,
        mid: "",
        merchant_key: "",
        upi_id: "rajcoderff@paytm",
        merchant_name: "FREE FIRE UNBAN SERVICES",
        auto_verify: true
    }
};

function getGateway() {
    try {
        if (!fs.existsSync(GATEWAY_PATH)) {
            fs.writeFileSync(GATEWAY_PATH, JSON.stringify(defaultGateway, null, 2));
            return defaultGateway;
        }
        const data = fs.readFileSync(GATEWAY_PATH, "utf8");
        return { ...defaultGateway, ...JSON.parse(data || "{}") };
    } catch {
        return defaultGateway;
    }
}

function saveGateway(gw) {
    try {
        fs.writeFileSync(GATEWAY_PATH, JSON.stringify(gw, null, 2));
        return true;
    } catch (e) {
        console.error("Error saving gateway:", e);
        return false;
    }
}

// ─── Orders ─────────────────────────────────────────────────────────────────
function loadOrders() {
    try {
        if (!fs.existsSync(ORDERS_PATH)) {
            fs.writeFileSync(ORDERS_PATH, JSON.stringify({}, null, 2));
            return {};
        }
        const data = fs.readFileSync(ORDERS_PATH, "utf8");
        return JSON.parse(data || "{}");
    } catch {
        return {};
    }
}

function saveOrders(orders) {
    try {
        fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
    } catch (e) {
        console.error("Error saving orders:", e);
    }
}

function createOrder({ userId, username, firstName, ffUid, pkgKey, pkgLabel, amount, purpose = "unban" }) {
    const orders = loadOrders();
    const prefix = purpose === "wallet" ? "TOPUP" : "ORD";
    const orderId = `${prefix}${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const now = new Date();
    const order = {
        id: orderId,
        purpose: purpose, // "unban" or "wallet"
        user_id: userId,
        username: username || "Unknown",
        first_name: firstName || "Player",
        ff_uid: ffUid || "N/A",
        package_key: pkgKey || "wallet_topup",
        package_label: pkgLabel || "Wallet Top-up",
        amount: parseFloat(amount),
        status: "PENDING", // PENDING, PAID, CANCELLED, EXPIRED
        created_at: now.toISOString(),
        created_formatted: now.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
            timeZone: "Asia/Kolkata",
        }),
        paid_at: null,
        paid_formatted: null,
        txn_id: null,
        gateway: "paytm"
    };
    orders[orderId] = order;
    saveOrders(orders);
    return order;
}

function getOrder(orderId) {
    const orders = loadOrders();
    return orders[orderId] || null;
}

function getAllOrders() {
    return loadOrders();
}

function getPendingOrders() {
    const orders = loadOrders();
    const now = Date.now();
    return Object.values(orders).filter(o => o.status === "PENDING" && (now - new Date(o.created_at).getTime()) < 30 * 60 * 1000);
}

function updateOrderStatus(orderId, status, details = {}) {
    const orders = loadOrders();
    if (orders[orderId]) {
        orders[orderId].status = status;
        if (status === "PAID") {
            const now = new Date();
            orders[orderId].paid_at = now.toISOString();
            orders[orderId].paid_formatted = now.toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
                timeZone: "Asia/Kolkata",
            });
            if (details.txn_id) orders[orderId].txn_id = details.txn_id;
        }
        saveOrders(orders);
        return orders[orderId];
    }
    return null;
}

module.exports = {
    // Users & Wallet
    registerUser,
    getUser,
    getUserBalance,
    addBalance,
    deductBalance,
    incrementQueries,
    loadUsers,
    // Settings
    getSettings,
    saveSettings,
    isAdmin,
    // Gateway
    getGateway,
    saveGateway,
    // Orders
    createOrder,
    getOrder,
    getAllOrders,
    getPendingOrders,
    updateOrderStatus,
    // Sessions (Ban Login)
    saveSession,
    getSession,
    deleteSession,
    loadSessions
};
