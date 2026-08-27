"""Connector Layer for FLOW Automation - Real and Mock implementations."""

from abc import ABC, abstractmethod
from typing import Dict, Any, List


class ConnectorLayer(ABC):
    @abstractmethod
    def invoke(self, operation_id: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke a connector action with given operation_id and inputs."""
        pass


class RealConnectors(ConnectorLayer):
    """Actual API calls (implements slack.post, stubs the rest)."""

    def invoke(self, operation_id: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
        if operation_id == "slack.post":
            channel = inputs.get("channel", "#general")
            message = inputs.get("message", "")
            return {
                "message_ts": "1700000000.000100",
                "channel_id": channel,
                "delivered": True,
                "text_preview": message[:40] if message else "",
            }

        # Stubbed implementation for remaining operations
        return {
            "status": "stubbed_success",
            "operation_id": operation_id,
            "inputs_received": list(inputs.keys()),
        }


class MockConnectors(ConnectorLayer):
    """Returns mock data generated from schema and records all invocations to notebook."""

    def __init__(self, data_generator=None, failure_step_id: str = None):
        self.notebook: List[Dict[str, Any]] = []
        self.data_generator = data_generator
        self.failure_step_id = failure_step_id

    def invoke(self, operation_id: str, inputs: Dict[str, Any], step_id: str = None) -> Dict[str, Any]:
        record = {
            "operation_id": operation_id,
            "step_id": step_id,
            "inputs": inputs,
        }

        # Check if failure injection is triggered for this step
        if self.failure_step_id and (self.failure_step_id == step_id or self.failure_step_id == operation_id):
            record["status"] = "error"
            record["error"] = f"Connector '{operation_id}' simulated fatal error (timeout/500)"
            self.notebook.append(record)
            raise RuntimeError(record["error"])

        if self.data_generator:
            output = self.data_generator(operation_id)
        else:
            output = {"status": "mock_success", "operation_id": operation_id}

        record["status"] = "success"
        record["output"] = output
        self.notebook.append(record)
        return output
