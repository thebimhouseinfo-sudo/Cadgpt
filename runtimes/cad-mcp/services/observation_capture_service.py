"""Lightweight appended-object capture for Observation Jobs.

The capture phase is intentionally cheap: AutoCAD document ObjectAdded events
record only entity handles. Finalization resolves only those handles, discards
objects that no longer survive or are no longer top-level drawing entities, and
returns lightweight identity/type headers. Full property inspection is a
separate step owned by Observator/Job Runtime.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

import pythoncom
import pywintypes
import win32com.client

from config import AUTOCAD_PROGID
from connection.acad import get_active_document


class ObservationCaptureServiceError(RuntimeError):
    pass


def _retry(call, attempts: int = 3, delay: float = 0.05):
    last_error = None
    for attempt in range(attempts):
        try:
            return call()
        except pywintypes.com_error as exc:
            last_error = exc
            time.sleep(delay * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise ObservationCaptureServiceError("COM retry failed without an error")


def _document_identity(doc) -> tuple[str, str]:
    name = str(getattr(doc, "Name", "") or "")
    full_name = str(getattr(doc, "FullName", "") or "")
    return name, full_name


def _same_document(
    expected_name: str,
    expected_full_name: str,
    actual_name: str,
    actual_full_name: str,
) -> bool:
    if expected_full_name and actual_full_name:
        return expected_full_name.casefold() == actual_full_name.casefold()
    return expected_name.casefold() == actual_name.casefold()


def _get_acad_app_for_event_thread():
    # Keep the event thread's COM proxy thread-local instead of sharing the
    # cached proxy used by normal CAD MCP requests.
    progids = [
        "AutoCAD.Application",
        AUTOCAD_PROGID,
        "AutoCAD.Application.24.3",
        "AutoCAD.Application.24.2",
        "AutoCAD.Application.24.1",
        "AutoCAD.Application.24",
        "AutoCAD.Application.23.1",
        "AutoCAD.Application.23",
        "AutoCAD.Application.22",
    ]
    last_error = None
    for progid in dict.fromkeys(progids):
        try:
            return win32com.client.GetActiveObject(progid)
        except pywintypes.com_error as exc:
            last_error = exc
    raise ObservationCaptureServiceError(
        "AutoCAD COM is unavailable for Observation capture"
    ) from last_error


def _find_document(app, expected_name: str, expected_full_name: str):
    documents = app.Documents
    count = int(documents.Count)
    for index in range(count):
        try:
            doc = documents.Item(index)
            name, full_name = _document_identity(doc)
            if _same_document(
                expected_name,
                expected_full_name,
                name,
                full_name,
            ):
                return doc
        except Exception:
            continue
    raise ObservationCaptureServiceError(
        f"Observation drawing is no longer open: {expected_full_name or expected_name}"
    )


@dataclass
class _CaptureSession:
    capture_id: str
    document_name: str
    document_full_name: str
    started_at: float = field(default_factory=time.time)
    handles: list[str] = field(default_factory=list)
    handle_keys: set[str] = field(default_factory=set)
    error: str | None = None
    ready: threading.Event = field(default_factory=threading.Event)
    stop: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    thread: threading.Thread | None = None

    def record_entity(self, entity) -> None:
        """Record only stable identity from the ObjectAdded event."""
        try:
            handle = str(entity.Handle).strip()
        except Exception:
            return
        if not handle:
            return
        key = handle.casefold()
        with self.lock:
            if key in self.handle_keys:
                return
            self.handle_keys.add(key)
            self.handles.append(handle)

    def snapshot_handles(self) -> list[str]:
        with self.lock:
            return list(self.handles)


def _make_document_event_sink(session: _CaptureSession):
    class DocumentEventSink:
        def OnObjectAdded(self, entity):
            session.record_entity(entity)

    return DocumentEventSink


def _event_thread_main(session: _CaptureSession) -> None:
    pythoncom.CoInitialize()
    sink = None
    doc = None
    app = None
    try:
        app = _get_acad_app_for_event_thread()
        doc = _find_document(
            app,
            session.document_name,
            session.document_full_name,
        )
        sink = win32com.client.WithEvents(
            doc,
            _make_document_event_sink(session),
        )
        session.ready.set()

        while not session.stop.wait(0.05):
            pythoncom.PumpWaitingMessages()

        # Drain already-posted events before finalization.
        pythoncom.PumpWaitingMessages()
    except Exception as exc:
        session.error = str(exc)
        session.ready.set()
    finally:
        sink = None
        doc = None
        app = None
        pythoncom.CoUninitialize()


_manager_lock = threading.Lock()
_active_session: _CaptureSession | None = None


def _require_active_session() -> _CaptureSession:
    with _manager_lock:
        session = _active_session
    if session is None:
        raise ObservationCaptureServiceError("No Observation capture is active")
    return session


def start_observation_capture() -> dict:
    """Start one V1 drawing-scoped ObjectAdded capture session."""
    global _active_session

    doc = get_active_document()
    document_name, document_full_name = _document_identity(doc)

    with _manager_lock:
        if _active_session is not None:
            raise ObservationCaptureServiceError(
                "An Observation capture is already active"
            )

        session = _CaptureSession(
            capture_id=uuid.uuid4().hex,
            document_name=document_name,
            document_full_name=document_full_name,
        )
        session.thread = threading.Thread(
            target=_event_thread_main,
            args=(session,),
            name=f"cadgpt-observation-{session.capture_id[:8]}",
            daemon=True,
        )
        _active_session = session
        session.thread.start()

    if not session.ready.wait(timeout=5.0):
        cancel_observation_capture()
        raise ObservationCaptureServiceError(
            "Timed out while attaching the AutoCAD ObjectAdded listener"
        )

    if session.error:
        cancel_observation_capture()
        raise ObservationCaptureServiceError(
            f"Failed to start Observation capture: {session.error}"
        )

    return {
        "capture_id": session.capture_id,
        "document_name": session.document_name,
        "stage": "capturing",
        "captured_count": 0,
    }


def observation_capture_status() -> dict:
    with _manager_lock:
        session = _active_session
    if session is None:
        return {"active": False, "stage": "idle"}

    return {
        "active": True,
        "capture_id": session.capture_id,
        "document_name": session.document_name,
        "stage": "capturing",
        "captured_count": len(session.snapshot_handles()),
        "error": session.error,
    }


def _stop_session(session: _CaptureSession) -> None:
    session.stop.set()
    thread = session.thread
    if thread is not None:
        thread.join(timeout=3.0)
        if thread.is_alive():
            raise ObservationCaptureServiceError(
                "Observation event listener did not stop cleanly"
            )


def cancel_observation_capture() -> dict:
    """Stop capture and discard collected identities without resolving them."""
    global _active_session

    with _manager_lock:
        session = _active_session
        _active_session = None

    if session is None:
        return {"cancelled": False, "stage": "idle"}

    _stop_session(session)
    return {
        "cancelled": True,
        "capture_id": session.capture_id,
        "captured_count": len(session.snapshot_handles()),
        "stage": "idle",
    }


def _top_level_owner_map(doc, include_paper_space: bool) -> dict[int, str]:
    owners: dict[int, str] = {}

    model_space = doc.ModelSpace
    owners[int(model_space.ObjectID)] = "ModelSpace"

    if include_paper_space:
        for layout in doc.Layouts:
            try:
                name = str(layout.Name)
                if name.casefold() == "model":
                    continue
                block = layout.Block
                owners[int(block.ObjectID)] = f"Layout:{name}"
            except Exception:
                continue

    return owners


def finish_observation_capture(include_paper_space: bool = True) -> dict:
    """Stop capture and return lightweight headers for final top-level survivors."""
    global _active_session

    session = _require_active_session()
    _stop_session(session)

    with _manager_lock:
        if _active_session is session:
            _active_session = None

    if session.error:
        raise ObservationCaptureServiceError(
            f"Observation capture failed before finalization: {session.error}"
        )

    doc = get_active_document()
    actual_name, actual_full_name = _document_identity(doc)
    if not _same_document(
        session.document_name,
        session.document_full_name,
        actual_name,
        actual_full_name,
    ):
        raise ObservationCaptureServiceError(
            "The active drawing at Observation finalization does not match "
            "the drawing that was bound when capture started"
        )

    owner_map = _top_level_owner_map(doc, include_paper_space)
    handles = session.snapshot_handles()

    candidates: list[dict] = []
    unresolvable = 0
    non_top_level = 0
    header_failures = 0

    for handle in handles:
        try:
            entity = _retry(lambda h=handle: doc.HandleToObject(h))
        except Exception:
            unresolvable += 1
            continue

        try:
            owner_id = int(entity.OwnerID)
            space = owner_map.get(owner_id)
            if space is None:
                non_top_level += 1
                continue

            candidates.append(
                {
                    "handle": str(entity.Handle),
                    "object_id": int(entity.ObjectID),
                    "object_type": str(entity.ObjectName),
                    "space": space,
                }
            )
        except Exception:
            header_failures += 1

    return {
        "capture_id": session.capture_id,
        "document_name": session.document_name,
        "stage": "finalized",
        "captured_count": len(handles),
        "candidate_count": len(candidates),
        "candidates": candidates,
        "discarded": {
            "unresolvable_or_erased": unresolvable,
            "non_top_level_or_nested": non_top_level,
            "header_failures": header_failures,
        },
        "nested_traversal": False,
        "full_drawing_scan": False,
    }
