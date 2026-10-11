# Private Mac quote transport

`operations/quote_bridge.py` exposes only `127.0.0.1:8961/quote` on the Mac.
An SSH reverse forward makes it reachable at the same loopback address on the
operator's VPS. It doesn't add a public HTTP route or advertise negotiation.

The operator provisions a random 32-byte hexadecimal `QUOTE_TRANSPORT_TOKEN`
in the Mac's real home `.config/position-guard-quote/transport.env`, mode `0600`.
The private authority and state directories must be owned by that operator.
Store the matching transport credential privately on the VPS. This credential
is separate from the wallet key; the wallet stays on the Mac.

```sh
python3 operations/quote_bridge.py --node /absolute/path/to/node
ssh -NT -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:8961:127.0.0.1:8961 operator-vps
```

The authenticated POST accepts exactly `{"draft": <unsigned quote>}`. It invokes
the existing isolated signer, which requires an exact, unexpired local grant.
Requests can't supply grants, wallet sources, state directories or transaction
calls. The response carries the signed envelope only after successful signing.
The caller must verify recovery and archive that envelope before releasing it.
Neither requests nor responses are logged.

Only one HTTP request is processed at a time. Reads are bounded to five seconds,
request bodies to 32 KiB, and the signer subprocess to twenty seconds. A lost
response or signing failure never triggers a retry: reconcile the original
signer journal. Reposting an already consumed grant stops.

This transport depends on the Mac and SSH connection staying available. It
doesn't supply standing quote authority, a transaction signer, an automatic
seller loop, or guaranteed availability. Paid negotiation remains disabled
until those service requirements are satisfied. An internal quote tested over
this connection isn't a public offer or a completed marketplace hire.
