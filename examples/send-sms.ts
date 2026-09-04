import { TapsaSMS } from 'sms-bulk-tz';

const tapsa = new TapsaSMS({ apiKey: process.env.TAPSA_API_KEY! });
const result = await tapsa.sendSMS({ phoneNumbers: ['255712345678'], message: 'Hello from SMSTAPSA', senderId: 'TAPSA' });

console.log(result);