
# TAPSA Bulk SMS - Node.js Client

[![npm version](https://badge.fury.io/js/tapsa-bulk-sms.svg)](https://www.npmjs.com/package/tapsa-bulk-sms)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Node.js client library for the **TAPSA Bulk SMS API** - Send bulk SMS messages and check your account balance directly from your Node.js applications.

## 🚀 Features

- ✅ **Send SMS** - Single or bulk SMS to multiple recipients
- ✅ **Check Balance** - View remaining SMS credits
- ✅ **Account Validation** - Verify API key validity
- ✅ **Promise-based** - Modern async/await support
- ✅ **Error Handling** - Comprehensive error responses
- ✅ **CLI Support** - Command-line interface for quick operations
- ✅ **TypeScript Ready** - Full JSDoc annotations
- ✅ **Zero Dependencies** - Pure Node.js implementation

## 📦 Installation

```bash
npm install tapsa-bulk-sms
```

Or using yarn:

```bash
yarn add tapsa-bulk-sms
```

🔑 Prerequisites

1. Create an account at TAPSA Bulk SMS
2. Generate an API key from the API Keys page
3. Top up your account with SMS credits

🎯 Quick Start

```javascript
const TapsaSMS = require('tapsa-bulk-sms');

const sms = new TapsaSMS('your_api_key_here');

async function main() {
  try {
    const balance = await sms.getBalance();
    console.log(`Balance: ${balance.balance} SMS`);

    const result = await sms.sendSMS(
      '255712345678',
      'Hello from TAPSA!',
      'TAPSA'
    );
    console.log(`Sent! Deducted: ${result.deducted} credits`);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
```

📚 API Reference

Initialize Client

```javascript
const sms = new TapsaSMS(apiKey, options);
```

Parameter Type Required Description
apiKey string Yes Your TAPSA API key
options.baseURL string No API base URL (default: https://api.smstapsa.site/v1)
options.timeout number No Request timeout in ms (default: 30000)

Methods

getBalance()

Get your current SMS balance and account information.

```javascript
const result = await sms.getBalance();
```

Response:

```javascript
{
  success: true,
  balance: 150,
  currency: "TZS",
  smsRate: 30
}
```

sendSMS(phoneNumbers, message, senderId)

Send SMS to one or multiple recipients.

Parameter Type Required Description
phoneNumbers string \| string[] Yes Phone number(s) in 255XXXXXXXXX format
message string Yes SMS content (max 160 characters)
senderId string No Sender name (default: "TAPSA", max 11 chars)

```javascript
const result = await sms.sendSMS('255712345678', 'Hello!', 'MyApp');

const result = await sms.sendSMS(
  ['255712345678', '255765432100'],
  'Bulk message to all!'
);
```

Response:

```javascript
{
  success: true,
  message: "Messages processed",
  senderId: "MyApp",
  recipients: ["255712345678", "255765432100"],
  deducted: 2,
  remainingBalance: 148
}
```

validateAccount()

Check if your API key is valid.

```javascript
const isValid = await sms.validateAccount();
console.log(isValid ? 'Valid API key' : 'Invalid API key');
```

getRemainingBalance()

Get just the remaining SMS count.

```javascript
const balance = await sms.getRemainingBalance();
console.log(`You have ${balance} SMS credits left`);
```

💻 Usage Examples

Send SMS with Custom Sender ID

```javascript
const TapsaSMS = require('tapsa-bulk-sms');
const sms = new TapsaSMS(process.env.TAPSA_API_KEY);

async function sendAlert(phoneNumber, alertMessage) {
  try {
    const result = await sms.sendSMS(
      phoneNumber,
      `🚨 ALERT: ${alertMessage}`,
      'ALERT'
    );
    console.log('Alert sent successfully!');
    return result;
  } catch (error) {
    console.error('Failed to send alert:', error.message);
    throw error;
  }
}
```

Bulk SMS with Error Handling

```javascript
async function sendBulkSMS(phoneNumbers, message) {
  try {
    const result = await sms.sendSMS(phoneNumbers, message, 'TAPSA');
    
    console.log(`✅ Sent to ${result.deducted} recipients`);
    console.log(`💰 Remaining balance: ${result.remainingBalance}`);
    
    return result;
  } catch (error) {
    if (error.statusCode === 402) {
      console.error('Insufficient balance! Please top up.');
    } else if (error.statusCode === 401) {
      console.error('Invalid API key!');
    } else {
      console.error('Error:', error.message);
    }
    throw error;
  }
}
```

Monitor Balance Before Sending

```javascript
async function sendWithBalanceCheck(phoneNumbers, message) {
  const balance = await sms.getRemainingBalance();
  const recipientCount = Array.isArray(phoneNumbers) ? phoneNumbers.length : 1;
  
  if (balance < recipientCount) {
    throw new Error(`Insufficient balance. Need ${recipientCount} credits, have ${balance}`);
  }
  
  return await sms.sendSMS(phoneNumbers, message);
}
```

🖥️ Command Line Interface (CLI)

The package includes a CLI tool for quick operations.

Check Balance

```bash
export TAPSA_API_KEY="your_api_key_here"
tapsa-sms balance

tapsa-sms balance your_api_key_here

npm run start balance your_api_key_here
```

Send SMS via CLI

```bash
tapsa-sms send your_api_key_here "255712345678" "Hello from CLI!"

tapsa-sms send your_api_key_here "255712345678,255765432100" "Bulk message"

tapsa-sms send your_api_key_here "255712345678" "Hello!" "MYAPP"
```

⚠️ Error Handling

The library throws TapsaSMSError with the following properties:

Error Type Status Code Description
Bad Request 400 Invalid parameters (wrong phone format, message too long)
Unauthorized 401 Invalid or missing API key
Insufficient Balance 402 Not enough SMS credits
Timeout 408 Request timeout
Server Error 500 TAPSA API server error

Error Example

```javascript
try {
  await sms.sendSMS('invalid', 'Hello');
} catch (error) {
  console.log(error.name);
  console.log(error.message);
  console.log(error.statusCode);
  console.log(error.responseData);
}
```

🔐 Security Best Practices

⚠️ Never hardcode API keys in your source code!

✅ DO:

```javascript
const sms = new TapsaSMS(process.env.TAPSA_API_KEY);

const config = require('./config.json');
const sms = new TapsaSMS(config.apiKey);
```

❌ DON'T:

```javascript
const sms = new TapsaSMS('sk_live_123456789');
```

📝 Phone Number Format

All phone numbers must be in 255XXXXXXXXX format:

· Start with country code 255 (Tanzania)
· Followed by 9 digits
· Example: 255712345678 ✅
· ❌ 0712345678 (missing country code)
· ❌ +255712345678 (includes + sign)
· ❌ 25571234567 (too short)

🧪 Testing

Create a test file test.js:

```javascript
const TapsaSMS = require('tapsa-bulk-sms');

async function test() {
  const sms = new TapsaSMS(process.env.TAPSA_API_KEY);
  
  const balance = await sms.getBalance();
  console.log('Balance test:', balance.success ? '✅ Passed' : '❌ Failed');
  
  try {
    const result = await sms.sendSMS('255712345678', 'Test message', 'TEST');
    console.log('Send test:', result.success ? '✅ Passed' : '❌ Failed');
  } catch (error) {
    console.log('Send test: ❌ Failed -', error.message);
  }
}

test();
```

Run tests:

```bash
export TAPSA_API_KEY="your_key"
node test.js
```

📄 License

MIT License - see LICENSE file for details.

🤝 Support

· 📧 Email: support@smstapsa.site
· 🌐 Website: https://smstapsa.site
· 📚 API Docs: https://smstapsa.site/api-docs

🐛 Issues

Report bugs or feature requests on GitHub Issues

✨ Related Links

· TAPSA Bulk SMS Website
· API Documentation
· Python Client Library
· PHP Client Library

---

Made with ❤️ by TAPSA Bulk SMS - Reliable SMS delivery in Tanzania

```
