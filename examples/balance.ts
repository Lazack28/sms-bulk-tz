import { TapsaSMS } from 'sms-bulk-tz';

const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY! });
const balance = await tapsa.getBalance();

console.log(balance);
