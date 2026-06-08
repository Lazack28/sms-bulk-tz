
/**
 * TAPSA Bulk SMS API Client
 * 
 * A Node.js client for the TAPSA Bulk SMS API.
 * 
 * @example
 * const TapsaSMS = require('tapsa-sms');
 * const sms = new TapsaSMS('your-api-key');
 * 
 * // Check balance
 * const balance = await sms.getBalance();
 * 
 * // Send SMS
 * const result = await sms.sendSMS(['255712345678'], 'Hello world!', 'TAPSA');
 */

const https = require('https');
const http = require('http');

class TapsaSMSError extends Error {
  constructor(message, statusCode, responseData = null) {
    super(message);
    this.name = 'TapsaSMSError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

class TapsaSMS {
  /**
   * Create a new TAPSA SMS API client
   * @param {string} apiKey - Your TAPSA API key from the API Keys page
   * @param {Object} options - Configuration options
   * @param {string} options.baseURL - API base URL (default: https://api.smstapsa.site/v1)
   * @param {number} options.timeout - Request timeout in milliseconds (default: 30000)
   */
  constructor(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new TapsaSMSError('API key is required', 400);
    }
    this.apiKey = apiKey;
    this.baseURL = options.baseURL || 'https://api.smstapsa.site/v1';
    this.timeout = options.timeout || 30000;
  }

  /**
   * Make an HTTP request to the API
   * @private
   */
  _request(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseURL}${endpoint}`);
      const options = {
        method: method,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: this.timeout,
      };

      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.request(url, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          let parsedData;
          try {
            parsedData = responseData ? JSON.parse(responseData) : {};
          } catch (e) {
            reject(new TapsaSMSError('Invalid JSON response from server', res.statusCode, responseData));
            return;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            const errorMessage = parsedData.error || parsedData.message || `HTTP ${res.statusCode}`;
            reject(new TapsaSMSError(errorMessage, res.statusCode, parsedData));
          }
        });
      });

      req.on('error', (err) => {
        reject(new TapsaSMSError(`Request failed: ${err.message}`, 500));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new TapsaSMSError('Request timeout', 408));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  /**
   * Get account balance
   * @returns {Promise<Object>} Balance information
   * @returns {boolean} success - Whether the request succeeded
   * @returns {number} balance - Current SMS balance
   * @returns {string} currency - Currency code (e.g., TZS)
   * @returns {number} smsRate - Cost per SMS in currency units
   * 
   * @example
   * const balance = await sms.getBalance();
   * console.log(`Balance: ${balance.balance} SMS`);
   */
  async getBalance() {
    return this._request('GET', '/account/balance');
  }

  /**
   * Send SMS messages to one or multiple recipients
   * @param {string|string[]} phoneNumbers - Recipient phone number(s) in 255XXXXXXXXX format
   * @param {string} message - SMS message content (max 160 characters)
   * @param {string} senderId - Sender ID (default: "TAPSA", max 11 characters)
   * @returns {Promise<Object>} Send result
   * @returns {boolean} success - Whether the request succeeded
   * @returns {string} message - Status message
   * @returns {string} senderId - The sender ID used
   * @returns {Array} recipients - List of recipients
   * @returns {number} deducted - Number of SMS credits deducted
   * @returns {number} remainingBalance - Remaining balance after sending
   * 
   * @example
   * // Send to single recipient
   * const result = await sms.sendSMS('255712345678', 'Hello world!', 'TAPSA');
   * 
   * // Send to multiple recipients
   * const result = await sms.sendSMS(['255712345678', '255765432100'], 'Hello everyone!');
   */
  async sendSMS(phoneNumbers, message, senderId = 'TAPSA') {
    if (!phoneNumbers) {
      throw new TapsaSMSError('phoneNumbers is required', 400);
    }
    if (!message || typeof message !== 'string') {
      throw new TapsaSMSError('message is required and must be a string', 400);
    }
    if (message.length > 160) {
      throw new TapsaSMSError('Message exceeds 160 character limit', 400);
    }
    if (senderId && senderId.length > 11) {
      throw new TapsaSMSError('senderId cannot exceed 11 characters', 400);
    }

    // Normalize phoneNumbers to array
    const normalizedPhoneNumbers = Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers];
    
    // Validate phone numbers format (basic check for 255 prefix and digits)
    for (const phone of normalizedPhoneNumbers) {
      if (!phone || !phone.match(/^255[0-9]{9}$/)) {
        throw new TapsaSMSError(`Invalid phone number format: ${phone}. Must be 255XXXXXXXXX (12 digits starting with 255)`, 400);
      }
    }

    const payload = {
      phoneNumbers: normalizedPhoneNumbers,
      message: message,
      senderId: senderId,
    };

    return this._request('POST', '/sms/send', payload);
  }

  /**
   * Check if the API key is valid and account has balance
   * @returns {Promise<boolean>} True if account is valid
   */
  async validateAccount() {
    try {
      const balance = await this.getBalance();
      return balance.success === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get remaining balance without other details
   * @returns {Promise<number>} Remaining SMS count
   */
  async getRemainingBalance() {
    const balance = await this.getBalance();
    return balance.balance || 0;
  }
}

// CLI support for direct usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const apiKey = process.env.TAPSA_API_KEY || args[1];

  if (!apiKey) {
    console.error('Error: API key is required. Set TAPSA_API_KEY environment variable or provide as argument.');
    console.error('Usage:');
    console.error('  Check balance: node index.js balance YOUR_API_KEY');
    console.error('  Send SMS:      node index.js send YOUR_API_KEY "255712345678" "Hello world" [SENDER_ID]');
    process.exit(1);
  }

  const sms = new TapsaSMS(apiKey);

  async function cli() {
    try {
      if (command === 'balance') {
        const result = await sms.getBalance();
        console.log(JSON.stringify(result, null, 2));
      } else if (command === 'send') {
        const phoneNumbers = args[2];
        const message = args[3];
        const senderId = args[4] || 'TAPSA';
        
        if (!phoneNumbers || !message) {
          console.error('Error: phoneNumbers and message are required');
          console.error('Usage: node index.js send API_KEY "255712345678,255765432100" "Hello world" [SENDER_ID]');
          process.exit(1);
        }
        
        const phones = phoneNumbers.split(',');
        const result = await sms.sendSMS(phones, message, senderId);
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error('Unknown command. Use: balance or send');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error.message);
      if (error.responseData) {
        console.error('Details:', error.responseData);
      }
      process.exit(1);
    }
  }

  cli();
}

module.exports = TapsaSMS;
