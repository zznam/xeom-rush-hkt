#!/bin/bash
set -e

echo "=========================================="
echo "🚀 Xeom Rush Deployment Setup Checklist"
echo "=========================================="
echo ""

# 1. Check for Vercel CLI
if ! command -v vercel &> /dev/null
then
    echo "❌ Vercel CLI could not be found. Please install it with:"
    echo "npm i -g vercel"
    exit 1
else
    echo "✅ Vercel CLI is installed. ($(vercel --version))"
fi

# 2. Check for Railway CLI
if ! command -v railway &> /dev/null
then
    echo "❌ Railway CLI could not be found. Please install it with:"
    echo "npm i -g @railway/cli"
    exit 1
else
    echo "✅ Railway CLI is installed."
fi

echo ""
echo "=========================================="
echo "🛠️  Phase 1: Backend & Database (Railway)"
echo "=========================================="
echo "1. Login to Railway if needed:"
echo "   railway login"
echo ""
echo "2. In Railway, create/open the project and connect this GitHub repo:"
echo "   https://github.com/zznam/xeom-rush-hkt"
echo ""
echo "3. Configure the backend service:"
echo "   - Trigger branch: main"
echo "   - Root directory: /"
echo "   - Config file: /railway.json"
echo "   - Builder: Dockerfile (from railway.json)"
echo ""
echo "4. Add MongoDB and set backend environment variables:"
echo "   - MONGODB_URI=<Railway MongoDB connection string>"
echo "   - PORT is injected by Railway; only set it manually if required."
echo ""
echo "5. Verify the backend health endpoint:"
echo "   https://<railway-domain>/api/health"
echo ""

echo "=========================================="
echo "🌐 Phase 2: Frontend Client (Vercel)"
echo "=========================================="
echo "1. Import the same GitHub repo into Vercel:"
echo "   https://github.com/zznam/xeom-rush-hkt"
echo ""
echo "2. Configure Vercel Git settings:"
echo "   - Production Branch: main"
echo "   - Build/output settings come from vercel.json"
echo ""
echo "3. Configure the frontend connection URL:"
echo "   vercel env add VITE_WS_URL production"
echo "   Use the Railway WebSocket URL, e.g. wss://xeom-backend.up.railway.app"
echo ""
echo "4. Merge to main to trigger production deploys on both platforms."
echo ""
echo "=========================================="
echo "🎉 Setup checklist complete!"
echo "Routine production releases should deploy from Git, not manual CLI pushes."
