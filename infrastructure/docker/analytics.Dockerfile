# Service FastAPI d'analyse. Le contexte de build est la racine du dépôt.
FROM python:3.12-slim
WORKDIR /app
COPY services/analytics/pyproject.toml ./
COPY services/analytics/src ./src
RUN pip install --no-cache-dir --disable-pip-version-check .
RUN useradd --system --no-create-home arksen
USER arksen
EXPOSE 8000
CMD ["uvicorn", "arksen_analytics.main:app", "--host", "0.0.0.0", "--port", "8000"]
