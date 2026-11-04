"""Faux serveur ARKSEN pour tester la synchronisation sans réseau : il applique les règles du
vrai protocole (jeton, idempotence par identifiant d'événement) et peut simuler des pannes."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

import httpx

TOKEN = "ark_" + "A" * 43


class FakeServer:
    def __init__(self, printers: list[dict[str, Any]] | None = None) -> None:
        self.code = "ABCD-EFGH-JKLM-NPQR"
        self.agent_id = str(uuid.uuid4())
        self.tenant_id = str(uuid.uuid4())
        self.printers = printers or []
        self.received: dict[str, dict[str, Any]] = {}
        self.batches: list[list[str]] = []
        self.revoked = False
        #: Panne à simuler sur le prochain envoi d'événements.
        self.failure: Callable[[httpx.Request], httpx.Response] | None = None
        #: Traite le lot puis coupe la connexion avant la réponse.
        self.drop_response = False
        self.reject_types: set[str] = set()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        assert path.startswith("/backend/api/v1/agent/v1/")
        route = path.removeprefix("/backend/api/v1/agent/v1")
        if route == "/enroll":
            body = json.loads(request.content)
            if body["code"] != self.code:
                return httpx.Response(401, json={"message": "Code d’enregistrement inconnu."})
            return httpx.Response(
                201,
                json={
                    "agentId": self.agent_id,
                    "tenantId": self.tenant_id,
                    "name": "Agent de test",
                    "token": TOKEN,
                },
            )
        if request.headers.get("Authorization") != f"Bearer {TOKEN}" or self.revoked:
            return httpx.Response(401, json={"message": "Agent inconnu ou révoqué."})
        if route == "/config":
            return httpx.Response(
                200,
                json={
                    "agent": {"id": self.agent_id, "name": "Agent de test"},
                    "printers": self.printers,
                    "serverTime": "2026-11-06T08:00:00.000Z",
                },
            )
        if route == "/events":
            if self.failure:
                failure, self.failure = self.failure, None
                return failure(request)
            events = json.loads(request.content)["events"]
            self.batches.append([item["id"] for item in events])
            acks = []
            for item in events:
                if item["id"] in self.received:
                    acks.append({"id": item["id"], "status": "duplicate"})
                elif item["type"] in self.reject_types:
                    self.received[item["id"]] = item
                    acks.append({"id": item["id"], "status": "rejected", "error": "Refusé."})
                else:
                    self.received[item["id"]] = item
                    acks.append({"id": item["id"], "status": "accepted"})
            if self.drop_response:
                self.drop_response = False
                raise httpx.ReadTimeout("connexion coupée", request=request)
            return httpx.Response(200, json={"acks": acks, "serverTime": "2026-11-06T08:00:00Z"})
        return httpx.Response(404)
