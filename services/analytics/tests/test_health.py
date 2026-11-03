from fastapi.testclient import TestClient

from arksen_analytics import __version__
from arksen_analytics.main import app


def test_health_reports_service_and_version() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "analytics", "version": __version__}
