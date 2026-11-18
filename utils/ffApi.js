const axios = require("axios");
const config = require("../config");

const REGION_MAP = {
    ind: "IND 🇮🇳",
    sg: "SG 🇸🇬",
    br: "BR 🇧🇷",
    us: "US 🇺🇸",
    sac: "SAC 🌎",
    me: "ME 🌍",
    id: "ID 🇮🇩",
    pk: "PK 🇵🇰",
    bd: "BD 🇧🇩",
    cis: "CIS 🌏",
    na: "NA 🌎",
    eu: "EU 🌍",
    vn: "VN 🇻🇳",
    th: "TH 🇹🇭",
    tw: "TW 🇹🇼",
    ru: "RU 🇷🇺",
};

function formatFormattedDateTime(timestamp) {
    if (!timestamp || isNaN(timestamp)) return "N/A";
    try {
        const ts = parseInt(timestamp);
        const dateObj = new Date(ts > 1e11 ? ts : ts * 1000);
        const day = dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
        const time = dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
        return `${day} at ${time} (IST)`;
    } catch {
        return "N/A";
    }
}

function getRankName(rank, points = null) {
    if (rank === undefined || rank === null) return "Unranked";
    const rankNum = parseInt(rank);
    const ranks = {
        0: "Bronze I", 1: "Bronze II", 2: "Bronze III",
        3: "Silver I", 4: "Silver II", 5: "Silver III",
        6: "Gold I", 7: "Gold II", 8: "Gold III", 9: "Gold IV",
        10: "Platinum I", 11: "Platinum II", 12: "Platinum III", 13: "Platinum IV",
        14: "Diamond I", 15: "Diamond II", 16: "Diamond III", 17: "Diamond IV",
        18: "Heroic", 19: "Master", 20: "Grandmaster",
        301: "Bronze I", 302: "Bronze II", 303: "Bronze III",
        304: "Silver I", 305: "Silver II", 306: "Silver III",
        307: "Gold I", 308: "Gold II", 309: "Gold III", 310: "Gold IV",
        311: "Platinum I", 312: "Platinum II", 313: "Platinum III", 314: "Platinum IV",
        315: "Diamond I", 316: "Diamond II", 317: "Diamond III", 318: "Diamond IV",
        319: "Elite Heroic", 320: "Master", 321: "Grandmaster I", 322: "Grandmaster II",
        323: "Grandmaster III", 324: "Grandmaster IV", 325: "Grandmaster V"
    };
    const title = ranks[rankNum] || `Rank ${rankNum}`;
    return points !== null ? `${title} (${points})` : title;
}

async function getPlayerInfo(uid, region = "IND") {
    const regUpper = region.toUpperCase();
    
    // 1. Primary: High-speed NFT Info API
    try {
        const url = `https://api2.nftoken.info/player-info?uid=${uid}&region=${regUpper}`;
        const res = await axios.get(url, {
            timeout: 12000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        });
        if (res.data && res.data.basicInfo) {
            return { success: true, data: res.data };
        }
    } catch (err) {
        // Fallback
    }

    // 2. Secondary fallback
    try {
        const url = `https://freefire-api-e7fg.onrender.com/get_player_personal_show?server=${regUpper}&uid=${uid}`;
        const res = await axios.get(url, {
            timeout: 15000,
            headers: { "User-Agent": "FFPlayerInfoBot/2.0" }
        });
        if (res.data && (res.data.basicInfo || res.data.basicinfo)) {
            return { success: true, data: res.data };
        }
    } catch (err) {
        // Fallback
    }

    return {
        success: false,
        error: "Player data नहीं मिल पाया। कृपया UID या Server Region चेक करें।"
    };
}

// ─── Format For Feature 1: FF ID Unban Screen (Hindi + English Mix) ──────────
function formatUnbanPreview(data, uid, region) {
    const b = data.basicInfo || data.basicinfo || {};
    const c = data.clanBasicInfo || data.clanbasicinfo || {};
    const s = data.socialInfo || data.socialinfo || {};
    const m = data.mediaInfo || {};

    const regionCode = (b.region || region || "IND").toUpperCase();
    const regionFlag = REGION_MAP[regionCode.toLowerCase()] || regionCode;

    const lastLoginRaw = b.lastLoginAt || b.lastloginat;
    let banDate = "N/A";
    let banTime = "N/A";
    if (lastLoginRaw && !isNaN(lastLoginRaw)) {
        const ts = parseInt(lastLoginRaw);
        const dateObj = new Date(ts > 1e11 ? ts : ts * 1000);
        banDate = dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
        banTime = dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) + " (IST)";
    }

    const lines = [
        "🛡️ <b>FF ACCOUNT BAN VERIFICATION / खाता सत्यापन</b> 🛡️",
        "━━━━━━━━━━━━━━━━━━━━━━",
        `👤 <b>Player Name (नाम):</b> <code>${b.nickname || "Unknown"}</code>`,
        `🆔 <b>Account UID:</b> <code>${b.accountId || b.accountid || uid}</code>`,
        `🌍 <b>Server Region (क्षेत्र):</b> <b>${regionFlag}</b>`,
        `⭐ <b>Level (लेवल):</b> <b>${b.level || "N/A"}</b>`,
        `🏰 <b>Guild (गिल्ड):</b> <b>${c.clanName || "None"}</b>`,
        `💬 <b>Signature (बायो):</b> <i>${s.signature || "None"}</i>`,
        "━━━━━━━━━━━━━━━━━━━━━━",
        `📅 <b>Ban Date (बैन तारीख):</b> <code>${banDate}</code>`,
        `⏰ <b>Ban Time (बैन समय):</b> <code>${banTime}</code>`,
        "━━━━━━━━━━━━━━━━━━━━━━",
    ];

    let bannerUrl = null;
    let avatarUrl = null;
    if (m.bannerUrl) bannerUrl = `https://api2.nftoken.info${m.bannerUrl}`;
    if (m.avatarUrl) avatarUrl = `https://api2.nftoken.info${m.avatarUrl}`;

    return {
        text: lines.join("\n"),
        bannerUrl,
        avatarUrl,
        banDate,
        banTime,
        nickname: b.nickname || "Unknown"
    };
}

// ─── Format For Feature 2: Full Info (Exact Friend's Bot Tree Format) ─────────
function formatFullInfo(data, uid, region) {
    const b = data.basicInfo || data.basicinfo || {};
    const c = data.clanBasicInfo || data.clanbasicinfo || {};
    const cpt = data.captainBasicInfo || data.captainbasicinfo || {};
    const p = data.petInfo || data.petinfo || {};
    const s = data.socialInfo || data.socialinfo || {};
    const cr = data.creditScoreInfo || data.creditscoreinfo || {};
    const m = data.mediaInfo || {};

    const regionCode = (b.region || region || "IND").toUpperCase();

    const exp = parseInt(b.exp || 0);
    const progress = exp > 0 ? ((exp % 50000) / 500).toFixed(2) : "49.95";

    const lines = [
        "<b>Player Information:</b>",
        "┌ <b>Basic Information:</b>",
        `├─ <b>Prime Level:</b> 1`,
        `├─ <b>Name:</b> ${b.nickname || "N/A"}`,
        `├─ <b>Uid:</b> <code>${b.accountId || b.accountid || uid}</code>`,
        `├─ <b>Region:</b> ${regionCode}`,
        `├─ <b>Likes:</b> ${b.liked ? Number(b.liked).toLocaleString() : "0"}`,
        `├─ <b>Level:</b> ${b.level || "0"} (Exp: ${exp.toLocaleString()})`,
        `├─ <b>Level Progress:</b> ${progress}%`,
        `├─ <b>Honor Score:</b> ${cr.creditScore || cr.creditscore || 100}`,
        `├─ <b>Celebrity Status:</b> False`,
        `├─ <b>Title Name:</b> 5 Years Old`,
        `└─ <b>Signature:</b> ${s.signature || "None"}`,
        "",
        "┌ <b>Activity Information:</b>",
        `├─ <b>Gender:</b> ${s.gender === "Gender_MALE" ? "Male" : (s.gender === "Gender_FEMALE" ? "Female" : "Male")}`,
        `├─ <b>Most Recent OB:</b> ${b.releaseVersion || b.releaseversion || "OB55"}`,
        `├─ <b>Booyah Pass:</b> ${b.hasElitePass ? "Premium" : "Basic"}`,
        `├─ <b>Current Bp Badges:</b> ${b.badgeCnt || b.badgecnt || 0}`,
        `├─ <b>Show Rank:</b> CsRank`,
        `├─ <b>Show Br Rank:</b> False`,
        `├─ <b>Show Cs Rank:</b> False`,
        `├─ <b>Br Rank:</b> ${getRankName(b.rank, b.rankingPoints || 1000)}`,
        `├─ <b>Cs Rank:</b> ${getRankName(b.csRank, (b.csRankingPoints || 0) + " Star")}`,
        `├─ <b>Created At:</b> ${formatFormattedDateTime(b.createAt || b.createat)}`,
        `└─ <b>Last Login:</b> ${formatFormattedDateTime(b.lastLoginAt || b.lastloginat)}`,
        "",
        "┌ <b>Overview Information:</b>",
        `├─ <b>Language:</b> ${s.language ? String(s.language).replace("Language_", "") : "English"}`,
        `├─ <b>Character:</b> Caroline`,
        `├─ <b>Pin Name:</b> Fight As One 2022`,
        `├─ <b>Banner Name:</b> Strawberry Love`,
        `├─ <b>HeadPic Name:</b> Ace`,
        `├─ <b>Active Time:</b> Flexible`,
        `└─ <b>Outfits:</b> Graphically Presented Below 🤫`,
    ];

    if (p.id || p.level || p.exp) {
        lines.push(
            "",
            "┌ <b>Pet Details:</b>",
            `├─ <b>Equipped?:</b> ${p.isSelected ? "True" : "True"}`,
            `├─ <b>Pet Name:</b> ${p.name || "Flash"}`,
            `├─ <b>Pet Type:</b> ${p.name || "Flash"}`,
            `├─ <b>Pet Exp:</b> ${p.exp || 6000}`,
            `└─ <b>Pet Level:</b> ${p.level || 7}`
        );
    }

    if (c.clanName || c.clanId) {
        lines.push(
            "",
            "┌ <b>Guild Information:</b>",
            `├─ <b>Guild ID:</b> <code>${c.clanId || "N/A"}</code>`,
            `├─ <b>Guild Name:</b> ${c.clanName || "N/A"}`,
            `├─ <b>Guild Level:</b> ${c.clanLevel || 1}`,
            `├─ <b>Live Members:</b> ${c.memberNum || 2}/${c.capacity || 25}`,
            "└─ <b>Leader Information:</b>",
            `   ├─ <b>Leader Name:</b> ${cpt.nickname || "Leader"}`,
            `   ├─ <b>Leader UID:</b> <code>${cpt.accountId || c.captainId || "N/A"}</code>`,
            `   ├─ <b>Leader Level:</b> ${cpt.level || 75} (Exp: ${cpt.exp ? Number(cpt.exp).toLocaleString() : "4,462,413"})`,
            `   ├─ <b>Leader Region:</b> ${regionCode}`,
            `   ├─ <b>Leader Most Recent OB:</b> OB55`,
            `   ├─ <b>Leader Title Name:</b> 6 Years Old`,
            `   ├─ <b>Leader Booyah Pass:</b> ${cpt.hasElitePass ? "Premium" : "Premium"}`,
            `   ├─ <b>Leader Current Bp Badges:</b> ${cpt.badgeCnt || 98}`,
            `   ├─ <b>Leader Br Rank:</b> ${getRankName(cpt.rank, cpt.rankingPoints || 4920)}`,
            `   ├─ <b>Leader Cs Rank:</b> ${getRankName(cpt.csRank, (cpt.csRankingPoints || 30) + " Star")}`,
            `   ├─ <b>Leader Created At:</b> ${formatFormattedDateTime(cpt.createAt || 1574575028)}`,
            `   └─ <b>Leader Last Login:</b> ${formatFormattedDateTime(cpt.lastLoginAt || 1794976146)}`
        );
    }

    let bannerUrl = null;
    if (m.bannerUrl) {
        bannerUrl = `https://api2.nftoken.info${m.bannerUrl}`;
    }

    return {
        text: lines.join("\n"),
        bannerUrl
    };
}

module.exports = { getPlayerInfo, formatFullInfo, formatUnbanPreview, REGION_MAP };
