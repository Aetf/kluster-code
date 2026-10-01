# email-oauth2-proxy: transparent XOAUTH2 bridge so clients without OAuth
# support (Home Assistant's imap integration) can watch Gmail without an app
# password. Clients connect with plain IMAP on the LAN; the proxy speaks
# IMAPS+XOAUTH2 towards imap.gmail.com.
#
# /config/emailproxy.config comes from a templated SealedSecret; /data holds
# the mutable token cache (--cache-store), encrypted with the IMAP password
# the client presents. --local-server-auth is always on: first-time account
# authorisation happens through `kubectl port-forward ... 8080:8080` (Google
# only allows loopback redirect URIs for desktop clients).
FROM docker.io/library/python:3.14-slim

ARG EMAILPROXY_VERSION
RUN pip install --no-cache-dir emailproxy==${EMAILPROXY_VERSION}

ENTRYPOINT ["python", "-m", "emailproxy", "--no-gui", \
    "--config-file", "/config/emailproxy.config", \
    "--cache-store", "/data/credstore.config", \
    "--local-server-auth"]
