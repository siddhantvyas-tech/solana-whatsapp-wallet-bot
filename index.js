const express = require('express');
const { Keypair, Connection, clusterApiUrl, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const pool = require('./db');
const MessagingResponse = require('twilio').twiml.MessagingResponse;
const { encrypt, decrypt } = require('./crypto-util');
require('dotenv').config();

const app = express();
app.use(express.json());

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// 📱 Create Wallet
app.post('/create-wallet', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  try {
    const existing = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);

    if (existing.rows.length > 0) {
      return res.json({
        message: 'Wallet already exists ✅',
        publicKey: existing.rows[0].public_key
      });
    }

    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKey = Buffer.from(keypair.secretKey).toString('hex');
    const encryptedSecretKey = encrypt(secretKey);

    await pool.query(
      'INSERT INTO users (phone, public_key, secret_key) VALUES ($1, $2, $3)',
      [phone, publicKey, encryptedSecretKey]
    );

    res.json({
      message: 'Wallet created successfully 🚀',
      publicKey
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 💰 Get Balance
app.post('/balance', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const publicKey = new PublicKey(result.rows[0].public_key);
    const balance = await connection.getBalance(publicKey);
    const sol = balance / 1e9;

    res.json({
      message: `Wallet balance is ${sol} SOL`,
      sol
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 🚀 Send SOL
app.post('/send', async (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || !amount) {
    return res.status(400).json({ error: 'From, to, and amount are required' });
  }

  try {
    const senderResult = await pool.query('SELECT * FROM users WHERE phone = $1', [from]);
    if (!senderResult.rows.length) return res.status(404).json({ error: 'Sender not found' });

    const receiverResult = await pool.query('SELECT public_key FROM users WHERE phone = $1', [to]);
    if (!receiverResult.rows.length) return res.status(404).json({ error: 'Recipient not found' });

    const decryptedSecretKey = decrypt(senderResult.rows[0].secret_key);
    const senderKeypair = Keypair.fromSecretKey(Buffer.from(decryptedSecretKey, 'hex'));
    const recipientPubKey = new PublicKey(receiverResult.rows[0].public_key);

    const lamports = parseFloat(amount) * 1e9;
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: recipientPubKey,
        lamports
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);

    res.json({
      message: `✅ Sent ${amount} SOL from ${from} to ${to}`,
      signature
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Transaction failed ❌', details: err.message });
  }
});

// 📬 My Wallet Address
app.post('/my-address', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  try {
    const result = await pool.query('SELECT public_key FROM users WHERE phone = $1', [phone]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Wallet not found for this phone' });
    }

    res.json({
      message: 'Wallet found ✅',
      publicKey: result.rows[0].public_key
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 💬 Twilio WhatsApp Bot
app.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  const msg = req.body.Body?.trim().toLowerCase();
  const phone = `+${req.body.From.replace('whatsapp:', '')}`;
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
        const publicKey = kp.publicKey.toBase58();
        const secretKey = Buffer.from(kp.secretKey).toString('hex');
        const encrypted = encrypt(secretKey);

        await pool.query('INSERT INTO users (phone, public_key, secret_key) VALUES ($1, $2, $3)', [
          phone, publicKey, encrypted
        ]);

        reply = `🚀 Wallet created:\n${publicKey}`;
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
          const decrypted = decrypt(senderResult.rows[0].secret_key);
          const fromKey = Keypair.fromSecretKey(Buffer.from(decrypted, 'hex'));
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
        reply = `❌ Use format: send 0.1 +919876543210`;
      }
    }

    else if (msg.includes('help')) {
      reply = `
🪙 *Solana Wallet Bot*
Available commands:
- create wallet
- balance
- address
- send 0.1 +91XXXXXXXXXX
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

app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
