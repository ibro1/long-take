import { Platform } from "react-native";

import { getItem, removeItem, setItem } from "@/lib/storage";

import {
  fetchAccountStreams,
  reconcileAccountStreams,
  sameConnections,
  unlinkDevice,
  withoutAccountStreams,
} from "./account";
import { normalizeConnection } from "./pairing";
import type { AccountLink, Connection } from "./types";

export type { AccountLink, Connection };
export type { ConnectionProblem } from "./pairing";
export type { OverlayPreset } from "./overlays";
/**
 * Re-exported here so that everything a screen needs to know about a
 * destination - including whether overlays exist for it - comes through the
 * one door the rest of the app already imports from.
 */
export { canPushOverlays } from "./overlays";
export {
  connectionFromPairingUrl,
  connectionProblems,
  DEFAULT_SETTINGS,
  endpointFor,
  nameFromServer,
  protocolFor,
  srtOptionsFor,
} from "./pairing";

const KEY = "framevane.connections";
const ACTIVE_KEY = "framevane.activeConnection";

/**
 * The studio this phone last paired against.
 *
 * Remembered so the operator types an address once rather than every time.
 * It is not a credential and it is not a setting - a phone that has never
 * paired has nothing to offer here, which is exactly when the field is empty.
 */
const STUDIO_KEY = "framevane.lastStudio";

export function lastStudio(): string {
  return getItem<string>(STUDIO_KEY) ?? "";
}

export function rememberStudio(studio: string): void {
  setItem(STUDIO_KEY, studio);
}

/**
 * The destination the operator chose, or null - and null means record only.
 *
 * Framevane is a recorder first: streaming is switched on by choosing a
 * destination, and nothing chosen is a plain recorder. This used to fall back
 * to the newest destination when none was chosen, which suited a streaming app
 * and is wrong for this one - it sent the picture somewhere nobody picked.
 */
export function activeConnection(): Connection | null {
  const id = getItem<string>(ACTIVE_KEY);
  if (!id) return null;
  return listConnections().find((c) => c.id === id) ?? null;
}

/**
 * The destination that was actually chosen, as against the one
 * `activeConnection` falls back to when nothing has been. The screen needs the
 * difference: marking a card "sending here" when nobody picked it is how an
 * operator goes live to last week's test server.
 */
export function activeConnectionId(): string | null {
  return getItem<string>(ACTIVE_KEY);
}

/** Choose a destination, or null to record only. */
export function setActiveConnection(id: string | null): void {
  if (id === null) removeItem(ACTIVE_KEY);
  else setItem(ACTIVE_KEY, id);
}

/**
 * Every saved destination, each read through `normalizeConnection` - see
 * there for why the stored JSON is not taken at its word.
 *
 * Normalised on the way out rather than migrated once, because there is no
 * moment at which a migration could be sure it had run: the card list is read
 * from three screens and written by two, and a reader that fixes what it reads
 * cannot be skipped.
 */
export function listConnections(): Connection[] {
  const saved = getItem<unknown[]>(KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .map(normalizeConnection)
    .filter((c): c is Connection => c !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function saveConnection(connection: Connection): void {
  const rest = listConnections().filter((c) => c.id !== connection.id);
  setItem(KEY, [connection, ...rest]);
}

export function deleteConnection(id: string): void {
  setItem(
    KEY,
    listConnections().filter((c) => c.id !== id),
  );
  // Leaving a deleted id as the chosen destination would make
  // `activeConnection` fall back silently to whichever one happens to be
  // newest, which is not a choice anyone made.
  if (getItem<string>(ACTIVE_KEY) === id) setItem(ACTIVE_KEY, null);
}

/** Writes the whole list and the choice together, as one sync decided them. */
function replaceConnections(connections: Connection[], activeId: string | null): void {
  setItem(KEY, connections);
  if (activeId !== getItem<string>(ACTIVE_KEY)) setItem(ACTIVE_KEY, activeId);
}

/**
 * Renames one saved destination and leaves everything else about it alone.
 *
 * For the name the studio holds, which is saved the moment it is typed - the
 * editor around it may be half-way through other changes the operator has
 * not decided to keep, and saving the whole draft would decide for them.
 */
export function renameConnection(id: string, name: string): void {
  const all = listConnections();
  const target = all.find((c) => c.id === id);
  if (!target || !name.trim() || target.name === name) return;
  setItem(
    KEY,
    all.map((c) => (c.id === id ? { ...c, name } : c)),
  );
}

/* -------------------------------------------------------------------------- */
/* The account link                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Kept in the same store as the stream keys and control tokens, for the same
 * reasons and with the same caveat (see `lib/storage.ts`): out of Android's
 * backups, not yet encrypted at rest. When that store gains its encryption
 * key, this goes with it - it is the strongest credential the phone holds.
 */
const ACCOUNT_KEY = "framevane.accountLink";

/**
 * Set when a sync finds the link revoked, and cleared once the destinations
 * screen has said so. The sync that notices can run at app start with no
 * screen to speak on; the operator should still hear it once, and only once.
 */
const REVOKED_KEY = "framevane.accountRevoked";

export function accountLink(): AccountLink | null {
  const raw = getItem<Partial<AccountLink>>(ACCOUNT_KEY);
  if (!raw || typeof raw.api !== "string" || typeof raw.token !== "string") return null;
  return {
    api: raw.api,
    token: raw.token,
    name: typeof raw.name === "string" ? raw.name : "",
    linkedAt: typeof raw.linkedAt === "number" && Number.isFinite(raw.linkedAt) ? raw.linkedAt : 0,
  };
}

/** The studio's host, for "Linked to ..." - never the token, never the path. */
export function accountHost(link: AccountLink): string {
  return link.api.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

/** What a phone should be called in the studio's list of linked phones. */
export function phoneName(): string {
  // React Native's own constants, rather than a device-info package for two
  // strings. Android has the model; iOS does not say, and gets its platform.
  const constants = Platform.constants as { Brand?: unknown; Model?: unknown };
  const brand = typeof constants.Brand === "string" ? constants.Brand.trim() : "";
  const model = typeof constants.Model === "string" ? constants.Model.trim() : "";
  const name = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
  return (name.trim() || (Platform.OS === "ios" ? "iPhone" : "Android phone")).slice(0, 80);
}

export type SyncOutcome =
  | { kind: "not-linked" }
  | { kind: "synced"; changed: boolean }
  | { kind: "revoked" }
  | { kind: "failed"; message: string };

let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Brings the phone's copy of the account's streams up to date.
 *
 * One at a time: app start, the screen gaining focus and a pull to refresh can
 * all land within the same second, and three overlapping syncs would each
 * write the list from a different starting point. A caller that arrives while
 * one is running gets that one's answer.
 */
export function syncAccount(): Promise<SyncOutcome> {
  inFlight ??= runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncOutcome> {
  const link = accountLink();
  if (!link) return { kind: "not-linked" };

  const answer = await fetchAccountStreams(link);

  // The link may have been undone, or replaced, while the request was out.
  // Writing this answer then would bring back the streams of a link the
  // operator just removed.
  if (accountLink()?.token !== link.token) return { kind: "not-linked" };

  if (!answer.ok) {
    if (!answer.revoked) return { kind: "failed", message: answer.message };
    forgetAccount();
    setItem(REVOKED_KEY, accountHost(link));
    return { kind: "revoked" };
  }

  if (answer.value.account && answer.value.account !== link.name) {
    setItem(ACCOUNT_KEY, { ...link, name: answer.value.account });
  }

  const before = listConnections();
  const next = reconcileAccountStreams(before, link, answer.value.streams, getItem<string>(ACTIVE_KEY));
  const changed = !sameConnections(before, next.connections);
  if (changed) replaceConnections(next.connections, next.activeId);
  return { kind: "synced", changed };
}

/**
 * Keeps a freshly claimed link and fills the list from it.
 *
 * A phone already linked - to another account, or to this one again - lets
 * the old link go first, and tells that studio so where it can: otherwise
 * every re-link would leave one more phone in the studio's list that nobody
 * holds.
 */
export async function linkAccount(link: AccountLink): Promise<SyncOutcome> {
  const previous = accountLink();
  if (previous) {
    forgetAccount();
    void unlinkDevice(previous);
  }
  removeItem(REVOKED_KEY);
  setItem(ACCOUNT_KEY, link);
  return syncAccount();
}

/**
 * Undoes the link from this end. The streams go from the phone whether or not
 * the studio could be told; the answer says which, so the screen can send the
 * operator to the dashboard to finish the job when it could not.
 */
export async function unlinkAccount(): Promise<{ toldStudio: boolean }> {
  const link = accountLink();
  if (!link) return { toldStudio: true };
  const toldStudio = await unlinkDevice(link);
  forgetAccount();
  return { toldStudio };
}

function forgetAccount(): void {
  const next = withoutAccountStreams(listConnections(), getItem<string>(ACTIVE_KEY));
  replaceConnections(next.connections, next.activeId);
  removeItem(ACCOUNT_KEY);
}

/** The studio whose link was revoked, once, for the screen to say so. */
export function takeRevokedNotice(): string | null {
  const host = getItem<string>(REVOKED_KEY);
  if (host !== null) removeItem(REVOKED_KEY);
  return host;
}
