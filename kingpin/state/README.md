# Current SDK state guide

MemoryStateStore and SQLiteStateStore are the supported stores. Transactions are synchronous trusted-host operations. Execution accounting repositories persist caller-supplied facts, not effect proof. Public active-transaction close rejects; successful close is terminal. Reopen SQLite with a new instance.

See the [current SDK contract](../SDK_CONTRACT.md),
[error reference](../SDK_ERRORS.md), [lifecycle guide](../SDK_LIFECYCLE_REPAIR.md),
and [runnable example](../SDK_EXAMPLE.mjs). These are all included in the package.
