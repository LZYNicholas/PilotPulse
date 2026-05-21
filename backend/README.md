# Backend Database Setup

## What this folder contains

- SQLAlchemy models for the core PostgreSQL schema
- Alembic migration config
- An initial migration that creates the v1 tables

## Before running migrations

1. Copy `.env.example` to `.env`
2. Replace `DATABASE_URL` with your real Supabase Postgres connection string

## Commands

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
```
