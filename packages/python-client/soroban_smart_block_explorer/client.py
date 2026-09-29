from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, TypeVar, Union

import requests

T = TypeVar("T")


class SorobanExplorerClient:
    def __init__(self, base_url: str = "http://localhost:3001", api_key: Optional[str] = None, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, method: str, path: str, params: Optional[Dict[str, Any]] = None, json_body: Optional[Dict[str, Any]] = None) -> Any:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        response = requests.request(
            method=method.upper(),
            url=f"{self.base_url}{path}",
            params=params,
            headers=headers,
            json=json_body,
            timeout=self.timeout,
        )
        if not response.ok:
            try:
                payload = response.json()
                detail = payload.get("error") if isinstance(payload, dict) else str(payload)
            except Exception:
                detail = response.text
            raise RuntimeError(f"{response.status_code}: {detail}")
        try:
            return response.json()
        except ValueError:
            return response.text

    def get_health(self) -> Dict[str, Any]:
        return self._request("GET", "/api/health")

    def get_event(self, seq: int) -> Dict[str, Any]:
        return self._request("GET", f"/api/events/{seq}")

    def get_events(self, contract: Optional[str] = None, fn: Optional[str] = None, type: Optional[str] = None, after_seq: Optional[int] = None, limit: int = 25) -> Dict[str, Any]:
        params: Dict[str, Any] = {"limit": limit}
        if contract is not None:
            params["contract"] = contract
        if fn is not None:
            params["fn"] = fn
        if type is not None:
            params["type"] = type
        if after_seq is not None:
            params["after_seq"] = after_seq
        return self._request("GET", "/api/events", params=params)

    def get_contract(self, contract_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/api/contracts/{contract_id}")

    def list_contracts(self, page: int = 1, limit: int = 25, type: Optional[str] = None, q: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"page": page, "limit": limit}
        if type is not None:
            params["type"] = type
        if q is not None:
            params["q"] = q
        return self._request("GET", "/api/contracts", params=params)

    def get_wallet(self, address: str, from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if from_date is not None:
            params["from"] = from_date
        if to_date is not None:
            params["to"] = to_date
        return self._request("GET", f"/api/wallet/{address}", params=params)

    def search(self, query: str, limit: int = 10) -> Dict[str, Any]:
        return self._request("GET", "/api/search", params={"q": query, "limit": limit})
