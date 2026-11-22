const fs = require("fs");
const path = require("path");

const PLANS_FILE = path.join(__dirname, "../data/glory_plans.json");

const defaultPlans = {
    "1bot": {
        key: "1bot",
        bots: 1,
        glory: "2400",
        price: 250,
        label: "1 ʙᴏᴛ — 2400 ɢʟᴏʀʏ (₹250)"
    },
    "2bot": {
        key: "2bot",
        bots: 2,
        glory: "4800",
        price: 480,
        label: "2 ʙᴏᴛꜱ — 4800 ɢʟᴏʀʏ (₹480)"
    },
    "5bot": {
        key: "5bot",
        bots: 5,
        glory: "12000",
        price: 1100,
        label: "5 ʙᴏᴛꜱ — 12000 ɢʟᴏʀʏ (₹1100)"
    }
};

function getGloryPlans() {
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

function saveGloryPlans(plans) {
    try {
        fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to save glory plans:", e);
        return false;
    }
}

function addGloryPlan(key, bots, glory, price) {
    const plans = getGloryPlans();
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
    plans[cleanKey] = {
        key: cleanKey,
        bots: parseInt(bots),
        glory: String(glory),
        price: parseInt(price),
        label: `${bots} ʙᴏᴛ${parseInt(bots) > 1 ? "ꜱ" : ""} — ${glory} ɢʟᴏʀʏ (₹${price})`
    };
    return saveGloryPlans(plans);
}

function updateGloryPlanPrice(key, price) {
    const plans = getGloryPlans();
    if (plans[key]) {
        plans[key].price = parseInt(price);
        plans[key].label = `${plans[key].bots} ʙᴏᴛ${plans[key].bots > 1 ? "ꜱ" : ""} — ${plans[key].glory} ɢʟᴏʀʏ (₹${price})`;
        return saveGloryPlans(plans);
    }
    return false;
}

function deleteGloryPlan(key) {
    const plans = getGloryPlans();
    if (plans[key]) {
        delete plans[key];
        return saveGloryPlans(plans);
    }
    return false;
}

module.exports = {
    getGloryPlans,
    addGloryPlan,
    updateGloryPlanPrice,
    deleteGloryPlan
};
