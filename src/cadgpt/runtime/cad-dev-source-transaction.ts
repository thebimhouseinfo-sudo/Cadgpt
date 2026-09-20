interface CadDevSourceTransaction {
  ownerExecutionId: string;
  snapshotId: string;
  startedAt: string;
}

let activeTransaction: CadDevSourceTransaction | null = null;

export function cadDevSourceTransactionStatus(): CadDevSourceTransaction | null {
  return activeTransaction ? { ...activeTransaction } : null;
}

export function assertCadDevSourceAccess(executionId: string): void {
  if (!activeTransaction) return;
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
