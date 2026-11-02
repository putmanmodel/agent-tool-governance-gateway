# Current SDK auth guide

Authentication is a trusted-host responsibility. Use createAuthentication and loadAuthentication from `kingpin-runtime/auth`; configuration and principal requirements are defined in the current contract. The runnable package example generates its own tokens and needs no external configuration fixture.

See the [current SDK contract](../SDK_CONTRACT.md),
[error reference](../SDK_ERRORS.md), [lifecycle guide](../SDK_LIFECYCLE_REPAIR.md),
and [runnable example](../SDK_EXAMPLE.mjs). These are all included in the package.
