# WeeGrid

WeeGrid is a HackBelfast project for the Belfast 2036 theme.

It helps streets explore community energy co-ops by modeling collective rooftop solar, shared storage, and loan-backed installation economics.

**Features:**
- Smart cluster detection for local areas
- Real solar yield calculations (PVGIS API)
- Multi-dataset area due-diligence scoring
- Creative impact storytelling
- DeFi Mode (toggle to see speculative Solana returns for co-op savings)

## Project Structure

- `frontend/`: Next.js web app (React + Tailwind)
- `backend/`: FastAPI backend API (health + scenario calculation)

## Run Both (Single Root Command)

```bash
npm install
npm run dev
```

This starts:
- frontend on `http://localhost:3000`
- backend on `http://127.0.0.1:8000`

Backend health check: `http://127.0.0.1:8000/health`

Backend API endpoints:
- `GET /api/v1/geocode?postcode=...` (postcode → lat/lon via postcodes.io)
- `GET /api/v1/solar-yield?lat=...&lon=...` (PVGIS solar yield + sun hours)
- `GET /api/v1/cluster?lat=...&lon=...&label=...` (building cluster + Overpass + geometry)
- `POST /api/v1/scenario/calculate` (explicit assumptions supplied)
- `POST /api/v1/scenario/calculate-smart` (backend builds smart assumptions)
- `POST /api/v1/inquiry/analyze` (multi-dataset cluster due-diligence scoring)
- `POST /api/v1/insights/generate` (storytelling insights from scenario results)

## First-Time Backend Dependency Setup

```bash
pip install -r backend/requirements.txt
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Optional environment variable (frontend):

```bash
BACKEND_API_BASE_URL=http://127.0.0.1:8000
```

Used by `frontend/app/api/scenario/route.ts` and
`frontend/app/api/scenario-smart/route.ts` to call FastAPI from Next.js.

## Backend Tests

```bash
cd backend
python -m unittest discover -s tests -p "test_*.py"
```

## Run Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
