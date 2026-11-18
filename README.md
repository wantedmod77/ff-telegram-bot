# FF Player Info Telegram Bot 🎮🔥

## Bot Commands
- `/start` → Welcome message
- `/get <uid>` → Player info (IND region default)
- `/get <uid> <region>` → Any region
- `/regions` → All available regions
- `/help` → Help

## Setup Guide (Seedha Hindi mein)

### Step 1: Bot Token Lo
1. Telegram pe **@BotFather** pe jao
2. `/newbot` likhao
3. Bot ka naam likho (e.g. `FF Player Info Bot`)
4. Username likho (e.g. `MyFFInfoBot`)
5. Token copy karo (aisa hoga: `123456789:ABCdef...`)

### Step 2: FF API Key Lo (Free)
1. Browser mein jao: https://developers.freefirecommunity.com
2. Register karo (free hai)
3. API Key generate karo
4. Copy karo

### Step 3: config.js Edit Karo
```js
BOT_TOKEN: "1234567890:ABCdefGHIjklMNOpqrSTUvwxyz",   // 👈 Yahan paste karo
FF_API_KEY: "your-api-key-here",                         // 👈 FF API Key
```

### Step 4: Run Karo
```bash
node index.js
```

---

## Regions Available
| Code | Region |
|------|--------|
| ind | India 🇮🇳 |
| sg | Singapore 🇸🇬 |
| br | Brazil 🇧🇷 |
| us | USA 🇺🇸 |
| pk | Pakistan 🇵🇰 |
| bd | Bangladesh 🇧🇩 |
| id | Indonesia 🇮🇩 |
| me | Middle East 🌍 |
| eu | Europe 🌍 |

---

## Example Usage
```
/get 1234567890
/get 1234567890 ind
/get 1234567890 sg
/get 1234567890 pk
```
