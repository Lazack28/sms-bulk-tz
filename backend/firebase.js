// firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json"); // Make sure this file exists in your project

// Initialize Firebase Admin SDK with service account
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firestore database instance
const db = admin.firestore();

module.exports = { admin, db };
