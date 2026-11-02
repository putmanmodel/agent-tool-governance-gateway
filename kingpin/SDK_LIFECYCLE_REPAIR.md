# Current SQLite lifecycle

`SQLiteStateStore.close()` now rejects while a transaction is active, before
closing or clearing its connection, with the existing lifecycle error:

```text
Error: Invalid governance state: transaction active
```

The rejection leaves the connection open. If the callback lets the error escape,
the transaction rolls back normally and the store remains usable. If it catches
the rejection, repository operations may continue and legitimate mutations can
commit normally. Rejected close does not cancel a transaction.

Successful close outside a transaction remains terminal for that instance.
Repeated normal close remains a no-op. Reopening still requires a new
SQLiteStateStore and the existing policy binding. Calls remain synchronous.

Internal rollback-failure cleanup uses private unconditional disposal rather
than the guarded public method. It can still close while the transaction is
active, preserving the triggering error when native disposal succeeds. Native
close failures retain their existing propagation; no new recovery, retry,
automatic reopen or general error taxonomy is introduced.

Historical pre-repair observations are preserved in the source project's
qualification directories and retained tarballs. They are not current behavior.
The predecessor repaired artifact SHA-256 is
`f0d8a25e53d30b766c64e24a72a58ff71ba6e7662aa03681db1d23442b457fbb`.

Authority outcomes, policy, review/revocation, persisted meaning, SQL schemas,
exports, host trust and other Memory/SQLite differences remain unchanged.
No broader recovery, production or future upgrade guarantee is added.
