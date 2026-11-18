const fs = require("fs");
const path = require("path");

const PRICING_PATH = path.join(__dirname, "../data/pricing.json");

const defaultPricing = {
    "3day": { label: "3 Day Ban", price: 99 },
    "7day": { label: "7 Day Ban", price: 199 },
    "30day": { label: "30 Day Ban", price: 499 },
    "90day": { label: "90 Day Ban", price: 899 },
    "permanent": { label: "Permanent Ban", price: 999 },
    "blacklist": { label: "Blacklisted", price: 249 }
};

function getPricing() {
    try {
        if (!fs.existsSync(PRICING_PATH)) {
            fs.writeFileSync(PRICING_PATH, JSON.stringify(defaultPricing, null, 2));
            return defaultPricing;
        }
        const data = fs.readFileSync(PRICING_PATH, "utf8");
        return JSON.parse(data || "{}");
    } catch {
        return defaultPricing;
    }
}

function updatePrice(key, price) {
    const current = getPricing();
    if (current[key]) {
        current[key].price = parseInt(price);
        try {
            fs.writeFileSync(PRICING_PATH, JSON.stringify(current, null, 2));
            return true;
        } catch (e) {
            console.error("Failed to update pricing:", e);
            return false;
        }
    }
    return false;
}

function addPackage(key, label, price) {
    const current = getPricing();
    current[key] = { label, price: parseInt(price) };
    try {
        fs.writeFileSync(PRICING_PATH, JSON.stringify(current, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to add package:", e);
        return false;
    }
}

function deletePackage(key) {
    const current = getPricing();
    if (current[key]) {
        delete current[key];
        try {
            fs.writeFileSync(PRICING_PATH, JSON.stringify(current, null, 2));
            return true;
        } catch (e) {
            console.error("Failed to delete package:", e);
            return false;
        }
    }
    return false;
}

module.exports = { getPricing, updatePrice, addPackage, deletePackage };
