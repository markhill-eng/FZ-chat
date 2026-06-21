# FZ-chat

FZ-chat is a local-first encrypted messaging app prototype. It has no backend, no analytics, no account service, and no recovery service.

## Security model

- Browser Web Crypto generates ECDH P-256 receiving keys and ECDSA P-256 signing keys.
- Private keys are stored in IndexedDB as non-extractable `CryptoKey` objects.
- Public contact keys can be copied and exchanged out of band.
- Messages are encrypted with a fresh ephemeral ECDH key and AES-256-GCM.
- Sender signatures are verified after decryption.
- There is no server-side access path because this version has no server.

## Run

Open `index.html` in a modern browser. For two-person testing, open the app in two different browser profiles, exchange public contact keys, then copy encrypted packages between them.

## Current limits

- Transport is manual copy and paste.
- There is no multi-device sync or backup flow.
- There is no production threat-model review yet.
- Browser compromise still compromises local secrets.
