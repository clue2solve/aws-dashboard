#!/bin/bash
set -e

echo "Building AWS Dashboard..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Build frontend
echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..

# Copy frontend build to backend/static
echo "Copying frontend to backend..."
rm -rf backend/static
cp -r frontend/dist backend/static

# Build container with Pack
echo "Building container with Pack CLI..."
pack build aws-dashboard \
  --path backend \
  --builder paketobuildpacks/builder-jammy-base \
  --env BP_CPYTHON_VERSION=3.12

echo "Build complete!"
echo ""
echo "Run with: docker run -p 54321:54321 -v ~/.aws:/root/.aws:ro -v ~/.kube:/root/.kube:ro aws-dashboard"
