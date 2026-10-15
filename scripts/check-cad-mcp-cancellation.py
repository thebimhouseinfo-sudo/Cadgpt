"""Fail CI if the installed Python MCP SDK cannot parse cancellation.

The old mcp==1.2.1 excludes notifications/cancelled from
ClientNotification and a long CAD request's timeout used to crash stdio.
"""
from mcp.types import ClientNotification


def main() -> None:
    cancelled = ClientNotification.model_validate(
        {
            "method": "notifications/cancelled",
            "params": {"requestId": 22, "reason": "MCP request timed out"},
        }
    )
    assert cancelled.root.method == "notifications/cancelled"
    assert cancelled.root.params.requestId == 22
    print("Python MCP cancellation notification parser: PASS")


if __name__ == "__main__":
    main()
