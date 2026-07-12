# Runtime secrets

Stage these mode `0600` files only on the server. Never commit them:

- `database_url`
- `supabase_url`
- `supabase_publishable_key`
- `supabase_jwks_url`

The container entrypoint reads them from Docker secret mounts. Compose metadata
therefore does not contain their values. During installation the package changes
only these four files to owner `root`, group `1000` (the container's `node`
group), and mode `0640` so the non-root process can read its mounts.
