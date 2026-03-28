# keycloak/realms/

Place Keycloak realm export JSON files here.

Files in this directory are auto-imported by Keycloak on first boot
(via the `--import-realm` flag set in docker-compose.yml).

## Included

| File            | Description |
|-----------------|-------------|
| `myrealm.json`  | Starter realm with one client (`example-app`), one test user, and two roles (`app-user`, `app-admin`). |

## Re-exporting a modified realm

After customising the realm through the Keycloak Admin UI, export it back out:

```bash
docker exec keycloak \
  /opt/keycloak/bin/kc.sh export \
  --dir /opt/keycloak/data/import \
  --realm myrealm \
  --users realm_file
```

Then copy the result back to this directory so it is tracked in version control.
