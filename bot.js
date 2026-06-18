import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();
    console.log(`WhatsApp Version: ${version.join('.')}`);
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
        browser: ['Ubuntu', 'Chrome', '120.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if(qr) {
            console.log('====== SCAN QR CODE ======');
            qrcode.generate(qr, {small: true});
            console.log('===========================');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('BOT CONNECTED SUCCESSFULLY');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;
        
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        
        if (sender.endsWith('@g.us')) return;
        
        try {
            await sock.sendPresenceUpdate('composing', sender);
            
            const prompt = `You are a helpful WhatsApp AI assistant. Reply in the same language as the user. Be friendly and concise. User: "${text}"`;
            const result = await model.generateContent(prompt);
            
            await new Promise(r => setTimeout(r, 1500));
            await sock.sendMessage(sender, { text: result.response.text() });
            
        } catch (e) {
            console.log('Error:', e.message);
        }
    });
}

startBot();
