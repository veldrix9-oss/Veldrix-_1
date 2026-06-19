require('dotenv').config({ path: './config.env' });
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ========== CONFIG ==========
const PORT = process.env.PORT || 3000;
const SESSION_FOLDER = './session';
const PREFIX = process.env.PREFIX || '!';
const OWNER = process.env.OWNER_NUMBER || '255748529340';
const BOT_NAME = 'Veldrix_1';
const DEVELOPER = 'Quillian';

const app = express();
app.use(express.json());

let sock = null;
let isConnected = false;
let startTime = Date.now();
let pairingAttempted = false;

// ========== FUNCTIONS ==========

// AI Response (using a free API)
async function getAIResponse(query) {
    try {
        const response = await axios.get(`https://api.veldbot.xyz/ai?query=${encodeURIComponent(query)}`);
        return response.data?.reply || 'Samahani, sikuelewa. Jaribu tena.';
    } catch {
        return null; // fallback to search
    }
}

// ========== SEARCH SPIDER (Crawler) ==========
async function searchWeb(query) {
    try {
        // Use DuckDuckGo Instant Answer API (free, no key)
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        // Check for abstract text
        if (data.AbstractText && data.AbstractText.length > 0) {
            return {
                success: true,
                answer: data.AbstractText,
                source: data.AbstractURL || 'https://duckduckgo.com',
                title: data.Heading || query
            };
        }

        // Fallback: Related Topics
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            for (const topic of data.RelatedTopics) {
                if (topic.Text) {
                    return {
                        success: true,
                        answer: topic.Text,
                        source: topic.FirstURL || 'https://duckduckgo.com',
                        title: query
                    };
                }
            }
        }

        // If no answer, try to scrape a snippet from a search engine (optional)
        // For now, return null
        return null;
    } catch (error) {
        console.error('[Search Error]', error.message);
        return null;
    }
}

// ========== WHATSAPP CONNECTION ==========
async function connectToWhatsApp() {
    console.log(`[${BOT_NAME}] Connecting to WhatsApp...`);
    if (!fs.existsSync(SESSION_FOLDER)) fs.mkdirSync(SESSION_FOLDER);

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
        emitOwnEvents: true,
        fireInitQueries: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if ((connection === 'connecting' || qr) && !state.creds.registered && !pairingAttempted) {
            pairingAttempted = true;
            console.log(`[${BOT_NAME}] 🔑 Requesting pairing code...`);
            const phoneNumber = OWNER.replace(/\D/g, '');
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));
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
            } else {
                console.log(`[${BOT_NAME}] 🔄 Reconnecting in 10 seconds...`);
                pairingAttempted = false;
            }
            setTimeout(() => connectToWhatsApp(), 10000);
        }

        if (connection === 'open') {
            isConnected = true;
            console.log(`[${BOT_NAME}] ✅ Bot is online!`);
            console.log(`[${BOT_NAME}] 💬 Send !menu to see commands`);
        }
    });

    // ========== MESSAGE HANDLER ==========
    sock.ev.on('messages.upsert', async (msg) => {
        const m = msg.messages[0];
        if (!m.message || m.key.fromMe) return;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        const sender = m.key.remoteJid;

        if (text.startsWith(PREFIX)) {
            const cmd = text.slice(PREFIX.length).trim().toLowerCase();
            const args = cmd.split(' ');
            const mainCmd = args[0];
            const query = args.slice(1).join(' ');

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
║ !search <query>   ║
║ !ai <question>    ║
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
• Bot: ${isConnected ? '✅ Online' : '❌ Offline'}
• Uptime: ${uptime}s
• Owner: ${OWNER}
• Developer: ${DEVELOPER}
• Session: ${fs.existsSync(path.join(SESSION_FOLDER, 'creds.json')) ? '✅ Active' : '❌ None'}`
                    });
                    break;
                }

                case 'owner':
                    await sock.sendMessage(sender, { text: `👤 Owner: ${OWNER}\n👨‍💻 Developer: ${DEVELOPER}` });
                    break;

                // ========== SEARCH COMMAND ==========
                case 'search':
                    if (!query) {
                        await sock.sendMessage(sender, { text: '📝 Tafadhali ingiza swali lako. Mfano: !search nani aliyegundua simu?' });
                        break;
                    }
                    await sock.sendMessage(sender, { text: `🔍 *Inatafuta:* ${query}...` });
                    const result = await searchWeb(query);
                    if (result && result.success) {
                        await sock.sendMessage(sender, {
                            text: `🔍 *${result.title}*\n\n${result.answer}\n\n🔗 [Chanzo](${result.source})`
                        });
                    } else {
                        await sock.sendMessage(sender, { text: `❌ Hakuna matokeo kwa "${query}". Jaribu swali jingine.` });
                    }
                    break;

                // ========== AI COMMAND (with fallback to search) ==========
                case 'ai':
                    if (!query) {
                        await sock.sendMessage(sender, { text: '📝 Tafadhali ingiza swali lako. Mfano: !ai nani aliyegundua simu?' });
                        break;
                    }
                    await sock.sendMessage(sender, { text: `🤖 *Bot inatafuta jibu...*` });
                    let aiReply = await getAIResponse(query);
                    if (!aiReply) {
                        // If AI fails, use search
                        const searchResult = await searchWeb(query);
                        if (searchResult && searchResult.success) {
                            aiReply = `🔍 *${searchResult.title}*\n\n${searchResult.answer}\n\n🔗 [Chanzo](${searchResult.source})`;
                        } else {
                            aiReply = `❌ Samahani, sikuweza kupata jibu la "${query}". Jaribu swali jingine.`;
                        }
                    }
                    await sock.sendMessage(sender, { text: aiReply });
                    break;

                default:
                    await sock.sendMessage(sender, { text: 'Unknown command. Type !menu for help.' });
                    break;
            }
        }
        // ========== AUTO AI FOR NON-COMMAND MESSAGES ==========
        else {
            // If chatbot is enabled (we set CHATBOT environment variable)
            // But we'll keep it simple: if the message is a question, we can search
            // For now, we only respond to commands.
            // You can enable this by uncommenting:
            /*
            if (process.env.CHATBOT === 'true') {
                const reply = await getAIResponse(text);
                if (reply) await sock.sendMessage(sender, { text: reply });
            }
            */
        }
    });

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
            <p>Session: ${fs.existsSync(path.join(SESSION_FOLDER, 'creds.json')) ? '✅ Active' : '❌ None'}</p>
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
        session: fs.existsSync(path.join(SESSION_FOLDER, 'creds.json')),
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`[${BOT_NAME}] 🌐 Web dashboard running on port ${PORT}`);
});

// ========== START ==========
connectToWhatsApp().catch(err => {
    console.error(`[${BOT_NAME}] ❌ Fatal error:`, err);
    setTimeout(() => connectToWhatsApp(), 10000);
});
