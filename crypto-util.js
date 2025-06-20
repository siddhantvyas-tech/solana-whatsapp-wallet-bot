const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-cbc';
const key = process.env.ENCRYPTION_KEY;
const iv = process.env.IV;

const encrypt = (text) => {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const decrypt = (encryptedText) => {
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
};

module.exports = { encrypt, decrypt };
