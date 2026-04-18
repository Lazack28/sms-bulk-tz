# SMS Bulk TZ

Node.js SDK for sending SMS using SMS Bulk TZ API.

## Install

```bash
npm install sms-bulk-tz
Usage
const SMSBulkTZ = require("sms-bulk-tz");

const sms = new SMSBulkTZ({
  apiKey: "YOUR_API_KEY",
  sender: "Lazack"
});

// Send single SMS
sms.send({
  to: "2557XXXXXXXX",
  message: "Hello from Lazack"
})
.then(console.log)
.catch(console.error);

// Send bulk SMS
sms.sendBulk({
  recipients: ["2557XXXXXXX", "2556XXXXXXX"],
  message: "Hello everyone"
})
.then(console.log)
.catch(console.error);

// Check balance
sms.getBalance()
.then(console.log)
.catch(console.error);
Features
Send single SMS
Send bulk SMS
Check account balance
Simple and clean API
Author

Lazack Organisation

```
---

# 📁 4. `.gitignore`

```bash
node_modules/
.env
🚀 After adding files
```
Run:
```
npm install
git add .
git commit -m "Initial SDK setup"
git push
🚀 Publish to npm
npm login
npm publish
```
