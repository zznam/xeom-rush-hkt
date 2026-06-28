#!/bin/bash
set -e

echo "=========================================="
echo "🚀 Xeom Rush Deployment Script (CLI)"
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
echo "1. Login to Railway: "
echo "   run 'railway login'"
echo ""
echo "2. Initialize the project: "
echo "   run 'railway init'"
echo ""
echo "3. Add MongoDB database: "
echo "   run 'railway add' -> Select 'MongoDB'"
echo ""
echo "4. Deploy Backend: "
echo "   run 'railway up'"
echo ""
echo "5. Note the deployment URL of your backend (e.g. xeom-backend.up.railway.app)."
echo ""

echo "=========================================="
echo "🌐 Phase 2: Frontend Client (Vercel)"
echo "=========================================="
echo "1. Configure the Frontend connection URL:"
echo "   run 'vercel env add VITE_WS_URL'"
echo "   (Enter the wss:// URL from Railway, e.g. wss://xeom-backend.up.railway.app)"
echo ""
echo "2. Deploy Frontend: "
echo "   run 'vercel --prod'"
echo ""
echo "=========================================="
echo "🎉 Deployment complete!"
