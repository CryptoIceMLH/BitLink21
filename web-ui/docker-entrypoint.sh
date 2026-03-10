#!/bin/sh
# If BITLINK_API_TOKEN is set (Umbrel deployment), inject Authorization header into nginx config
if [ -n "$BITLINK_API_TOKEN" ]; then
  sed -i "s|#AUTH_HEADER|proxy_set_header Authorization \"Bearer $BITLINK_API_TOKEN\";|g" \
    /etc/nginx/conf.d/default.conf
fi
exec "$@"
