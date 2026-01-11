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

## Running the Application

### Development (separate processes)
1. Backend: `cd backend && pip install -r requirements.txt && python main.py`
2. Frontend: `cd frontend && npm install && npm run dev`

### Docker Deployment (Pack CLI)
1. Build: `./build.sh` (uses Pack CLI with Paketo buildpacks)
2. Run: `docker-compose up`

The build script:
- Builds the frontend
- Copies static files to backend/static
- Uses Pack CLI to create a container image
