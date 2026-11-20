# Operations notes

See [README.md](../README.md) for local setup, webhook configuration, and deployment.

## ELO timeline diagnostics

Current ELO and the unofficial ELO timeline use different FACEIT endpoints. The timeline in `src/services/faceitService.js` uses Node.js native `fetch` against `api.faceit.com`. Some local or sandbox egress IPs receive HTTP 403 from that endpoint while the official Data API at `open.faceit.com` still works. Check timeline behavior from the deployed environment when investigating missing ELO changes.

## Firestore notification retention

New records in `sent_match_notifications` set `expireAt` to seven days after creation. Use that field when configuring Firestore TTL for a deployment.

```sh
gcloud firestore fields ttls update expireAt --collection-group=sent_match_notifications --enable-ttl --project=<project-id>
```

## Cloud Logging

The deployed Cloud Run service uses the name `faceit-last10-stats-bot-git`. To inspect recent webhook errors, query the service's revision logs.

```sh
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="faceit-last10-stats-bot-git" textPayload:"[FACEIT WEBHOOK] Error handling event"' --limit=50 --freshness=7d
```

On the local development Mac, if `gcloud` fails because it selects the system Python 3.9, the existing shell setup points `CLOUDSDK_PYTHON` to `/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10`.
