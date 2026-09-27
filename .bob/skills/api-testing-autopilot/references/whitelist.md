# Whitelist

## What it is

`configs/whitelist.json` contains the list of hostnames that the MCP server
will allow as test targets. By default it contains only:

```json
["localhost", "127.0.0.1"]
```

## Why it exists

Load tests generate real HTTP traffic. Sending that traffic to a public host
you don't own is a denial-of-service attack. The whitelist ensures that
Autopilot can only be pointed at infrastructure you control locally.

## How it is enforced

`full_autopilot` extracts the hostname from `base_url` and checks it against
the whitelist **before** scanning, generating, or running anything. If the
host is not listed, it returns:

```json
{ "error": "whitelist_blocked", "hint": "Host \"example.com\" is not in the whitelist..." }
```

`generate_test_script` also checks the `base_url` before emitting a script.

## Adding a host (advanced)

Edit `configs/whitelist.json` and add the hostname. Do this only for hosts
you own and have permission to load test.

**Never add a public host (e.g. google.com, api.stripe.com) to the whitelist.**
