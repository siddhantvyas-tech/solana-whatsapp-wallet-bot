const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'v@ultKey123456789v@ultKey123456789'; // 32 chars (256 bits)
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const [ivHex, encryptedText] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedText, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

module.exports = { encrypt, decrypt };
