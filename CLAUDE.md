# AWS Dashboard - Claude Rules

## Port Configuration
When working on this project, always check `config.json` for port numbers before making any network-related changes.

- Backend port: Read from `config.json` -> `ports.backend`
- Frontend port: Read from `config.json` -> `ports.frontend`

## AWS Configuration
AWS-related identifiers are stored in `config.json` -> `aws`:
- Identity Store ID
- SSO Instance ARN
- Account ID

## Project Structure
- `/backend` - FastAPI backend (Python)
- `/frontend` - React frontend with MUI and Framer Motion (TypeScript)
- `/electron` - Electron desktop app wrapper

## Running the Application

### Web Version
1. Backend: `cd backend && pip install -r requirements.txt && python main.py`
2. Frontend: `cd frontend && npm install && npm run dev`
3. Or use: `npm start` from root (runs both concurrently)

### Desktop App (Electron)
1. Development: `npm run electron:dev` (starts backend automatically)
2. Build: `npm run electron:build` (creates .app bundle)
