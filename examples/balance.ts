import { TapsaSMS } from 'tapsa-sms';

const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY! });
const balance = await tapsa.getBalance();

console.log(balance);
