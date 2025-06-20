const express = require('express');
const { Keypair, Connection, clusterApiUrl, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
require('dotenv').config();
const pool = require('./db');
const { encrypt, decrypt } = require('./crypto-util');

const twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_WHATSAPP_FROM = 'whatsapp:' + process.env.TWILIO_WHATSAPP_NUMBER;

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const app = express();
app.use(express.json());

// ============ API ROUTES ============

app.post('/create-wallet', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        const existing = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
        if (existing.rows.length > 0) {
            return res.json({ message: 'Wallet already exists ✅', publicKey: existing.rows[0].public_key });
        }

        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const encryptedSecretKey = encrypt(Buffer.from(keypair.secretKey).toString('hex'));

        await pool.query(
            'INSERT INTO users (phone, public_key, secret_key) VALUES ($1, $2, $3)',
            [phone, publicKey, encryptedSecretKey]
        );

        res.json({ message: 'Wallet created successfully 🚀', publicKey });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/balance', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Wallet not found' });

        const balance = await connection.getBalance(new PublicKey(result.rows[0].public_key));
        res.json({ message: `Wallet balance is ${balance / 1e9} SOL` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/send', async (req, res) => {
    const { from, to, amount } = req.body;
    if (!from || !to || !amount) return res.status(400).json({ error: 'Missing parameters' });

    try {
        const senderResult = await pool.query('SELECT * FROM users WHERE phone = $1', [from]);
        const receiverResult = await pool.query('SELECT public_key FROM users WHERE phone = $1', [to]);
        if (!senderResult.rows.length || !receiverResult.rows.length) {
            return res.status(404).json({ error: 'Sender or recipient not found' });
        }

        const decrypted = decrypt(senderResult.rows[0].secret_key);
        const senderKeypair = Keypair.fromSecretKey(Buffer.from(decrypted, 'hex'));
        const recipientPubKey = new PublicKey(receiverResult.rows[0].public_key);

        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey: senderKeypair.publicKey,
            toPubkey: recipientPubKey,
            lamports: parseFloat(amount) * 1e9
        }));

        const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);

        res.json({ message: `✅ Sent ${amount} SOL from ${from} to ${to}`, signature });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Transaction failed ❌', details: err.message });
    }
});

app.post('/my-address', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Wallet not found' });

        res.json({ message: 'Wallet found ✅', publicKey: result.rows[0].public_key });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ============ WHATSAPP BOT ============

app.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
    const msg = req.body.Body?.trim().toLowerCase();
    const phone = req.body.From.replace('whatsapp:', '');
    console.log('📩 WhatsApp message:', msg, 'From:', phone);

    const twiml = new MessagingResponse();
    let reply = "🤖 Sorry, I didn't understand. Type *help*.";

    try {
        if (msg.includes('create wallet')) {
            const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);
            if (result.rows.length > 0) {
                reply = `✅ Wallet already exists:\n${result.rows[0].public_key}`;
            } else {
                const kp = Keypair.generate();
                const encrypted = encrypt(Buffer.from(kp.secretKey).toString('hex'));
                await pool.query('INSERT INTO users (phone, public_key, secret_key) VALUES ($1, $2, $3)', [
                    phone,
                    kp.publicKey.toBase58(),
                    encrypted
                ]);
                reply = `🚀 Wallet created:\n${kp.publicKey.toBase58()}`;
            }
        }

        else if (msg.includes('balance')) {
            const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);
            if (result.rows.length > 0) {
                const bal = await connection.getBalance(new PublicKey(result.rows[0].public_key));
                reply = `💰 Your balance is ${(bal / 1e9).toFixed(4)} SOL`;
            } else {
                reply = `❌ No wallet found. Type *create wallet* to begin.`;
            }
        }

        else if (msg.includes('address')) {
            const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);
            reply = result.rows.length > 0
                ? `📬 Your wallet address is:\n${result.rows[0].public_key}`
                : `❌ No wallet found. Type *create wallet* to begin.`;
        }

        else if (msg.startsWith('send')) {
            const parts = msg.split(' ');
            if (parts.length >= 3) {
                const amount = parseFloat(parts[1]);
                const receiver = parts[2];

                const senderResult = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
                const receiverResult = await pool.query('SELECT public_key FROM users WHERE phone = $1', [receiver]);

                if (!senderResult.rows.length || !receiverResult.rows.length) {
                    reply = `❌ Sender or receiver not found.`;
                } else {
                    const fromKey = Keypair.fromSecretKey(
                        Buffer.from(decrypt(senderResult.rows[0].secret_key), 'hex')
                    );
                    const toPub = new PublicKey(receiverResult.rows[0].public_key);
                    const tx = new Transaction().add(SystemProgram.transfer({
                        fromPubkey: fromKey.publicKey,
                        toPubkey: toPub,
                        lamports: amount * 1e9
                    }));
                    const sig = await sendAndConfirmTransaction(connection, tx, [fromKey]);
                    reply = `✅ Sent ${amount} SOL to ${receiver}\n🔖 Tx: ${sig}`;
                }
            } else {
                reply = `❌ Use format: send 0.1 +91XXXXXXXXXX`;
            }
        }

        else if (msg.startsWith('invite')) {
            const parts = msg.split(' ');
            if (parts.length >= 2) {
                const invitee = parts[1];

                try {
                    await twilioClient.messages.create({
                        from: TWILIO_WHATSAPP_FROM,
                        to: 'whatsapp:' + invitee,
                        body: `👋 Hey! You’ve been invited to create your own *Solana Wallet* on WhatsApp.\n\nJust message:\n\n    create wallet\n\nto this number and start sending & receiving SOL 🚀`
                    });

                    reply = `✅ Invite sent to ${invitee}`;
                } catch (err) {
                    console.error('❌ Error sending invite:', err);
                    reply = `❌ Could not send invite to ${invitee}`;
                }
            } else {
                reply = `❌ Use format: invite +91XXXXXXXXXX`;
            }
        }

        else if (msg.includes('help')) {
            reply = `
🪙 *Solana WhatsApp Wallet Bot*
Commands:
- create wallet
- balance
- address
- send 0.1 +91XXXXXXXXXX
- invite +91XXXXXXXXXX
            `;
        }

    } catch (err) {
        console.error('Bot error:', err);
        reply = "⚠️ Something went wrong. Try again later.";
    }

    twiml.message(reply);
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// ============ START SERVER ============

app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});
