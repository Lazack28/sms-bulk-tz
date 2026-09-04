# sms-bulk-tz

Official Node.js SDK for the [SMSTAPSA SMS API](https://smstapsa.site/). Send SMS messages and check account balances from Node.js applications with a lightweight, typed client.

## Installation

```bash
npm install sms-bulk-tz
```

Node.js 18 or newer is required.

## Authentication

Provide your SMSTAPSA API key through an environment variable. Never commit it.

```bash
TAPSA_API_KEY=your_api_key
```

## Quick Start

```ts
import { TapsaSMS } from 'sms-bulk-tz';

const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY! });
const result = await tapsa.sendSMS({
  phoneNumbers: ['255712345678'],
  message: 'Hello from SMSTAPSA',
  senderId: 'TAPSA'
});
console.log(result);
```

## Send SMS

```ts
await tapsa.sendSMS({
  phoneNumbers: ['255712345678', '255713456789'],
  message: 'Hello everyone',
  senderId: 'TAPSA'
});
```

`phoneNumbers` must be a non-empty array of non-empty strings. The SDK does not impose an unnecessary country-specific format restriction.

## Check Balance

```ts
const balance = await tapsa.getBalance();
console.log(balance.data.balance, balance.data.currency);
```

## Error Handling

API and validation failures throw `TapsaAPIError`, exposing `message`, `status`, `code`, `response`, and `data`.

```ts
import { TapsaAPIError } from 'sms-bulk-tz';

try {
  await tapsa.sendSMS({ phoneNumbers: ['255712345678'], message: 'Hello' });
} catch (error) {
  if (error instanceof TapsaAPIError) console.error(error.status, error.code, error.message, error.data);
}
```

HTTP statuses 400, 401, 402, 403, 429, and 500 are preserved. Network failures, timeouts, and malformed JSON responses receive explicit error codes.

## Configuration

`baseUrl` defaults to `https://api.smstapsa.site` and can be overridden for testing. `timeout` defaults to 30 seconds.

```ts
const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY!, baseUrl: 'https://api.smstapsa.site', timeout: 30_000 });
```

## API Reference

- `new TapsaSMS({ apiKey, baseUrl?, timeout? })`
- `sendSMS({ phoneNumbers, message, senderId? })` calls `POST /v1/sms/send`.
- `getBalance()` calls `GET /v1/account/balance`.

All request and response interfaces are exported for TypeScript users. See the examples in [`examples/send-sms.ts`](examples/send-sms.ts) and [`examples/balance.ts`](examples/balance.ts).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Documentation

See the official [SMSTAPSA documentation](https://smstapsa.site/).

## License

MIT