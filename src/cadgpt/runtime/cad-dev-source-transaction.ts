import fs from "node:fs";
import path from "node:path";

import { getAppDataPath } from "../lib/appdata.js";

interface CadDevSourceTransaction {
  ownerExecutionId: string;
  snapshotId: string;
  startedAt: string;
}

let activeTransaction: CadDevSourceTransaction | null = null;

function recoveryRoot(): string {
  return getAppDataPath("state", "cad-mcp-dev-recovery");
}

function pendingRecoveryDirectories(): string[] {
  const root = recoveryRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !(entry.name.startsWith(".") && entry.name.endsWith(".tmp"))
    )
    .map((entry) => path.join(root, entry.name));
}

export function cadDevSourceTransactionStatus(): CadDevSourceTransaction | null {
  return activeTransaction ? { ...activeTransaction } : null;
}

export function assertCadDevSourceAccess(executionId: string): void {
  if (!activeTransaction) {
    const pending = pendingRecoveryDirectories();
    if (pending.length > 0) {
      throw new Error(
        "CAD_MCP_DEV_RECOVERY_REQUIRED: an unaccepted CAD MCP recovery baseline exists on disk. Recover it through cad-mcp-dev FILE work before starting CAD."
      );
    }
    return;
  }
  if (activeTransaction.ownerExecutionId !== executionId) {
    throw new Error(
      "CAD_MCP_DEV_SOURCE_RESERVED: unaccepted CAD MCP source is owned by another development execution."
    );
  }
}

export function beginCadDevSourceTransaction(input: {
  ownerExecutionId: string;
  snapshotId: string;
}): CadDevSourceTransaction {
  if (activeTransaction) {
    if (activeTransaction.ownerExecutionId === input.ownerExecutionId) {
      throw new Error(
        `CAD_MCP_DEV_SOURCE_TRANSACTION_ACTIVE: baseline ${activeTransaction.snapshotId} already owns the source transaction.`
      );
    }
    throw new Error(
      "CAD_MCP_DEV_SOURCE_RESERVED: another development execution already owns the CAD MCP source transaction."
    );
  }

  activeTransaction = {
    ownerExecutionId: input.ownerExecutionId,
    snapshotId: input.snapshotId,
    startedAt: new Date().toISOString(),
  };
  return { ...activeTransaction };
}

export function endCadDevSourceTransaction(
  executionId: string
): CadDevSourceTransaction | null {
  if (!activeTransaction) return null;
  if (activeTransaction.ownerExecutionId !== executionId) {
    throw new Error(
      "CAD_MCP_DEV_SOURCE_RESERVED: source transaction belongs to another execution."
    );
  }
  const prior = activeTransaction;
  activeTransaction = null;
  return { ...prior };
}

export function forceClearCadDevSourceTransaction(
  executionId: string
): void {
  if (activeTransaction?.ownerExecutionId === executionId) {
    activeTransaction = null;
  }
}
