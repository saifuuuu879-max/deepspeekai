const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ======================= CONFIGURATION =======================
const AI_API_KEY = process.env.FIVE_AIR_API_KEY || 'your-api-key-here';
const AI_MODEL = 'z-ai/glm-4.5-air:free';
const AI_ENDPOINT = 'https://api.5air.chat/v1/chat/completions'; // Adjust if needed
const BOT_OWNER = 'SAIF ULLAH';
const OWNER_CONTACT = 'SAIF ULLAH (Owner)'; // Optional

// Store recent status messages (max 20) for download
let recentStatuses = []; // each: { jid, message, timestamp, type, mediaBuffer? we'll fetch on demand }
let viewOnceMessages = new Map(); // key: sender+id, value: message object

// ======================= HELPER: AI REPLY =======================
async function getAIResponse(userMessage, senderName = 'User') {
    if (!AI_API_KEY || AI_API_KEY === 'your-api-key-here') {
        return "⚠️ AI API key not configured. Please set FIVE_AIR_API_KEY environment variable.\n\nUse .menu for commands.";
    }
    try {
        const response = await axios.post(AI_ENDPOINT, {
            model: AI_MODEL,
            messages: [
                { role: "system", content: "You are a helpful WhatsApp assistant named 'JavaGoat AI'. Keep replies short, friendly, and useful. Owner: SAIF ULLAH." },
                { role: "user", content: userMessage }
            ],
            max_tokens: 300,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('AI API Error:', error.message);
        return "🤖 AI service is busy. Try again in a moment. Use .menu for bot commands.";
    }
}

// ======================= FAKE TYPING & RECORDING =======================
async function fakeTyping(sock, jid, duration = 2000) {
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(resolve => setTimeout(resolve, duration));
}

async function fakeRecording(sock, jid, duration = 1500) {
    await sock.sendPresenceUpdate('recording', jid);
    await new Promise(resolve => setTimeout(resolve, duration));
}

// ======================= DOWNLOAD STATUS MEDIA =======================
async function downloadStatusMedia(sock, statusMsg, index) {
    try {
        const buffer = await downloadMediaMessage(statusMsg, 'buffer', {});
        const ext = statusMsg.message?.imageMessage?.mimetype === 'image/jpeg' ? '.jpg' : 
                    statusMsg.message?.videoMessage?.mimetype === 'video/mp4' ? '.mp4' : '.bin';
        const fileName = `status_${Date.now()}_${index}${ext}`;
        const filePath = path.join(__dirname, 'temp', fileName);
        if (!fs.existsSync(path.join(__dirname, 'temp'))) fs.mkdirSync(path.join(__dirname, 'temp'));
        fs.writeFileSync(filePath, buffer);
        return { buffer, fileName, filePath, mimetype: statusMsg.message?.imageMessage?.mimetype || statusMsg.message?.videoMessage?.mimetype };
    } catch (err) {
        console.error('Status download error:', err);
        return null;
    }
}

// ======================= DOWNLOAD VIEW-ONCE MEDIA =======================
async function downloadViewOnce(sock, viewOnceMsg) {
    try {
        const buffer = await downloadMediaMessage(viewOnceMsg, 'buffer', {});
        const ext = viewOnceMsg.message?.viewOnceMessageV2?.message?.imageMessage?.mimetype === 'image/jpeg' ? '.jpg' : 
                    viewOnceMsg.message?.viewOnceMessageV2?.message?.videoMessage?.mimetype === 'video/mp4' ? '.mp4' : '.bin';
        const fileName = `viewonce_${Date.now()}${ext}`;
        const filePath = path.join(__dirname, 'temp', fileName);
        if (!fs.existsSync(path.join(__dirname, 'temp'))) fs.mkdirSync(path.join(__dirname, 'temp'));
        fs.writeFileSync(filePath, buffer);
        return { buffer, fileName, filePath };
    } catch (err) {
        console.error('ViewOnce download error:', err);
        return null;
    }
}

// ======================= SEND HELP MENU =======================
async function sendMenu(sock, jid) {
    const menuText = `🤖 *JAVAGOAT AI BOT* 🤖
━━━━━━━━━━━━━━━━━━━
*Commands:*
.menu - Show this menu
.owner - Bot owner info
.ai <message> - Chat with AI
.statuslist - List recent statuses
.statusdl <number> - Download status (video/photo)
.viewonce - Reply to a view-once msg to download it
━━━━━━━━━━━━━━━━━━━
*Features:*
✅ AI Chat (GLM-4.5-Air)
✅ Fake Typing + Recording simulation
✅ Download Status Videos/Images
✅ Download View-Once (disappearing) media
✅ 24/7 Active (with proper hosting)

_Owner: SAIF ULLAH_`;
    await sock.sendMessage(jid, { text: menuText });
}

// ======================= MAIN BOT =======================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['SAIF BOT', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.clear();
            console.log('\n⚡ SCAN QR CODE TO LOGIN ⚡');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ BOT ONLINE | Owner: SAIF ULLAH');
            console.log('✅ Fake Typing/Recording | AI | Status Download | ViewOnce Ready');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
            else console.log('❌ Logged out, delete session_data folder and restart.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Capture status messages (status broadcasts)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid !== 'status@broadcast') return;

        // Store recent statuses (keep last 20)
        recentStatuses.unshift({ jid: msg.key.remoteJid, message: msg, timestamp: Date.now() });
        if (recentStatuses.length > 20) recentStatuses.pop();
    });

    // Main message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return; // ignore self

        const jid = msg.key.remoteJid;
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const isCommand = messageText.startsWith('.');
        const lowerText = messageText.toLowerCase().trim();

        // ========== COMMAND HANDLING ==========
        if (isCommand) {
            const parts = messageText.slice(1).trim().split(/\s+/);
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            if (command === 'menu') {
                await sendMenu(sock, jid);
            }
            else if (command === 'owner') {
                await sock.sendMessage(jid, { text: `👑 *Bot Owner:* ${BOT_OWNER}\n📞 Contact: via WhatsApp only\n🤖 AI Model: GLM-4.5-Air\n⚡ Features: Fake Typing, Fake Recording, Status DL, ViewOnce DL` });
            }
            else if (command === 'ai') {
                const query = args.join(' ');
                if (!query) {
                    await sock.sendMessage(jid, { text: 'Usage: .ai <your question>' });
                    return;
                }
                await fakeRecording(sock, jid, 1200);
                await fakeTyping(sock, jid, 2500);
                const aiReply = await getAIResponse(query, 'User');
                await sock.sendMessage(jid, { text: aiReply });
            }
            else if (command === 'statuslist') {
                if (recentStatuses.length === 0) {
                    await sock.sendMessage(jid, { text: '📭 No status updates captured yet. Wait for contacts to post status.' });
                    return;
                }
                let listMsg = '*📸 Recent Statuses:*\n\n';
                recentStatuses.forEach((st, idx) => {
                    const type = st.message.message?.imageMessage ? '📷 Image' : st.message.message?.videoMessage ? '🎥 Video' : '📄 Other';
                    const time = new Date(st.timestamp).toLocaleTimeString();
                    listMsg += `${idx+1}. ${type} | ${time}\n`;
                });
                listMsg += '\n_Reply with .statusdl <number> to download._';
                await sock.sendMessage(jid, { text: listMsg });
            }
            else if (command === 'statusdl') {
                const index = parseInt(args[0]) - 1;
                if (isNaN(index) || index < 0 || index >= recentStatuses.length) {
                    await sock.sendMessage(jid, { text: '❌ Invalid index. Use .statuslist to see available statuses.' });
                    return;
                }
                const statusObj = recentStatuses[index];
                if (!statusObj) {
                    await sock.sendMessage(jid, { text: 'Status expired or not found.' });
                    return;
                }
                await sock.sendMessage(jid, { text: '⬇️ Downloading status, please wait...' });
                const downloaded = await downloadStatusMedia(sock, statusObj.message, index+1);
                if (downloaded) {
                    const isImage = downloaded.mimetype?.startsWith('image/');
                    if (isImage) {
                        await sock.sendMessage(jid, { image: downloaded.buffer, caption: `📸 Status #${index+1} downloaded` });
                    } else {
                        await sock.sendMessage(jid, { video: downloaded.buffer, caption: `🎥 Status #${index+1} downloaded` });
                    }
                    fs.unlinkSync(downloaded.filePath);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Failed to download status media. It might be expired or unsupported.' });
                }
            }
            else if (command === 'viewonce') {
                // Requires replying to a view-once message
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) {
                    await sock.sendMessage(jid, { text: '📌 *Reply to a view-once (disappearing) message* with .viewonce to download it.' });
                    return;
                }
                let viewOnceMsg = null;
                if (quotedMsg.viewOnceMessageV2) viewOnceMsg = quotedMsg.viewOnceMessageV2;
                else if (quotedMsg.viewOnceMessage) viewOnceMsg = quotedMsg.viewOnceMessage;
                else {
                    await sock.sendMessage(jid, { text: '❌ The quoted message is not a view-once media.' });
                    return;
                }
                await sock.sendMessage(jid, { text: '🔓 Decrypting view-once media...' });
                const downloaded = await downloadViewOnce(sock, { message: viewOnceMsg, key: msg.key });
                if (downloaded) {
                    await sock.sendMessage(jid, { image: downloaded.buffer, caption: '📸 *ViewOnce image downloaded*' });
                    fs.unlinkSync(downloaded.filePath);
                } else {
                    await sock.sendMessage(jid, { text: '❌ Failed to download view-once media. It may be unsupported or already expired.' });
                }
            }
            else {
                await sock.sendMessage(jid, { text: `❓ Unknown command. Type .menu for help.` });
            }
            return;
        }

        // ========== NON-COMMAND: AI CHAT (with fake typing/recording) ==========
        if (messageText && messageText.length > 0) {
            // Simulate voice recording first, then typing
            await fakeRecording(sock, jid, 1000);
            await fakeTyping(sock, jid, 2000);
            const aiReply = await getAIResponse(messageText);
            await sock.sendMessage(jid, { text: aiReply });
        }
        else if (msg.message?.imageMessage || msg.message?.videoMessage) {
            // Just react to media if needed - not required but friendly
            await sock.sendMessage(jid, { text: "📎 Received media. Use .menu for commands or ask me anything!" });
        }
    });
}

startBot().catch(err => console.error('Fatal error:', err));
