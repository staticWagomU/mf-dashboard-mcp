# Security Policy

## Supported versions

Security fixes are applied to the latest `main` branch. Pin a commit when using this server in an automated environment and review updates before deployment.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not include Money Forward credentials, 1Password secrets, database files, transaction data, or other personal information in a public issue.

If private vulnerability reporting is unavailable, open a public issue containing only a minimal, redacted request for a private contact channel.

## Security boundaries

The server is designed to:

- communicate over local stdio rather than a network listener;
- require an explicit local database path;
- open direct metadata connections and the attached source database read-only;
- copy only the selected group's rows into an isolated in-memory SQLite database;
- reject mutating, multi-statement, filesystem, recursive, and known high-cost SQL;
- anonymize Money Forward IDs;
- cap SQL length, execution time, result rows, columns, and bytes;
- start the query child with a minimal environment.

The server does not protect against:

- a malicious local user who can already read the database file;
- disclosure by the MCP client or its configured model provider;
- sensitive information present in descriptions, account names, categories, or amounts;
- vulnerabilities in Node.js, SQLite, the MCP SDK, or the host operating system.

For defense in depth, run the MCP client as a dedicated local user with access only to the required database, launch the server with `/usr/bin/env -i`, and keep dependencies updated.
