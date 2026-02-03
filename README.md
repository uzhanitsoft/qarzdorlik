# Qarzdorlik Dashboard

Telegram Mini App for debt analytics.

## Deploy to Railway

1. Fork this repository
2. Go to [railway.app](https://railway.app)
3. New Project → Deploy from GitHub
4. Set environment variables:
   - `ADMIN_PASSWORD` = your password
   - `PORT` = 3000
5. Generate domain

## Usage

- **Admin Panel**: `https://your-domain/admin`
- **Mini App**: `https://your-domain/app`
- **API**: `https://your-domain/api/data`

## Files

- `server.js` - Express backend
- `package.json` - Dependencies
- `upload.html` - Admin panel
- `netlify-build/` - Mini App frontend
- `public/` - Static files
