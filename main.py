from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import auth
import task
from database import Base, engine, migrate_legacy_schema

app = FastAPI(title="Task Management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)
migrate_legacy_schema()
Base.metadata.create_all(bind=engine)

app.include_router(auth.router, tags=["Auth"])
app.include_router(task.router, tags=["Tasks"])


@app.get("/api-status")
def home():
    return {"message": "Task Management API is running"}

app.mount("/", StaticFiles(directory="static", html=True), name="static")
