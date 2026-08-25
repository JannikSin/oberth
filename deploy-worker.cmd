@echo off
REM ALWAYS deploy the Worker through this script.
REM
REM Running `npx wrangler deploy` from the REPO ROOT does not fail. Modern
REM wrangler treats the directory as a static-assets Worker, deploys the PWA
REM shell over the API Worker of the same name, and WIPES EVERY SECRET.
REM That happened on 2026-08-25 and took the whole API down until the secrets
REM were re-uploaded. The -c flag is the guard.
npx wrangler deploy -c worker/wrangler.toml %*
