const fs = require("fs");
const path = require("path");

const PLANS_FILE = path.join(__dirname, "../data/like_plans.json");

const defaultPlans = {
    "1day": {
        key: "1day",
        days: 1,
        likes: "220+",
        price: 25,
        label: "1 ᴅᴀʏ — 220+ ʟɪᴋᴇꜱ (₹25)"
    },
    "3day": {
        key: "3day",
        days: 3,
        likes: "700+",
        price: 60,
        label: "3 ᴅᴀʏꜱ — 700+ ʟɪᴋᴇꜱ (₹60)"
    },
    "7day": {
        key: "7day",
        days: 7,
        likes: "1500+",
        price: 120,
        label: "7 ᴅᴀʏꜱ — 1500+ ʟɪᴋᴇꜱ (₹120)"
    }
};

function getLikePlans() {
    try {
        if (!fs.existsSync(PLANS_FILE)) {
            fs.writeFileSync(PLANS_FILE, JSON.stringify(defaultPlans, null, 2));
            return defaultPlans;
        }
        const data = fs.readFileSync(PLANS_FILE, "utf8");
        return JSON.parse(data || "{}");
    } catch {
        return defaultPlans;
    }
}

function saveLikePlans(plans) {
    try {
        fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to save like plans:", e);
        return false;
    }
}

function addLikePlan(key, days, likes, price) {
    const plans = getLikePlans();
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
    plans[cleanKey] = {
        key: cleanKey,
        days: parseInt(days),
        likes: String(likes),
        price: parseInt(price),
        label: `${days} ᴅᴀʏ${parseInt(days) > 1 ? "ꜱ" : ""} — ${likes} ʟɪᴋᴇꜱ (₹${price})`
    };
    return saveLikePlans(plans);
}

function updateLikePlanPrice(key, price) {
    const plans = getLikePlans();
    if (plans[key]) {
        plans[key].price = parseInt(price);
        plans[key].label = `${plans[key].days} ᴅᴀʏ${plans[key].days > 1 ? "ꜱ" : ""} — ${plans[key].likes} ʟɪᴋᴇꜱ (₹${price})`;
        return saveLikePlans(plans);
    }
    return false;
}

function deleteLikePlan(key) {
    const plans = getLikePlans();
    if (plans[key]) {
        delete plans[key];
        return saveLikePlans(plans);
    }
    return false;
}

module.exports = {
    getLikePlans,
    addLikePlan,
    updateLikePlanPrice,
    deleteLikePlan
};
