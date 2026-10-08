"""Purpose-built, bounded Grille mutation surface (no raw SendCommand)."""
from connection.acad import AutoCADNotRunningError
from services.grille_service import GrilleServiceError, delete_grille_tags, update_grille_attributes
from services.handle_service import HandleResolutionError
from utils.logger import get_logger

log = get_logger(__name__)


def _safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (AutoCADNotRunningError, GrilleServiceError, HandleResolutionError) as exc:
        raise RuntimeError(str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected grille mutation error")
        raise RuntimeError("Unexpected grille mutation error: " + str(exc)) from exc


def register(mcp):
    @mcp.tool()
    def cad_update_grille_attributes(handle: str, updates: dict[str, str],
                                    expected_values: dict[str, str] | None = None) -> dict:
        """Update grille block ATT values by exact handle in the bound drawing.

        One bounded request updates multiple tags; verifies readback and reports
        already-correct fields after a retry. Optional expected_values protects
        against overwriting another user's changes. Never rewrites block
        geometry or unrelated ATT values. Read current ATT via cad_get_block.
        """
        return _safe(update_grille_attributes, handle, updates, expected_values)

    @mcp.tool()
    def cad_delete_grille_tags(handles: list[str], confirmed: bool = False,
                               expected_tag_numbers: dict[str, str] | None = None) -> dict:
        """Delete ONLY exact GR-* tag blocks on the Hvac-GrilleTag layer.

        Requires explicit user confirmation (confirmed=true). Unlike generic
        preview-token deletion this grille-specific operation is idempotent
        after a lost response: handles already absent are verified no-ops.
        Refuses other blocks, wrong layers and mismatched TAG_NUMBER values.
        Use for deleting existing grille TAGS, never for deleting grilles.
        """
        return _safe(delete_grille_tags, handles, confirmed, expected_tag_numbers)
