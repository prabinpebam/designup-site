# DesignUp private preview

This repository serves a private preview of the DesignUp website and its project docs. Everything here except the
access page is encrypted. The plain content lives in a private repository and is never published.

## What is here

- `site/` is what GitHub Pages serves: the access page, a service worker, and encrypted files under `site/sealed/`.
- `source/` is the readable source of the access page and the service worker, for review.
- `tools/check-sealed.mjs` checks that every served file is either part of the access page or ciphertext. The
  deploy workflow runs it before every deploy. It needs no secrets and installs nothing.

## How it works

A person enters an access code. The code opens a small encrypted keyring that holds the keys for the parts of the
preview that code may open. A service worker then decrypts each page, script and image in the browser as it is
requested. Codes end on a set date and can be withdrawn at the next publish. Encryption is AES-GCM; keys come from
the code through PBKDF2 with SHA-256 and 600,000 rounds.

The branch `main` always holds exactly one commit: each publish replaces it.

## Rights

All rights reserved. No licence is granted to the content or code in this repository.

Access codes are made from the EFF Large Wordlist for passphrases, by the Electronic Frontier Foundation, used under
CC BY 3.0 US.
