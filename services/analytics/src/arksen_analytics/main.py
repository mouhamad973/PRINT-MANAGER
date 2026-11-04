"""Point d'entrée FastAPI : santé, moteur CMJN et analyse PDF."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from arksen_analytics import __version__
from arksen_analytics.cmyk_api import router as cmyk_router
from arksen_analytics.pdf_api import router as pdf_router

app = FastAPI(title="ARKSEN Analytics", version=__version__)
app.include_router(cmyk_router)
app.include_router(pdf_router)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="analytics", version=__version__)
