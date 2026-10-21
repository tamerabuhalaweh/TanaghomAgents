#!/bin/sh
set -eu

test -s /run/secrets/s3_access_key
test -s /run/secrets/s3_secret_key
export RUSTFS_ACCESS_KEY="$(cat /run/secrets/s3_access_key)"
export RUSTFS_SECRET_KEY="$(cat /run/secrets/s3_secret_key)"
exec /entrypoint.sh "$@"
