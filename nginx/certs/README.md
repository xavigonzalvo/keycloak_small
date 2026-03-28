# nginx/certs/

Place the following files here before starting the stack.
**Do NOT commit real private keys to source control.**

| File         | Description |
|--------------|-------------|
| `server.crt` | TLS certificate for the nginx server (PEM, full chain if using an intermediate CA). |
| `server.key` | Private key for `server.crt` (PEM, unencrypted so nginx can load it without a passphrase prompt). |
| `ca.crt`     | PEM bundle of the CA(s) that issued the PIV / smart-card client certificates. Used to verify incoming mTLS connections. Concatenate multiple CAs if needed. |

## Generating self-signed certs for local development

```bash
# 1. Create a local CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 1825 \
  -subj "/CN=Local Dev CA/O=Dev" -out ca.crt

# 2. Create the server certificate
openssl genrsa -out server.key 2048
openssl req -new -key server.key \
  -subj "/CN=localhost/O=Dev" -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 365 -sha256

# 3. Create a test client certificate (simulates a PIV card)
openssl genrsa -out client.key 2048
openssl req -new -key client.key \
  -subj "/CN=Test User/O=Dev" -out client.csr
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt -days 365 -sha256
```

For production, replace the CA with your actual PIV / smart-card issuing CA
and provision `server.crt`/`server.key` from a trusted certificate authority.
