import fs from "node:fs/promises";
import path from "node:path";

import { getDrawingStorageRoot } from "../lib/appdata.js";
import { isPathInside, toCadgptPath } from "../lib/path-security.js";
import { withFileMutationLocks } from "./file-scheduler.js";
import { cadUpstream } from "./cad-upstream.js";
import {
  activateDrawingContext,
  removeDrawingContextForExecution,
  type BoundDrawing,
} from "../session/drawing-binding.js";

export const DRAWING_ANCHOR_SCHEMA_VERSION = 1;
const SAFE_DRAWING_ANCHOR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const metadataRootsByExecution = new Map<string, Set<string>>();
const lastCreatedMetadataFolderByExecution = new Map<string, string>();

function extractUpstreamPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (obj.structuredContent !== undefined) return obj.structuredContent;
  const text = obj.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  )?.text;
  if (text === undefined) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isToolErrorResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { isError?: boolean }).isError === true
  );
}

function payloadField(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;
  if (key in obj) return obj[key];
  for (const container of ["data", "result"]) {
    const nested = obj[container];
    if (
      nested &&
      typeof nested === "object" &&
      key in (nested as Record<string, unknown>)
    ) {
      return (nested as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

function assertSafeDrawingAnchor(value: unknown): string {
  const anchor = typeof value === "string" ? value.trim() : "";
  if (
    !anchor ||
    anchor.length > 180 ||
    !SAFE_DRAWING_ANCHOR.test(anchor) ||
    anchor === "." ||
    anchor === ".."
  ) {
    throw new Error(
      "DRAWING_ANCHOR_INVALID: CAD MCP returned an unsafe drawing_anchor."
    );
  }
  return anchor;
}

export async function ensureDrawingAnchorForBinding(
  binding: BoundDrawing
): Promise<{
  drawing_anchor: string;
  schema_version: number;
  created: boolean;
  state: string;
  verified_readback: boolean;
}> {
  try {
    await activateDrawingContext(binding);
    const raw = await cadUpstream.callTool("cad_ensure_drawing_anchor", {
      document_name: binding.document_selector,
      runtime_document_id: binding.runtime_document_identity,
      preferred_anchor: binding.drawing_anchor ?? "",
    });
    if (isToolErrorResult(raw)) {
      throw new Error("CAD MCP failed to ensure the Drawing Anchor.");
    }

    const payload = extractUpstreamPayload(raw);
    const drawingAnchor = assertSafeDrawingAnchor(
      payloadField(payload, "drawing_anchor")
    );
    const schemaVersion = Number(payloadField(payload, "schema_version"));
    if (schemaVersion !== DRAWING_ANCHOR_SCHEMA_VERSION) {
      throw new Error(
        `DRAWING_ANCHOR_SCHEMA_UNSUPPORTED: expected ${DRAWING_ANCHOR_SCHEMA_VERSION}, received ${schemaVersion}.`
      );
    }

    const anchorState = String(
      payloadField(payload, "state") ?? ""
    );
    const verifiedReadback =
      payloadField(payload, "verified_readback") ===
        true ||
      anchorState === "existing";
    binding.drawing_anchor = drawingAnchor;
    binding.anchor_schema_version = schemaVersion;
    binding.anchor_state = anchorState || "unknown";
    binding.anchor_verified_readback =
      verifiedReadback;
    return {
      drawing_anchor: drawingAnchor,
      schema_version: schemaVersion,
      created:
        payloadField(payload, "created") === true,
      state: binding.anchor_state,
      verified_readback: verifiedReadback,
    };
  } catch (error) {
    removeDrawingContextForExecution(
      binding.execution_id,
      binding.drawing_id
    );
    throw error;
  }
}

function directDrawingRoot(drawingAnchor: string): string {
  const storageRoot = path.resolve(getDrawingStorageRoot());
  const target = path.resolve(storageRoot, drawingAnchor);
  if (
    path.dirname(target) !== storageRoot ||
    !isPathInside(target, storageRoot)
  ) {
    throw new Error(
      "DRAWING_METADATA_SCOPE: drawing_anchor does not resolve to one direct drawing root."
    );
  }
  return target;
}

export function drawingMetadataRootsForExecution(
  executionId: string
): string[] {
  return [
    ...(metadataRootsByExecution.get(executionId) ?? new Set<string>()),
  ];
}

export function authorizeDrawingMetadataRootForExecution(
  executionId: string,
  absoluteRoot: string
): void {
  const root = path.resolve(absoluteRoot);
  const storageRoot = path.resolve(getDrawingStorageRoot());
  if (
    path.dirname(root) !== storageRoot ||
    !isPathInside(root, storageRoot)
  ) {
    throw new Error(
      "DRAWING_METADATA_SCOPE: only one direct drawings/<drawing_anchor>/ root may be authorized."
    );
  }
  let roots = metadataRootsByExecution.get(executionId);
  if (!roots) {
    roots = new Set<string>();
    metadataRootsByExecution.set(executionId, roots);
  }
  roots.add(root);
}

export function registerCreatedDrawingMetadataFolderForExecution(
  executionId: string,
  absoluteRoot: string
): void {
  authorizeDrawingMetadataRootForExecution(executionId, absoluteRoot);
  lastCreatedMetadataFolderByExecution.set(
    executionId,
    path.resolve(absoluteRoot)
  );
}

/**
 * Hand off exactly one already CAD-verified drawing metadata root between
 * consecutive work executions in the SAME admitted conversation.
 *
 * This is not a path-based permission request: the source execution must have
 * obtained the canonical drawing root through drawing_metadata_location.
 * Multi-drawing contexts cannot be inferred and are intentionally rejected.
 * No CAD capability, runtime lease, source Job result-write authority, or
 * arbitrary AppData root is inherited.
 *
 * Ownership of an empty new drawing folder also moves: delayed cleanup of
 * Job A must not delete a root that Job B is about to populate.
 */
export function handoffVerifiedDrawingMetadataRoot(
  previousExecutionId: string,
  nextExecutionId: string
): string | null {
  if (previousExecutionId === nextExecutionId) return null;
  const roots = drawingMetadataRootsForExecution(previousExecutionId);
  if (roots.length !== 1) return null;
  const root = roots[0];
  // Recheck the canonical direct-child constraint even for internal callers.
  const storageRoot = path.resolve(getDrawingStorageRoot());
  if (path.dirname(root) !== storageRoot || !isPathInside(root, storageRoot)) {
    throw new Error("DRAWING_METADATA_HANDOFF_SCOPE: source is not a canonical drawing root.");
  }
  authorizeDrawingMetadataRootForExecution(nextExecutionId, root);
  if (lastCreatedMetadataFolderByExecution.get(previousExecutionId) === root) {
    lastCreatedMetadataFolderByExecution.delete(previousExecutionId);
    lastCreatedMetadataFolderByExecution.set(nextExecutionId, root);
  }
  return root;
}

export async function prepareDrawingMetadataLocation(
  executionId: string,
  binding: BoundDrawing
): Promise<Record<string, unknown>> {
  const anchor = await ensureDrawingAnchorForBinding(binding);
  const drawingRoot = directDrawingRoot(anchor.drawing_anchor);
  const storageRoot = path.resolve(getDrawingStorageRoot());

  let created = false;
  await withFileMutationLocks([drawingRoot], async () => {
    await fs.mkdir(storageRoot, { recursive: true });
    try {
      const stat = await fs.stat(drawingRoot);
      if (!stat.isDirectory()) {
        throw new Error(
          "DRAWING_METADATA_CONFLICT: canonical drawing root exists but is not a directory."
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await fs.mkdir(drawingRoot);
        created = true;
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw mkdirError;
        }
        const stat = await fs.stat(drawingRoot);
        if (!stat.isDirectory()) {
          throw new Error(
            "DRAWING_METADATA_CONFLICT: canonical drawing root exists but is not a directory."
          );
        }
      }
    }
  });

  authorizeDrawingMetadataRootForExecution(executionId, drawingRoot);
  if (created) {
    registerCreatedDrawingMetadataFolderForExecution(
      executionId,
      drawingRoot
    );
  }

  return {
    drawing_id: binding.drawing_id,
    drawing_anchor: anchor.drawing_anchor,
    schema_version: anchor.schema_version,
    state: created ? "created_empty" : "existing",
    path: toCadgptPath(drawingRoot),
    absolute_path: drawingRoot,
    file_access_authorized: true,
    cleanup_candidate:
      lastCreatedMetadataFolderByExecution.get(executionId) === drawingRoot,
  };
}

export async function cleanupDrawingMetadataForExecution(
  executionId: string
): Promise<Record<string, unknown>> {
  const candidate =
    lastCreatedMetadataFolderByExecution.get(executionId);
  lastCreatedMetadataFolderByExecution.delete(executionId);
  metadataRootsByExecution.delete(executionId);

  if (!candidate) {
    return {
      candidate: null,
      deleted_empty: false,
      kept_nonempty: false,
    };
  }

  try {
    const entries = await fs.readdir(candidate);
    if (entries.length > 0) {
      return {
        candidate,
        deleted_empty: false,
        kept_nonempty: true,
        entries: entries.length,
      };
    }

    try {
      await fs.rmdir(candidate);
      return {
        candidate,
        deleted_empty: true,
        kept_nonempty: false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
        return {
          candidate,
          deleted_empty: false,
          kept_nonempty: true,
        };
      }
      throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        candidate,
        deleted_empty: false,
        kept_nonempty: false,
        missing: true,
      };
    }
    throw error;
  }
}
