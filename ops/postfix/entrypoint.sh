#!/bin/sh
set -eu
: "${MAIL_HOSTNAME:?Required}" "${MAIL_DOMAIN:?Required}"
case "$MAIL_HOSTNAME:$MAIL_DOMAIN" in *[!a-zA-Z0-9.:-]*) echo 'Invalid hostname/domain' >&2; exit 1;; esac
postconf -e "myhostname = $MAIL_HOSTNAME"
postconf -e "mydomain = $MAIL_DOMAIN"
postconf -e 'myorigin = $mydomain'
postconf -e 'mydestination = localhost'
postconf -e 'relay_domains ='
postconf -e 'relayhost ='
postconf -e 'inet_interfaces = all'
postconf -e 'inet_protocols = ipv4'
postconf -e 'mynetworks = 127.0.0.0/8, 172.30.55.10/32'
postconf -e 'smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination'
postconf -e 'smtpd_recipient_restrictions = permit_mynetworks, reject'
postconf -e 'smtp_tls_security_level = may'
postconf -e 'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt'
postconf -e 'smtp_destination_concurrency_limit = 2'
postconf -e 'default_destination_rate_delay = 1s'
postconf -e 'maximal_queue_lifetime = 2d'
postconf -e 'bounce_queue_lifetime = 1d'
postconf -e 'maillog_file = /dev/stdout'
postfix check
exec postfix start-fg
