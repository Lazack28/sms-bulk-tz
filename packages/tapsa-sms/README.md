# TAPSA SMS

Official Node.js and TypeScript client for the [TAPSA SMS API](https://api.smstapsa.site/).

## Installation

```bash
npm install tapsa-sms
```

Node.js 18 or newer is supported.

## Authentication

Create a client with an API key. Keep it in an environment variable and never commit it:

```js
import { TapsaSMS } from 'tapsa-sms';

const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY });
```

## Sending SMS

```js
const result = await tapsa.sendSMS({
  phoneNumbers: ['255712345678'],
  message: 'Hello from TAPSA SMS',
  senderId: 'TAPSA'
});
console.log(result);
```

Send to multiple recipients by passing more numbers in `phoneNumbers`:

```js
await tapsa.sendSMS({
  phoneNumbers: ['255712345678', '255787654321'],
  message: 'Your appointment is confirmed.'
});
```

## Checking Balance

```js
const balance = await tapsa.getBalance();
console.log(balance.data.balance, balance.data.currency);
```

## Error Handling

Requests throw `TapsaAPIError`, which exposes `message`, `status`, `code`, `response`, and `data`. HTTP statuses such as 401, 402, 403, 429, and 500 are preserved.

```js
import { TapsaAPIError } from 'tapsa-sms';

try {
  await tapsa.sendSMS({ phoneNumbers: ['255712345678'], message: 'Test' });
} catch (error) {
  if (error instanceof TapsaAPIError) console.error(error.status, error.message, error.data);
}
```

## TypeScript

All request and response interfaces are exported, including `TapsaSMSOptions`, `SendSMSOptions`, `SendSMSResponse`, and `BalanceResponse`.

## Configuration

`apiKey` is required. `baseUrl` optionally overrides `https://api.smstapsa.site` for a test server, and `timeout` defaults to 30 seconds. The client sends `POST /v1/sms/send` and `GET /v1/account/balance` with the `x-api-key` header.

## API Reference

- `new TapsaSMS({ apiKey, baseUrl?, timeout? })`
- `sendSMS({ phoneNumbers, message, senderId? })`
- `getBalance()`

See the [TAPSA SMS API documentation](https://api.smstapsa.site/).

## Development

From this repository, run `npm run sdk:build` and `npm run sdk:test`. The package publishes only `dist`, this README, and `LICENSE`.

## License

MIT