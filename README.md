# TAPSA Bulk SMS - Combined Web Application

A full-stack web application that combines a Node.js/Express backend with an HTML/CSS/JS frontend into a single deployable unit.

## Recommended Folder Structure

```
tapsa-combined/
├── backend/                  # Express API server
│   ├── index.js              # Main server file (API routes + static file serving)
│   ├── firebase.js           # Firebase Admin SDK initialization
│   ├── lib/
│   │   └── sms-bulk-tz.js    # TAPSA SMS client library
│   ├── package.json          # Backend dependencies
│   ├── .env                  # Environment variables (not in git)
│   └── serviceAccount.json   # Firebase service account (not in git)
├── frontend/                 # Static frontend files
│   ├── index.html            # Single Page Application entry
│   ├── css/
│   │   └── style.css         # Styles
│   └── js/
│       └── app.js            # Frontend application logic
├── package.json              # Root project config + convenience scripts
├── .env.example              # Template for required env variables
├── .gitignore                # Excludes node_modules, .env, serviceAccount.json
└── README.md                 # This file
```

## How the Frontend is Served from the Backend

The backend uses Express static middleware to serve the `frontend/` folder:

```js
// backend/index.js
const path = require('path');

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check endpoint
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Catch-all: return index.html for any non-API route (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});
```

All API routes (e.g. `/me`, `/send`, `/contacts`) are defined **before** the catch-all `*` route. This ensures API calls are handled by the backend, while everything else loads the frontend SPA.

## Configuration Files

### Root `package.json`

```json
{
  "name": "tapsa-combined",
  "version": "2.0.0",
  "scripts": {
    "install:all": "npm install && cd backend && npm install",
    "start": "cd backend && npm start",
    "dev": "cd backend && npm run dev"
  }
}
```

### Backend `package.json`

Key dependencies:
- `express` — web server
- `cors`, `body-parser` — middleware
- `firebase-admin` — authentication & database
- `axios`, `xml2js` — Africa's Talking SMS integration
- `dotenv` — environment variables
- `multer`, `csv-parser`, `vcard-parser` — file uploads

### `.env` (create from `.env.example`)

| Variable | Description |
|----------|-------------|
| `AT_USERNAME` | Africa's Talking username |
| `AT_API_KEY` | Africa's Talking API key |
| `ZENOPAY_API_KEY` | Zenopay payment gateway key |
| `WEBHOOK_URL` | Public URL for payment webhooks |

### Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Download the **Service Account** JSON and save it as `backend/serviceAccount.json`.
3. In Firebase Console > Project Settings, copy the **Web API credentials**.
4. Paste them into `frontend/js/app.js` at the top (`firebaseConfig` object).
5. Enable **Email/Password** authentication in Firebase Auth.

## Running in Development

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure environment
cp .env.example backend/.env
# Edit backend/.env with your real keys

# 3. Place Firebase service account
# Copy your serviceAccount.json into backend/

# 4. Set Firebase client config
# Edit frontend/js/app.js and replace firebaseConfig placeholders

# 5. Start the dev server
npm run dev
```

The app runs on `http://localhost:5000` (or `PORT` from `.env`).

- Frontend: `http://localhost:5000/`
- API: `http://localhost:5000/me`, `/send`, etc.

## Running in Production

```bash
# Install only production dependencies
cd backend && npm install --production

# Start the server
npm start
```

For production, make sure:
- `NODE_ENV=production` is set (optional, for future middleware tuning)
- `.env` is populated with live credentials
- `backend/serviceAccount.json` is present
- The `frontend/` folder exists next to `backend/`

## Deployment

### Heroku

1. Create a `Procfile` in the project root:
   ```
   web: cd backend && node index.js
   ```
2. Set buildpack: `heroku/nodejs`.
3. Push the repository.
4. Add config vars in Heroku Dashboard (Settings > Config Vars) for all `.env` values.
5. Upload `serviceAccount.json` via Heroku CLI or use a base64-encoded string config var.

### Render / Railway / Fly.io

These platforms support Node.js apps directly:
1. Set the **start command** to `cd backend && node index.js`.
2. Upload environment variables via the platform dashboard.
3. Ensure the `frontend/` folder is included in the deployment.

### Vercel

Vercel is optimized for serverless. For a traditional Express app:
1. Add `vercel.json` to the root:
   ```json
   {
     "version": 2,
     "builds": [
       { "src": "backend/index.js", "use": "@vercel/node" }
     ],
     "routes": [
       { "src": "/(.*)", "dest": "backend/index.js" }
     ]
   }
   ```
2. Move or copy `frontend/` into `backend/` (or adjust `express.static` path) because Vercel only deploys files referenced by the entry point's directory.
3. Set environment variables in the Vercel dashboard.

### Netlify

Netlify also prefers serverless. Use the **Netlify Functions** adapter:
1. Install `netlify-cli` and `serverless-http`.
2. Create `netlify/functions/api.js`:
   ```js
   const serverless = require('serverless-http');
   const app = require('../../backend/index.js');
   module.exports.handler = serverless(app);
   ```
3. Add `_redirects`:
   ```
   /*    /index.html   200
   ```
4. For simpler deployment, consider using **Netlify Drop** for the frontend and keep the backend on Heroku/Render.

## Security Checklist

- [ ] `.env` is in `.gitignore`
- [ ] `serviceAccount.json` is in `.gitignore`
- [ ] Firebase client config uses restricted API keys (no admin privileges)
- [ ] API routes require valid Firebase ID tokens (`authenticateToken`)
- [ ] CORS is configured for your production domain only (instead of `*`)
- [ ] Rate limiting is enabled for public API endpoints
