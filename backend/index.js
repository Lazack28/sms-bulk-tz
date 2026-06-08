// index.js - Updated TAPSA backend with API keys, sender IDs, and API integration
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { db, admin } = require('./firebase');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const qs = require('querystring');
const xml2js = require('xml2js');
const crypto = require('crypto');
const multer = require('multer');
const vCard = require('vcard-parser');
const upload = multer({ storage: multer.memoryStorage() });
const csv = require('csv-parser');
const { Readable } = require('stream');
const path = require('path');


// ensure required configuration variables exist early
[ 'AT_USERNAME', 'AT_API_KEY', 'WEBHOOK_URL', 'ZENOPAY_API_KEY' ]
  .forEach(k => {
    if (!process.env[k]) {
      console.error(`❌ required environment variable ${k} is not set`);
      process.exit(1);
    }
  });

// Utility helpers -------------------------------------------------------------
function normalizeSenderId(id) {
  return id ? String(id).trim().toUpperCase() : '';
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate();
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// simple per-user request rate limiter to avoid hammering provider
const _sendCounters = new Map();
function isAllowedToSend(userId) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 5; // adjust as needed
  let arr = _sendCounters.get(userId) || [];
  arr = arr.filter(ts => now - ts < windowMs);
  if (arr.length >= maxRequests) {
    _sendCounters.set(userId, arr);
    return false;
  }
  arr.push(now);
  _sendCounters.set(userId, arr);
  return true;
}

// send messages to Africa's Talking in manageable batches and retry on rate-limit errors
async function sendViaAfricasTalking(formattedNumbers, message, senderId, enqueue = 1) {
  if (!Array.isArray(formattedNumbers)) formattedNumbers = [formattedNumbers];

  // split into chunks to avoid provider rate limits
  const maxPerReq = 100; // adjust according to AT limits
  const chunks = [];
  for (let i = 0; i < formattedNumbers.length; i += maxPerReq) {
    chunks.push(formattedNumbers.slice(i, i + maxPerReq));
  }

  const allRecipients = [];
  for (const chunk of chunks) {
    let attempt = 0;
    while (true) {
      try {
        const data = qs.stringify({
          username: process.env.AT_USERNAME,
          to: chunk.join(','),
          message,
          from: senderId,
          enqueue
        });

        const response = await axios.post(
          'https://api.africastalking.com/version1/messaging',
          data,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'apiKey': process.env.AT_API_KEY
            }
          }
        );

        let smsData;
        if (typeof response.data === 'string' && response.data.startsWith('<')) {
          const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
          smsData = parsed.AfricasTalkingResponse.SMSMessageData;
        } else {
          smsData = response.data.SMSMessageData;
        }

        const raw = smsData && smsData.Recipients && smsData.Recipients.Recipient;
        const recipients = raw
          ? (Array.isArray(raw) ? raw : [raw])
          : [];

        allRecipients.push(...recipients);
        break; // success, break retry loop
      } catch (err) {
        const status = err.response?.status;
        const body = err.response?.data;
        const isRateErr = status === 429 || (body && String(body).toLowerCase().includes('rate'));
        if (isRateErr && attempt < 3) {
          attempt += 1;
          const delay = 1000 * attempt;
          console.warn(`rate limit hit, retrying chunk in ${delay}ms (attempt ${attempt})`);
          await sleep(delay);
          continue;
        }
        // rethrow if not handled or max attempts reached
        throw err;
      }
    }
  }
  return allRecipients;
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 5000;

// ---------- AUTH MIDDLEWARE ----------
async function authenticateToken(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token', error: err.message });
  }
}

// ---------- API KEY AUTH MIDDLEWARE ----------
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({ message: 'API key required' });
  }

  try {
    // Find user by API key
    const usersSnapshot = await db.collection('users')
      .where('apiKeys', 'array-contains', apiKey)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const userDoc = usersSnapshot.docs[0];
    req.user = {
      uid: userDoc.id,
      ...userDoc.data()
    };
    req.apiKey = apiKey;
    next();
  } catch (err) {
    res.status(500).json({ message: 'Authentication error', error: err.message });
  }
}

// ---------- USER INFO ----------
app.get('/me', authenticateToken, async (req, res) => {
  try {
    const userRef = db.collection('users').doc(req.user.uid);
    const doc = await userRef.get();
    const userData = doc.exists ? doc.data() : { balance: 0 };
    
    // Don't return API keys in general user info
    if (userData.apiKeys) {
      delete userData.apiKeys;
    }
    
    res.json(userData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GENERATE API KEY ----------
app.post('/api-keys/generate', authenticateToken, async (req, res) => {
  try {
    let { name } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'API key name is required' });
    }
    name = name.trim();

    // ✅ FIX: Declare userRef at the beginning
    const userRef = db.collection('users').doc(req.user.uid);

    // ✅ Check if user has reached the maximum number of API keys
    const apiKeysSnapshot = await userRef.collection('apiKeys').get();
    const apiKeysCount = apiKeysSnapshot.size;
    
    const MAX_API_KEYS = 10; // You can adjust this number
    if (apiKeysCount >= MAX_API_KEYS) {
      return res.status(400).json({ 
        message: `Maximum number of API keys (${MAX_API_KEYS}) reached. Please revoke an existing key first.` 
      });
    }

    // Check for existing API key with same name
    const existingNames = await userRef.collection('apiKeys')
      .where('name', '==', name)
      .limit(1)
      .get();
      
    if (!existingNames.empty) {
      return res.status(400).json({ message: 'You already have an API key with that name' });
    }

    // Generate a secure API key
    const apiKey = `tapsa_${crypto.randomBytes(32).toString('hex')}`;
    const keyId = uuidv4();
    
    const apiKeyData = {
      id: keyId,
      name,
      key: apiKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsed: null,
      isActive: true
    };

    // Add to user's API keys array
    await userRef.set({
      apiKeys: admin.firestore.FieldValue.arrayUnion(apiKey)
    }, { merge: true });

    // Store detailed API key info in subcollection
    await userRef.collection('apiKeys').doc(keyId).set(apiKeyData);

    // Return the key (only once - user should save it securely)
    res.status(201).json({
      message: 'API key generated successfully',
      apiKey: apiKey,
      keyId: keyId,
      name: apiKeyData.name,
      createdAt: new Date().toISOString(),
      warning: 'Save this API key securely. It will not be shown again.'
    });

  } catch (err) {
    console.error('API key generation error:', err);
    res.status(500).json({ error: err.message });
  }
});
// ---------- GET USER API KEYS ----------
app.get('/api-keys', authenticateToken, async (req, res) => {
  try {
    const apiKeysRef = db.collection('users').doc(req.user.uid).collection('apiKeys');
    const snapshot = await apiKeysRef.orderBy('createdAt', 'desc').get();
    
    const apiKeys = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: data.id,
        name: data.name,
        createdAt: toDate(data.createdAt)?.toISOString(),
        lastUsed: toDate(data.lastUsed)?.toISOString(),
        isActive: data.isActive
        // Don't return the actual key for security
      };
    });

    res.json(apiKeys);
  } catch (err) {
    console.error('Error fetching API keys:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- REVOKE API KEY ----------
app.delete('/api-keys/:keyId', authenticateToken, async (req, res) => {
  try {
    const { keyId } = req.params;
    const userRef = db.collection('users').doc(req.user.uid);
    
    // Get the key to remove from array
    const keyDoc = await userRef.collection('apiKeys').doc(keyId).get();
    if (!keyDoc.exists) {
      return res.status(404).json({ message: 'API key not found' });
    }

    const keyData = keyDoc.data();
    
    // Remove from user's apiKeys array
    await userRef.update({
      apiKeys: admin.firestore.FieldValue.arrayRemove(keyData.key)
    });

    // Delete from subcollection
    await userRef.collection('apiKeys').doc(keyId).delete();

    res.json({ message: 'API key revoked successfully' });
  } catch (err) {
    console.error('Error revoking API key:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- REQUEST CUSTOM SENDER ID ----------
app.post('/sender-ids/request', authenticateToken, async (req, res) => {
  try {
    let { senderId, purpose } = req.body;

    // normalise immediately for comparison/validation
    senderId = normalizeSenderId(senderId);

    if (!senderId) {
      return res.status(400).json({ message: 'Sender ID is required' });
    }

    if (!purpose || purpose.trim() === '') {
      return res.status(400).json({ message: 'Purpose is required' });
    }

    if (!/^[A-Za-z0-9_]{3,11}$/.test(senderId)) {
      return res.status(400).json({ 
        message: 'Invalid Sender ID format. Use 3–11 letters/numbers only.' 
      });
    }

    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    const existingSenders = userData.senderIds || [];
    const existingRequest = existingSenders.find(s => s.senderId === senderId);

    if (existingRequest) {
      return res.status(400).json({ 
        message: `Sender ID "${senderId}" already exists with status: ${existingRequest.status}`
      });
    }

    const requestId = uuidv4();
    
    // Create sender request WITHOUT serverTimestamp for the array
    const senderRequest = {
      id: requestId,
      senderId, // already uppercased
      purpose: purpose.trim(),
      status: 'pending',
      createdAt: new Date(), // Use regular Date for array objects
      reviewedAt: null,
      reviewedBy: null,
      reason: null
    };

    console.log('📋 Creating new sender ID request:', JSON.stringify(senderRequest, null, 2));

    // Add to user's sender IDs (this works now)
    await userRef.set({
      senderIds: admin.firestore.FieldValue.arrayUnion(senderRequest)
    }, { merge: true });

    // For the separate collection, you can still use serverTimestamp
    await db.collection('senderIdRequests').doc(requestId).set({
      ...senderRequest,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // OK here (not in array)
      userId: req.user.uid,
      userEmail: userData.email || req.user.email
    });

    res.status(201).json({
      message: 'Sender ID request submitted successfully',
      requestId: requestId,
      senderId: senderRequest.senderId,
      status: 'pending'
    });

  } catch (err) {
    console.error('Sender ID request error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// CONTACTS SYSTEM
// ===============================

// Save contact
app.post('/contacts', authenticateToken, async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone required' });
    }

    const contactRef = db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .doc();

    await contactRef.set({
      id: contactRef.id,
      name,
      phone,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Contact saved' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Get all contacts
app.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .orderBy('name')
      .get();

    const contacts = snapshot.docs.map(doc => doc.data());

    res.json(contacts);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Update contact
app.put('/contacts/:id', authenticateToken, async (req, res) => {
  try {
    const { name, phone } = req.body;

    await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .doc(req.params.id)
      .update({
        name,
        phone
      });

    res.json({ success: true, message: 'Updated successfully' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Delete contact
app.delete('/contacts/:id', authenticateToken, async (req, res) => {
  try {
    await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .doc(req.params.id)
      .delete();

    res.json({ success: true, message: 'Deleted successfully' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/contacts/upload-vcf',
authenticateToken,
upload.single('file'),
async (req, res) => {
  try {
    const fileContent = req.file.buffer.toString('utf8');

    const cards = vCard.parse(fileContent);

    const batch = db.batch();

    cards.forEach(card => {
      const name = card.fn ? card.fn[0].value : 'Unknown';
      const phone = card.tel ? card.tel[0].value : '';

      const ref = db.collection('users')
        .doc(req.user.uid)
        .collection('contacts')
        .doc();

      batch.set(ref, {
        id: ref.id,
        name,
        phone
      });
    });

    await batch.commit();

    res.json({
      success: true,
      message: `${cards.length} contacts uploaded`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CONTACTS PRO UPGRADE (PASTE BELOW VCF ROUTE)
// ==========================================

function normalizePhone(phone = '') {
  let p = String(phone).replace(/\D/g, '');

  if (p.startsWith('0')) p = '255' + p.slice(1);
  if (p.startsWith('255') && p.length === 12) return p;

  return p;
}

function isValidTZ(phone = '') {
  const p = normalizePhone(phone);
  return /^255[67]\d{8}$/.test(p);
}


// ==========================================
// GROUPS
// ==========================================

// Create group
app.post('/groups', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Group name required' });
    }

    const ref = db.collection('users')
      .doc(req.user.uid)
      .collection('groups')
      .doc();

    await ref.set({
      id: ref.id,
      name: name.trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Group created' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Get groups
app.get('/groups', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('users')
      .doc(req.user.uid)
      .collection('groups')
      .orderBy('name')
      .get();

    res.json(snap.docs.map(d => d.data()));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Rename group
app.put('/groups/:id', authenticateToken, async (req, res) => {
  try {
    await db.collection('users')
      .doc(req.user.uid)
      .collection('groups')
      .doc(req.params.id)
      .update({
        name: req.body.name
      });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Delete group
app.delete('/groups/:id', authenticateToken, async (req, res) => {
  try {
    await db.collection('users')
      .doc(req.user.uid)
      .collection('groups')
      .doc(req.params.id)
      .delete();

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// VALIDATED CONTACT SAVE
// ==========================================

app.post('/contacts/validated', authenticateToken, async (req, res) => {
  try {
    const { name, phone, groupId = null } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name & phone required' });
    }

    if (!isValidTZ(phone)) {
      return res.status(400).json({ message: 'Invalid Tanzania number' });
    }

    const normalized = normalizePhone(phone);

    const ref = db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .doc();

    await ref.set({
      id: ref.id,
      name,
      phone: normalized,
      groupId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// REMOVE DUPLICATES
// ==========================================

app.post('/contacts/remove-duplicates', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .get();

    const seen = new Set();
    const batch = db.batch();
    let removed = 0;

    snap.docs.forEach(doc => {
      const data = doc.data();
      const phone = normalizePhone(data.phone);

      if (seen.has(phone)) {
        batch.delete(doc.ref);
        removed++;
      } else {
        seen.add(phone);
      }
    });

    await batch.commit();

    res.json({
      success: true,
      removed
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// CSV UPLOAD
// ==========================================

app.post('/contacts/upload-csv',
authenticateToken,
upload.single('file'),
async (req, res) => {
  try {
    const rows = [];
    const stream = Readable.from(req.file.buffer);

    stream
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', async () => {

        const batch = db.batch();
        let count = 0;

        rows.forEach(row => {
          const name = row.name || row.Name || 'Unknown';
          const phone = row.phone || row.Phone || '';

          if (!isValidTZ(phone)) return;

          const ref = db.collection('users')
            .doc(req.user.uid)
            .collection('contacts')
            .doc();

          batch.set(ref, {
            id: ref.id,
            name,
            phone: normalizePhone(phone)
          });

          count++;
        });

        await batch.commit();

        res.json({
          success: true,
          uploaded: count
        });
      });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// EXPORT CSV
// ==========================================

app.get('/contacts/export/csv', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .get();

    let csvData = 'name,phone\n';

    snap.docs.forEach(doc => {
      const c = doc.data();
      csvData += `"${c.name}","${c.phone}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts.csv');
    res.send(csvData);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// EXPORT VCF
// ==========================================

app.get('/contacts/export/vcf', authenticateToken, async (req, res) => {
  try {
    const snap = await db.collection('users')
      .doc(req.user.uid)
      .collection('contacts')
      .get();

    let vcf = '';

    snap.docs.forEach(doc => {
      const c = doc.data();

      vcf += `BEGIN:VCARD\n`;
      vcf += `VERSION:3.0\n`;
      vcf += `FN:${c.name}\n`;
      vcf += `TEL:${c.phone}\n`;
      vcf += `END:VCARD\n`;
    });

    res.setHeader('Content-Type', 'text/vcard');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts.vcf');
    res.send(vcf);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET USER SENDER IDS ----------
app.get('/sender-ids', authenticateToken, async (req, res) => {
    try {
    const userId = req.user.uid;

        const snapshot = await db
            .collection('senderIdRequests')   // ✅ your real collection name
            .where('userId', '==', userId)    // ✅ your real field
            .orderBy('createdAt', 'desc')     // ✅ your real field
            .get();

        const senderIds = [];

        snapshot.forEach(doc => {
            const data = doc.data();

            senderIds.push({
                senderId: data.senderId,     // ✅ correct field
                status: data.status,
                purpose: data.purpose || '',
                createdAt: data.createdAt || null
            });
        });

        res.json(senderIds);

    } catch (error) {
        console.error('Firestore error:', error);
        res.status(500).json({ message: 'Failed to fetch sender IDs' });
    }
});
// ---------- DEBUG: CHECK SENDER ID STRUCTURE ----------
app.get('/debug/sender-ids', authenticateToken, async (req, res) => {
  try {
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const senderIds = userData.senderIds || [];

    const detailed = senderIds.map((s, idx) => ({
      index: idx,
      senderId: s.senderId,
      senderId_type: typeof s.senderId,
      status: s.status,
      status_type: typeof s.status,
      status_trimmed: String(s.status || '').trim(),
      status_lowercase: String(s.status || '').trim().toLowerCase(),
      is_approved: String(s.status || '').trim().toLowerCase() === 'approved',
      id: s.id,
      createdAt: s.createdAt,
      raw: JSON.stringify(s)
    }));

    res.json({
      userId: req.user.uid,
      totalSenders: senderIds.length,
      senders: detailed,
      rawSenderIds: senderIds
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- ADMIN: GET ALL SENDER ID REQUESTS ----------
app.get('/admin/sender-ids', authenticateToken, async (req, res) => {
  try {
    // Simple admin check - you might want to enhance this
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    if (!userData.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const requestsSnapshot = await db.collection('senderIdRequests')
      .orderBy('createdAt', 'desc')
      .get();

    const requests = requestsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: toDate(data.createdAt)?.toISOString(),
        reviewedAt: toDate(data.reviewedAt)?.toISOString()
      };
    });

    res.json(requests);
  } catch (err) {
    console.error('Error fetching sender ID requests:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- ADMIN: UPDATE SENDER ID STATUS ----------
app.patch('/admin/sender-ids/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, reason } = req.body;

    // Admin check
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    if (!userData.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be "approved" or "rejected"' });
    }

    const requestRef = db.collection('senderIdRequests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({ message: 'Sender ID request not found' });
    }

    const requestData = requestDoc.data();

    // Update the main request
    await requestRef.update({
      status,
      reason: reason || null,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: req.user.uid
    });

    // Update in user's senderIds array
    const userRequestRef = db.collection('users').doc(requestData.userId);
    const userRequestDoc = await userRequestRef.get();
    const userRequestData = userRequestDoc.data() || {};

    console.log('📝 Updating sender IDs for user:', requestData.userId);
    console.log('Before update:', JSON.stringify(userRequestData.senderIds, null, 2));

    const now = admin.firestore.Timestamp.now();
    const updatedSenderIds = (userRequestData.senderIds || []).map(sender => {
      if (sender.id === requestId) {
        const updated = {
          ...sender,
          status,
          reason: reason || null,
          reviewedAt: now,
          reviewedBy: req.user.uid
        };
        console.log(`✏️  Updating sender ${sender.senderId}:`, JSON.stringify(updated, null, 2));
        return updated;
      }
      return sender;
    });

    console.log('After update:', JSON.stringify(updatedSenderIds, null, 2));

    await userRequestRef.update({
      senderIds: updatedSenderIds
    });

    res.json({
      message: `Sender ID request ${status} successfully`,
      requestId,
      status
    });

  } catch (err) {
    console.error('Error updating sender ID status:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- API INTEGRATION: SEND SMS VIA API KEY ----------
app.post('/v1/sms/send', authenticateApiKey, async (req, res) => {
  let { phoneNumbers, message, senderId } = req.body;

  // Validate required fields
  if (!phoneNumbers || !message) {
    return res.status(400).json({ 
      success: false,
      message: 'phoneNumbers and message are required' 
    });
  }

  // rate limit check per user
  if (!isAllowedToSend(req.user.uid)) {
    return res.status(429).json({ success: false, message: 'Too many send requests, please wait a bit.' });
  }

  // normalise sender id early
  senderId = normalizeSenderId(senderId) || 'TAPSA';

  try {
    // Normalize phone numbers
    if (typeof phoneNumbers === 'string') {
      phoneNumbers = phoneNumbers.split(',').map(p => p.trim()).filter(p => p.length > 0);
    } else if (!Array.isArray(phoneNumbers)) {
      return res.status(400).json({ 
        success: false,
        message: 'phoneNumbers must be a string or an array' 
      });
    }

    // Check user balance
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userBalance = userDoc.exists ? userDoc.data().balance || 0 : 0;

    if (userBalance < phoneNumbers.length) {
      return res.status(400).json({
        success: false,
        message: `Insufficient SMS balance. You have ${userBalance}, but trying to send to ${phoneNumbers.length} recipient(s).`
      });
    }

    // Validate sender ID
    const userData = userDoc.data() || {};
    const userSenderIds = userData.senderIds || [];
    
    if (senderId !== 'TAPSA') {
      console.log('🔍 Validating sender ID:', senderId);
      console.log('📋 User sender IDs:', JSON.stringify(userSenderIds, null, 2));
      
      const allowedSender = userSenderIds.find(s => {
        const senderIdMatch = s.senderId === senderId;
        const statusValue = String(s.status || '').trim().toLowerCase();
        const statusMatch = statusValue === 'approved';
        console.log(`  Checking: senderId="${s.senderId}" (match:${senderIdMatch}), status="${s.status}" -> "${statusValue}" (match:${statusMatch})`);
        return senderIdMatch && statusMatch;
      });
      
      if (!allowedSender) {
        console.log('❌ No approved sender found!');
        return res.status(400).json({
          success: false,
          message: `Sender ID "${senderId}" not approved or not found. Use "TAPSA" or request a custom sender ID.`
        });
      }
      console.log('✅ Sender ID approved!');
    }

    // Format numbers to international format
    const formattedNumbers = phoneNumbers.map(num => {
      const s = String(num).trim();
      if (s.startsWith('+')) return s;
      if (s.startsWith('0')) return '+255' + s.slice(1);
      if (s.startsWith('255')) return '+' + s;
      return s;
    });

    // send through helper which handles splitting/retries
    const recipients = await sendViaAfricasTalking(formattedNumbers, message, senderId, 1);

    // Deduct only successful deliveries
    const successful = recipients.filter(r => 
      r.status && r.status.toLowerCase() === 'success'
    );
    
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(-successful.length)
    });

    // Update API key last used
    const apiKeysSnapshot = await userRef.collection('apiKeys')
      .where('key', '==', req.apiKey)
      .limit(1)
      .get();

    if (!apiKeysSnapshot.empty) {
      const apiKeyDoc = apiKeysSnapshot.docs[0];
      await userRef.collection('apiKeys').doc(apiKeyDoc.id).update({
        lastUsed: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Log each message
    for (const r of recipients) {
      await userRef.collection('smsHistory').doc(r.messageId || uuidv4()).set({
        number: r.number || 'Unknown',
        message,
        senderId,
        status: r.status || 'Unknown',
        cost: '30',
        statusCode: r.statusCode || 'N/A',
        messageId: r.messageId || uuidv4(),
        timestamp: admin.firestore.Timestamp.now(),
        via: 'api' // Mark as sent via API
      });
    }

    res.json({
      success: true,
      message: recipients.length ? (recipients[0].statusMessage || 'Messages processed.') : 'No recipients processed.',
      senderId,
      recipients,
      deducted: successful.length,
      remainingBalance: userBalance - successful.length
    });

  } catch (err) {
    console.error('API Send SMS error:', err.response?.data || err.message);
    if (err.response && err.response.status === 429) {
      return res.status(429).json({ success: false, message: 'Provider rate limit exceeded, try again later' });
    }
    res.status(500).json({ 
      success: false,
      error: err.response?.data || err.message 
    });
  }
});

// ---------- API INTEGRATION: CHECK BALANCE ----------
app.get('/v1/account/balance', authenticateApiKey, async (req, res) => {
  try {
    res.json({
      success: true,
      balance: req.user.balance || 0,
      currency: 'TZS',
      smsRate: 30 // Cost per SMS in TZS
    });
  } catch (err) {
    console.error('API Balance check error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// ---------- DASHBOARD STATS ----------
app.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const balance = userDoc.exists ? userDoc.data().balance || 0 : 0;

    // Get total sent messages count
    const historyRef = userRef.collection('smsHistory');
    const snapshot = await historyRef.get();
    const sentCount = snapshot.size;

    // Get recent 5 messages
    const recentSnap = await historyRef
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    const recentMessages = recentSnap.docs.map(doc => {
      const data = doc.data();
      return {
        recipient: data.number || 'Unknown',
        cost: data.cost || '30',
        status: data.status || 'Unknown',
        timestamp: toDate(data.timestamp) || new Date(),
        senderId: data.senderId || 'TAPSA'
      };
    });

    res.json({
      sentCount,
      remainingCount: balance,
      balance,
      recentMessages,
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- BUY SMS CREDITS ----------
app.post('/buy', authenticateToken, async (req, res) => {
  const { smsCount, buyer_email, buyer_name, buyer_phone } = req.body;

  if (!smsCount || smsCount < 1) {
    return res.status(400).json({ message: 'smsCount must be at least 1' });
  }
  if (!buyer_email || !buyer_name || !buyer_phone) {
    return res.status(400).json({ message: 'buyer_email, buyer_name, and buyer_phone are required' });
  }
  // enforce country code prefix
  if (!/^255\d{9}$/.test(buyer_phone)) {
    return res.status(400).json({ message: 'buyer_phone must be 12 digits, starting with 255' });
  }

  const totalPrice = smsCount * 30;
  if (totalPrice < 500) {
    const minSms = Math.ceil(500 / 30);
    return res.status(400).json({
      message: `Minimum purchase is 500 TZS (${minSms} SMS). Please buy at least ${minSms} SMS.`
    });
  }

  const orderId = uuidv4();

  try {
    const response = await axios.post(
      'https://zenoapi.com/api/payments/mobile_money_tanzania',
      {
        order_id: orderId,
        buyer_email,
        buyer_name,
        buyer_phone,
        amount: totalPrice,
        webhook_url: `${process.env.WEBHOOK_URL}/zenopay-webhook`
      },
      {
        headers: {
          'x-api-key': process.env.ZENOPAY_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    await db.collection('transactions').doc(orderId).set({
      userId: req.user.uid,
      sms_to_add: smsCount,
      amount: totalPrice,
      buyer_email,
      buyer_name,
      buyer_phone,
      status: 'PENDING',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ payment: response.data, order_id: orderId, total_sms: smsCount });

  } catch (err) {
    console.error('ZenoPay error:', err.response?.data || err.message);
    if (err.response) {
      return res.status(err.response.status).json({ error: err.response.data });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ---------- ZENOPAY WEBHOOK ----------
app.post('/zenopay-webhook', async (req, res) => {
  const { order_id, payment_status } = req.body;
  if (!order_id || !payment_status) return res.status(400).send('Missing fields');

  try {
    const txnRef = db.collection('transactions').doc(order_id);
    const txnDoc = await txnRef.get();

    if (!txnDoc.exists) {
      await db.collection('webhook_logs').doc(order_id).set({
        status: 'retry_pending',
        payload: req.body,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'Transaction not found',
      });
      return res.status(202).send('Webhook saved for retry');
    }

    const txnData = txnDoc.data();
    const userRef = db.collection('users').doc(txnData.userId);

    if (payment_status.toUpperCase() === 'COMPLETED') {
      await txnRef.update({
        status: 'COMPLETED',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await userRef.set(
        {
          balance: admin.firestore.FieldValue.increment(txnData.sms_to_add),
          email: txnData.buyer_email || undefined,
          name: txnData.buyer_name || undefined,
        },
        { merge: true }
      );

      console.log(`✅ Payment completed for order ${order_id}. User ${txnData.userId} balance updated.`);
    } else {
      await txnRef.update({ status: payment_status });
      console.log(`ℹ️ Payment status for order ${order_id} updated to ${payment_status}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SEND SMS (WEB) ----------
app.post('/send', authenticateToken, async (req, res) => {
  let { phoneNumbers, message, senderId, enqueue = 1 } = req.body;

  // simple rate limit
  if (!isAllowedToSend(req.user.uid)) {
    return res.status(429).json({ success: false, message: 'Too many send requests, please wait a bit.' });
  }

  // normalise & default
  senderId = normalizeSenderId(senderId) || 'TAPSA';

  // Validate sender ID format
  if (!/^[A-Za-z0-9_]{3,11}$/.test(senderId)) {
    return res.status(400).json({ 
      message: 'Invalid Sender ID format. Use 3–11 letters/numbers only.' 
    });
  }

  // Validate required fields
  if (!phoneNumbers || !message) {
    return res.status(400).json({ message: 'phoneNumbers and message are required.' });
  }

  try {
    // Check if user is allowed to use this sender ID
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const userSenderIds = userData.senderIds || [];
    
    if (senderId !== 'TAPSA') {
      console.log('🔍 Validating sender ID (WEB):', senderId);
      console.log('📋 User sender IDs:', JSON.stringify(userSenderIds, null, 2));
      
      const allowedSender = userSenderIds.find(s => {
        const senderIdMatch = s.senderId === senderId;
        const statusValue = String(s.status || '').trim().toLowerCase();
        const statusMatch = statusValue === 'approved';
        console.log(`  Checking: senderId="${s.senderId}" (match:${senderIdMatch}), status="${s.status}" -> "${statusValue}" (match:${statusMatch})`);
        return senderIdMatch && statusMatch;
      });
      
      if (!allowedSender) {
        console.log('❌ No approved sender found!');
        return res.status(400).json({
          message: `Sender ID "${senderId}" not approved. Please request approval first.`
        });
      }
      console.log('✅ Sender ID approved!');
    }

    // Normalize phone numbers
    if (typeof phoneNumbers === 'string') {
      phoneNumbers = phoneNumbers.split(',').map(p => p.trim()).filter(p => p.length > 0);
    } else if (!Array.isArray(phoneNumbers)) {
      return res.status(400).json({ message: 'phoneNumbers must be a string or an array.' });
    }

    const userBalance = userData.balance || 0;

    if (userBalance < phoneNumbers.length) {
      return res.status(400).json({
        message: `Insufficient SMS balance. You have ${userBalance}, but trying to send to ${phoneNumbers.length} recipient(s).`
      });
    }

    // Format numbers to international format
    const formattedNumbers = phoneNumbers.map(num => {
      const s = String(num).trim();
      if (s.startsWith('+')) return s;
      if (s.startsWith('0')) return '+255' + s.slice(1);
      if (s.startsWith('255')) return '+' + s;
      return s;
    });

    const recipients = await sendViaAfricasTalking(formattedNumbers, message, senderId, enqueue);

    // Deduct only successful deliveries
    const successful = recipients.filter(r => 
      r.status && r.status.toLowerCase() === 'success'
    );
    await userRef.update({
      balance: admin.firestore.FieldValue.increment(-successful.length)
    });

    // Log each message with senderId
    for (const r of recipients) {
      await userRef.collection('smsHistory').doc(r.messageId || uuidv4()).set({
        number: r.number || 'Unknown',
        message,
        senderId,
        status: r.status || 'Unknown',
        cost: '30',
        statusCode: r.statusCode || 'N/A',
        messageId: r.messageId || uuidv4(),
        timestamp: admin.firestore.Timestamp.now(),
        via: 'web'
      });
    }

    res.json({
      success: true,
      message: recipients.length ? (recipients[0].statusMessage || 'Messages processed.') : 'No recipients processed.',
      senderId,
      recipients,
      deducted: successful.length,
      remainingBalance: userBalance - successful.length
    });

  } catch (err) {
    console.error('Africas Talking error:', err.response?.data || err.message);
    if (err.response && err.response.status === 429) {
      return res.status(429).json({ success: false, message: 'Provider rate limit exceeded, please try again shortly.' });
    }
    res.status(500).json({ 
      success: false,
      error: err.response?.data || err.message 
    });
  }
});

// ---------- GET SMS HISTORY ----------
app.get('/history', authenticateToken, async (req, res) => {
  try {
    const historyRef = db.collection('users').doc(req.user.uid).collection('smsHistory');
    const snapshot = await historyRef.orderBy('timestamp', 'desc').get();
    const history = snapshot.docs.map(doc => doc.data());
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SERVE FRONTEND ----------
// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// API health check endpoint (optional)
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Catch-all: serve index.html for any non-API route (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

