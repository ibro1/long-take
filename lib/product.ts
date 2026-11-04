/**
 * Where the Framevane service lives.
 *
 * One place, because these appear in a pairing link, in the phone's settings
 * screen, in the default new destination and in the shop-window link, and a
 * self-hosted product that names its own address in four files drifts the
 * moment one of them changes.
 *
 * The name and these addresses are the trademark half of the project: forks are
 * welcome under the licence, but they rebrand, which means replacing this file
 * rather than editing the rest of the app. Nothing else in the app should spell
 * a Framevane address out.
 */

/** The dashboard: account, streams, destinations, and the control route. */
export const FRAMEVANE_WEB = "https://framevane.linkfa.de";

/**
 * The ingest edge a phone publishes to by default.
 *
 * It is a default and not a lock: every destination is editable, and the actor
 * who self-hosts points it at their own server instead. It is deliberately
 * grey-cloud DNS in the production deployment - an HTTP proxy in front of RTMP
 * drops the connection on port 1935.
 */
export const FRAMEVANE_INGEST_RTMP = "rtmp://framevane-live.linkfa.de:1935/live";
