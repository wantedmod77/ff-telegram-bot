const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");
const QRCode = require("qrcode");
const config = require("../config");

function makeUpiUri(upiId, merchantName, amount, orderRef) {
    const pa = encodeURIComponent((upiId || "").trim());
    const pn = encodeURIComponent((merchantName || "FREE FIRE UNBAN SERVICES").trim());
    const am = parseFloat(amount).toFixed(2);
    const tn = encodeURIComponent((orderRef || "").trim());
    const tr = encodeURIComponent((orderRef || "").trim());
    return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}&tr=${tr}`;
}

async function generateQrBuffer(payload) {
    return await QRCode.toBuffer(payload, {
        type: "png",
        margin: 2,
        scale: 8,
        color: {
            dark: "#000000",
            light: "#FFFFFF"
        }
    });
}

// Ultra-fast direct sendPhoto via Axios Multipart (Zero Hang-up, ~1.5s response)
async function sendQrPhoto(ctx, upiUri, caption, extraMarkup = null) {
    try {
        const buffer = await generateQrBuffer(upiUri);
        const form = new FormData();
        const chatId = ctx.chat?.id || ctx.from?.id;

        form.append("chat_id", String(chatId));
        form.append("photo", buffer, { filename: "paytm_qr.png", contentType: "image/png" });
        form.append("caption", caption);
        form.append("parse_mode", "HTML");

        if (extraMarkup) {
            form.append("reply_markup", JSON.stringify(extraMarkup));
        }

        const res = await axios.post(
            `https://api.telegram.org/bot${config.BOT_TOKEN}/sendPhoto`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 8000
            }
        );

        return res.data?.result;
    } catch (err) {
        console.error("Fast Axios sendPhoto failed, fallback to Web URL:", err.message);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(upiUri)}`;
        return await ctx.replyWithPhoto(qrUrl, {
            caption: caption,
            parse_mode: "HTML",
            reply_markup: extraMarkup || undefined
        });
    }
}

async function verifyPaytmStatus(mid, key, orderId) {
    mid = (mid || "").trim();
    key = (key || "").trim();
    if (!mid || !key) {
        return { success: false, pending: true, error: "Paytm MID or Merchant Key is not configured." };
    }

    try {
        const data = { MID: mid, ORDERID: String(orderId).trim() };
        const jsonData = JSON.stringify(data);
        const checksum = crypto.createHmac("sha256", key).update(jsonData).digest("hex");
        const postData = new URLSearchParams({
            JsonData: jsonData,
            CHECKSUMHASH: checksum
        }).toString();

        const response = await axios.post("https://securegw.paytm.in/merchant-status/getTxnStatus", postData, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            timeout: 12000
        });

        const res = response.data;
        if (!res || typeof res !== "object") {
            return { success: false, pending: true, error: "Invalid Paytm response" };
        }

        const rawStatus = res.STATUS || res.resultInfo?.resultStatus || res.status || "";
        const status = String(rawStatus).toUpperCase();
        const isSuccess = (status === "TXN_SUCCESS");
        const txnAmount = parseFloat(res.TXNAMOUNT || res.txnAmount || 0);
        const txnId = res.TXNID || res.bankTxnId || "";

        return {
            success: isSuccess,
            pending: (status === "PENDING" || status === "TXN_RUNNING"),
            failed: (status === "TXN_FAILURE" || status === "FAILURE"),
            status: status,
            amount: txnAmount,
            txnId: txnId,
            raw: res
        };
    } catch (err) {
        return { success: false, pending: true, error: err.message };
    }
}

module.exports = {
    makeUpiUri,
    generateQrBuffer,
    sendQrPhoto,
    verifyPaytmStatus
};
