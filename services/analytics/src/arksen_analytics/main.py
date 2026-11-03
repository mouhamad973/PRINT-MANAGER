"""Point d'entrée FastAPI. Le moteur CMJN et l'analyse PDF arrivent en Phases 5 et 6."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from arksen_analytics import __version__

app = FastAPI(title="ARKSEN Analytics", version=__version__)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="analytics", version=__version__)
