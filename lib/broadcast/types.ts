/**
 * A place to send video to.
 *
 * Stored on the phone. The stream key and the SRT passphrase are credentials,
 * so they never leave the device except as the connection they are part of,
 * and they are never written to a log line. A phone linked to a studio account
 * also receives destinations from it (`acct_` ids, see `account.ts`); those
 * are copies the studio owns, and the next sync overwrites what it sent.
 */
export type Connection = {
  id: string;
  name: string;
  /** Base URL without the key: rtmp://host:1935/live or srt://host:8890 */
  server: string;
  streamKey: string;
  /**
   * Taken from the server URL's scheme rather than asked for separately.
   * `rtmps` is RTMP inside TLS - the same handshake, so it carries the key in
   * the path exactly as RTMP does, and it is what public ingests require.
   */
  protocol: "rtmp" | "rtmps" | "srt";
  /** SRT only. Milliseconds of buffer it may use to recover lost packets. */
  srtLatencyMs: number;
  /**
   * SRT only, and optional because destinations saved before this existed do
   * not have one. Empty or absent means the stream goes out unencrypted.
   */
  passphrase?: string;
  /**
   * The dashboard this stream lives on, and a token for its control routes -
   * both absent unless the destination was paired from a Framevane dashboard
   * new enough to issue them.
   *
   * Their presence is the honest answer to "can this phone push an overlay
   * here". A destination without them is some other RTMP server, where there
   * is no compositor and nothing to push to, and the viewfinder says so rather
   * than offering a control that would do nothing.
   *
   * The token is a credential, like the stream key beside it: it stays on the
   * phone, it travels only as an Authorization header, and it is never written
   * to a log line. It is issued per stream and revoked on its own, so a lost
   * phone can be shut out of the overlays without re-keying the stream.
   */
  api?: string;
  controlToken?: string;
  /**
   * The studio's own id for this stream, present only on a destination that
   * came from the account link rather than from one stream's pairing code.
   *
   * Its token is the phone's, not the stream's - one credential that opens
   * every stream on the account - so each control request has to say which
   * stream it means, and this is what it says. A destination without it is
   * either stream-paired, whose token already names its stream, or not
   * Framevane at all.
   */
  studioStreamId?: string;
  width: number;
  height: number;
  fps: number;
  /** Bits per second. */
  videoBitrate: number;
  createdAt: number;
};

/**
 * This phone's link to a studio account, as against to one stream on it.
 *
 * `token` is a credential in the same class as a control token, and stronger:
 * it opens the control routes of every stream the account has. It is kept
 * where the stream keys are kept, travels only as an Authorization header, and
 * is never written to a log line or shown. `name` is the account's, for the
 * screen; `linkedAt` orders the streams that came with it in the list.
 */
export type AccountLink = {
  api: string;
  token: string;
  name: string;
  linkedAt: number;
};
