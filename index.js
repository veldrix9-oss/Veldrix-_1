require('dotenv').config({ path: './config.env' });
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ========== CONFIG ==========
const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
const SESSION_FOLDER = './session';
const PREFIX = process.env.PREFIX || '!';
const OWNER = process.env.OWNER_NUMBER || '255748529340';
const BOT_NAME = 'Veldrix_1';
const DEVELOPER = 'Quillian';

// Vipengele – zote zimewashwa kwa default ikiwa hazijawekwa .env
const AUTO_REACT = process.env.AUTO_REACT === 'true' ? true : false;
const AUTO_REACT_DM = process.env.AUTO_REACT_DM === 'true' ? true : false;
const AUTO_REACT_GRP = process.env.AUTO_REACT_GRP === 'true' ? true : false;
const AUTO_READ = process.env.AUTO_READ === 'true' ? true : false;
const CHATBOT = process.env.CHATBOT === 'true' ? true : false;
const ANTICALL = process.env.ANTICALL === 'true' ? true : false;
const ANTILINK = process.env.ANTILINK === 'true' ? true : false;
const ANTITAG = process.env.ANTITAG === 'true' ? true : false;
const GREET = process.env.GREET === 'true' ? true : false;

// ========== EXPRESS ==========
const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;
let startTime = Date.now();
let pairingAttempted = false;
let reconnectTimeout = null;

// ========== AI FUNCTION ==========
async function getAIResponse(query) {
    try {
        const response = await axios.get(`https://api.veldbot.xyz/ai?query=${encodeURIComponent(query)}`);
        return response.data?.reply || 'Samahani, sikuelewa. Jaribu tena.';
    } catch {
        return 'Samahani, kuna tatizo la kiufundi. Jaribu tena baadaye.';
    }
}

// ========== WHATSAPP CONNECTION ==========
async function connectToWhatsApp() {
    console.log(`[${BOT_NAME}] Connecting to WhatsApp...`);
    if (!fs.existsSync(SESSION_FOLDER)) fs.mkdirSync(SESSION_FOLDER);

    if (process.env.SESSION && process.env.SESSION.length > 10) {
        try {
            const credsBuffer = Buffer.from(process.env.SESSION, 'base64');
            const credsJson = JSON.parse(credsBuffer.toString());
            fs.writeFileSync(path.join(SESSION_FOLDER, 'creds.json'), JSON.stringify(credsJson, null, 2));
            console.log(`[${BOT_NAME}] ✅ Session restored from SESSION_ID`);
        } catch (e) {
            console.warn(`[${BOT_NAME}] ⚠️ Invalid SESSION_ID, will generate new session`);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[${BOT_NAME}] Using Baileys version: ${version.join('.')}`);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        version: version,
        logger: pino({ level: 'silent' }),
        browser: [BOT_NAME, 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if ((connection === 'connecting' || update.qr) && !state.creds.registered && !pairingAttempted) {
            pairingAttempted = true;
            console.log(`[${BOT_NAME}] Requesting pairing code...`);
            const phoneNumber = OWNER.replace(/\D/g, '');
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`[${BOT_NAME}] 📱 Your pairing code: ${code}`);
                console.log(`[${BOT_NAME}] 👉 Open WhatsApp → Linked Devices → Link with phone number`);
            } catch (err) {
                console.error(`[${BOT_NAME}] ❌ Pairing code request failed:`, err.message);
                pairingAttempted = false;
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            isConnected = false;
            console.log(`[${BOT_NAME}] ❌ Connection closed. Code: ${statusCode || 'unknown'}`);
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[${BOT_NAME}] 🔄 Logged out, deleting session...`);
                try { fs.rmSync(SESSION_FOLDER, { recursive: true, force: true }); } catch (e) {}
                pairingAttempted = false;
                clearTimeout(reconnectTimeout);
                reconnectTimeout = setTimeout(() => connectToWhatsApp(), 5000);
            } else {
                pairingAttempted = false;
                clearTimeout(reconnectTimeout);
                reconnectTimeout = setTimeout(() => connectToWhatsApp(), 10000);
            }
        }

        if (connection === 'open') {
            isConnected = true;
            console.log(`[${BOT_NAME}] ✅ Bot is online!`);
        }
    });

    // ========== MESSAGE HANDLER ==========
    sock.ev.on('messages.upsert', async (msg) => {
        const m = msg.messages[0];
        if (!m.message || m.key.fromMe) return;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const sender = m.key.remoteJid;
        const isGroup = sender.endsWith('@g.us');

        // ===== COMMANDS =====
        if (text.startsWith(PREFIX)) {
            const cmd = text.slice(PREFIX.length).trim().toLowerCase();
            const args = cmd.split(' ');
            const mainCmd = args[0];
            const subCmd = args[1] || '';

            switch (mainCmd) {
                case 'menu':
                    await sock.sendMessage(sender, {
                        text: `╔══════════════════╗
   ${BOT_NAME}
╠══════════════════╣
║ !menu - Show this ║
║ !ping - Test     ║
║ !status - Bot info║
║ !owner - Contact  ║
║ !autoreact on/off ║
║ !chatbot on/off  ║
║ !autoread on/off ║
║ !anticall on/off ║
║ !antilink on/off ║
║ !greet on/off   ║
╚══════════════════╝`
                    });
                    break;

                case 'ping':
                    await sock.sendMessage(sender, { text: '🏓 Pong!' });
                    break;

                case 'status': {
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    await sock.sendMessage(sender, {
                        text: `📊 Status:
• Bot: ${isConnected ? 'Online ✅' : 'Offline ❌'}
• Uptime: ${uptime}s
• Owner: ${OWNER}
• Developer: ${DEVELOPER}
• AutoReact: ${(AUTO_REACT || global.features?.autoReact) ? 'ON' : 'OFF'}
• Chatbot: ${(CHATBOT || global.features?.chatbot) ? 'ON' : 'OFF'}
• AutoRead: ${(AUTO_READ || global.features?.autoRead) ? 'ON' : 'OFF'}
• AntiCall: ${(ANTICALL || global.features?.antiCall) ? 'ON' : 'OFF'}
• AntiLink: ${(ANTILINK || global.features?.antiLink) ? 'ON' : 'OFF'}
• Greet: ${(GREET || global.features?.greet) ? 'ON' : 'OFF'}`
                    });
                    break;
                }

                case 'owner':
                    await sock.sendMessage(sender, { text: `👤 Owner: ${OWNER}\n👨‍💻 Developer: ${DEVELOPER}` });
                    break;

                // Toggles
                case 'autoreact':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.autoReact = state;
                        await sock.sendMessage(sender, { text: `✅ AutoReact turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !autoreact on/off' });
                    }
                    break;

                case 'chatbot':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.chatbot = state;
                        await sock.sendMessage(sender, { text: `✅ Chatbot turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !chatbot on/off' });
                    }
                    break;

                case 'autoread':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.autoRead = state;
                        await sock.sendMessage(sender, { text: `✅ AutoRead turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !autoread on/off' });
                    }
                    break;

                case 'anticall':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.antiCall = state;
                        await sock.sendMessage(sender, { text: `✅ AntiCall turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !anticall on/off' });
                    }
                    break;

                case 'antilink':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.antiLink = state;
                        await sock.sendMessage(sender, { text: `✅ AntiLink turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !antilink on/off' });
                    }
                    break;

                case 'greet':
                    if (subCmd === 'on' || subCmd === 'off') {
                        const state = subCmd === 'on';
                        if (!global.features) global.features = {};
                        global.features.greet = state;
                        await sock.sendMessage(sender, { text: `✅ Greet turned ${subCmd.toUpperCase()}` });
                    } else {
                        await sock.sendMessage(sender, { text: 'Usage: !greet on/off' });
                    }
                    break;

                default:
                    await sock.sendMessage(sender, { text: 'Unknown command. Type !menu for help.' });
                    break;
            }
        }
        // ===== NON-COMMAND FEATURES =====
        else {
            // Auto React
            const shouldReact = (AUTO_REACT || global.features?.autoReact) &&
                (isGroup ? AUTO_REACT_GRP : AUTO_REACT_DM);
            if (shouldReact) {
                const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🥰'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await sock.sendMessage(sender, { react: { text: randomEmoji, key: m.key } });
            }

            // Auto Read
            if (AUTO_READ || global.features?.autoRead) {
                await sock.readMessages([m.key]);
            }

            // Chatbot (AI) – only if not a command
            if (CHATBOT || global.features?.chatbot) {
                const reply = await getAIResponse(text);
                await sock.sendMessage(sender, { text: reply });
            }

            // Anti-Link – check for links in message
            if (ANTILINK || global.features?.antiLink) {
                const urlPattern = /(https?:\/\/[^\s]+)/g;
                if (urlPattern.test(text)) {
                    await sock.sendMessage(sender, { text: '⚠️ Links are not allowed in this chat!' });
                }
            }

            // Anti-Tag – check if tagged someone
            if (ANTITAG || global.features?.antiTag) {
                if (m.message.extendedTextMessage?.contextInfo?.mentionedJid) {
                    await sock.sendMessage(sender, { text: '⚠️ Tagging is not allowed!' });
                }
            }
        }
    });

    // ========== ANTI-CALL ==========
    if (ANTICALL || global.features?.antiCall) {
        sock.ev.on('call', async (call) => {
            await sock.rejectCall(call.id, call.from);
            console.log(`[${BOT_NAME}] Rejected call from ${call.from}`);
        });
    }

    return sock;
}

// ========== WEB SERVER ==========
app.get('/', (req, res) => {
    res.send(`
        <html><head><title>${BOT_NAME} - Status</title></head>
        <body style="background:#0d0d0d; color:#00ffcc; font-family:monospace; padding:20px;">
            <h1>🚀 ${BOT_NAME}</h1>
            <p>Status: <span style="color:${isConnected ? '#00ff00' : '#ff0000'}">${isConnected ? 'ONLINE' : 'OFFLINE'}</span></p>
            <p>Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s</p>
            <p>Owner: ${OWNER}</p>
            <p>Developer: ${DEVELOPER}</p>
            <p>Session: ${fs.existsSync(path.join(SESSION_FOLDER, 'creds.json')) ? 'Active' : 'None'}</p>
            <hr><p><a href="/status" style="color:#00ffcc;">JSON Status</a></p>
            <p style="margin-top:30px; color:#888;">${BOT_NAME} © 2026 | ${DEVELOPER}</p>
        </body></html>
    `);
});

app.get('/status', (req, res) => {
    res.json({
        status: isConnected ? 'online' : 'offline',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        owner: OWNER,
        developer: DEVELOPER,
        features: {
            autoReact: AUTO_REACT || global.features?.autoReact || false,
            chatbot: CHATBOT || global.features?.chatbot || false,
            autoRead: AUTO_READ || global.features?.autoRead || false,
            antiCall: ANTICALL || global.features?.antiCall || false,
            antiLink: ANTILINK || global.features?.antiLink || false,
            greet: GREET || global.features?.greet || false,
        },
        session: fs.existsSync(path.join(SESSION_FOLDER, 'creds.json')),
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`[${BOT_NAME}] Web dashboard running on port ${PORT}`);
});

// ========== START BOT ==========
connectToWhatsApp().catch(console.error);
