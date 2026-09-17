"""MCP tools for lightweight Observation Job capture."""

from connection.acad import AutoCADNotRunningError
from services.observation_capture_service import (
    ObservationCaptureServiceError,
    cancel_observation_capture,
    finish_observation_capture,
    observation_capture_status,
    start_observation_capture,
)
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, ObservationCaptureServiceError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected Observation capture tool error")
        raise RuntimeError(f"Unexpected Observation capture tool error: {exc}") from exc


def register(mcp):
    @mcp.tool()
    def cad_observation_capture_start() -> dict:
        """Start lightweight ObjectAdded capture on the bound drawing.

        The capture phase stores only handles for newly appended drawing
        objects. It does not enumerate the drawing or read full properties.
        """
        return _safe(start_observation_capture)

    @mcp.tool()
    def cad_observation_capture_status() -> dict:
        """Return lightweight status for the current Observation capture."""
        return _safe(observation_capture_status)

    @mcp.tool()
    def cad_observation_capture_finish(
        include_paper_space: bool = True,
    ) -> dict:
        """Stop capture and return surviving top-level candidate headers.

        Finalization resolves only handles observed since capture start, drops
        erased/undone/nested/block-definition objects, and returns identity +
        object type. It never performs a full-drawing scan.
        """
        return _safe(finish_observation_capture, include_paper_space)

    @mcp.tool()
    def cad_observation_capture_cancel() -> dict:
        """Stop capture and discard collected handles without finalization."""
        return _safe(cancel_observation_capture)
