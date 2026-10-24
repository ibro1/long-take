import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  type Announce,
  controlFileLoop,
  getAnnounce,
  getDestinations,
  getSourceSettings,
  setDestinationEnabled,
  setDestinationOrientation,
  setSourceSettings,
  type SourceSettings,
  type StudioDestination,
  setAnnounce,
  getTitle,
  setTitle,
  getWhoCanWatch,
  setWhoCanWatch,
  uploadSourceVideo,
  type Visibility,
  type WhoCanWatch,
} from "@/lib/broadcast/overlays";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackIcon } from "@/components/broadcast/icons";
import { Text } from "@/components/ui/text";
import {
  type AccountLink,
  accountHost,
  accountLink,
  activeConnectionId,
  type Connection,
  connectionFromPairingUrl,
  lastStudio,
  linkAccount,
  phoneName,
  rememberStudio,
  renameConnection,
  connectionProblems,
  DEFAULT_SETTINGS,
  deleteConnection,
  listConnections,
  nameFromServer,
  protocolFor,
  saveConnection,
  setActiveConnection,
  type SyncOutcome,
  syncAccount,
  takeRevokedNotice,
  unlinkAccount,
} from "@/lib/broadcast/connections";
import { isAccountConnection } from "@/lib/broadcast/account";
import {
  accountLinkCodeFromUrl,
  type ClaimResult,
  claimPairingCode,
  studioUrlFrom,
} from "@/lib/broadcast/pairing";
import { defaultPicture, loadSettings } from "@/lib/broadcast/settings";
import { formatKbps } from "@/lib/broadcast/units";
import { bidi } from "@/lib/i18n";

/**
 * Where the video goes.
 *
 * Picture size, frame rate, bitrate and the SRT settings are per destination
 * because sending to YouTube and sending to a test server are not the same
 * job. The video codec deliberately is not here: whether this handset can
 * encode H.265 at all is a fact about the phone rather than about any
 * destination, the encoder carries one codec per broadcast and a broadcast has
 * exactly one destination - so a per-destination copy would only duplicate a
 * phone-wide fact and give the operator two places to be wrong. It lives in
 * Settings, and the card below shows which codec a broadcast from here will
 * use so it is visible at the point of choosing.
 */
export default function ConnectionsScreen() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>(() => listConnections());
  const [activeId, setActiveId] = useState<string | null>(() => activeConnectionId());
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [draft, setDraft] = useState<Connection | null>(null);
  const [claiming, setClaiming] = useState(false);
  /** Which way in the code form was opened from, for its wording only. */
  const [claimFor, setClaimFor] = useState<"account" | "stream">("stream");
  const [link, setLink] = useState<AccountLink | null>(() => accountLink());
  const [syncing, setSyncing] = useState(false);
  /** The last sync's trouble, if it had any. Cleared by the next one that works. */
  const [accountNote, setAccountNote] = useState<string | null>(null);
  // Read here only to show it: the codec is a phone setting, and a card that
  // did not mention it would leave the operator to remember which one is on.
  const [codec, setCodec] = useState(() => loadSettings().videoCodec);

  const refresh = useCallback(() => {
    setConnections(listConnections());
    setActiveId(activeConnectionId());
    setCodec(loadSettings().videoCodec);
    setLink(accountLink());
  }, []);

  /**
   * Said once, in words, when the dashboard has unlinked this phone. The
   * streams vanishing from the list with no reason given would read as the
   * app losing them.
   */
  const sayIfRevoked = useCallback(() => {
    const host = takeRevokedNotice();
    if (!host) return;
    Alert.alert(
      "This phone is no longer linked",
      `${host} unlinked it, so the streams that came from there are gone from this phone. If that was a mistake, link it again from the Streams page there.`,
    );
  }, []);

  const report = useCallback(
    (outcome: SyncOutcome) => {
      if (outcome.kind === "failed") setAccountNote(outcome.message);
      else setAccountNote(null);
      sayIfRevoked();
    },
    [sayIfRevoked],
  );

  /** Fetches the account's streams and redraws, for a linked phone only. */
  const sync = useCallback(async () => {
    if (!accountLink()) return;
    setSyncing(true);
    const outcome = await syncAccount();
    setSyncing(false);
    refresh();
    report(outcome);
  }, [refresh, report]);

  /**
   * One name: a Framevane destination is called what the studio calls the
   * stream. Synced ones get it with the list; one paired from a stream's code
   * asks its own stream, so a rename made on the dashboard shows up here the
   * next time the list is opened rather than never.
   */
  const refreshStudioNames = useCallback(async () => {
    const paired = listConnections().filter(
      (c) => c.api && c.controlToken && !c.studioStreamId,
    );
    const answers = await Promise.all(
      paired.map(async (c) => ({ id: c.id, result: await getTitle(c) })),
    );
    let renamed = false;
    for (const { id, result } of answers) {
      if (!result.ok || !result.value.trim()) continue;
      const before = listConnections().find((c) => c.id === id)?.name;
      if (before === undefined || before === result.value) continue;
      renameConnection(id, result.value);
      renamed = true;
    }
    if (renamed) refresh();
  }, [refresh]);

  /**
   * The active destination can be changed from the viewfinder, so this screen
   * re-reads on focus rather than trusting what it had at mount. A card
   * marked "sending here" that is not the one the broadcast will use is worse
   * than no marking at all. The studio is asked again on the same occasion,
   * because a stream added or renamed on the laptop is exactly what the
   * operator came here to find.
   */
  useFocusEffect(
    useCallback(() => {
      refresh();
      sayIfRevoked();
      void sync();
      void refreshStudioNames();
    }, [refresh, sayIfRevoked, sync, refreshStudioNames]),
  );

  /**
   * Files what a claim turned out to be: one stream's destination, or the
   * whole account. The operator scanned or typed the same kind of thing
   * either way and should not have had to know which.
   */
  const accept = useCallback(
    async (result: Extract<ClaimResult, { ok: true }>) => {
      if (result.kind === "stream") {
        saveConnection(result.connection);
        setActiveConnection(result.connection.id);
        refresh();
        return;
      }
      setSyncing(true);
      const outcome = await linkAccount(result.account);
      setSyncing(false);
      refresh();
      report(outcome);
    },
    [refresh, report],
  );

  const unlink = () => {
    if (!link) return;
    Alert.alert(
      `Unlink from ${accountHost(link)}?`,
      "The studio's streams are taken off this phone and it stops being able to control them. Destinations you added yourself stay.",
      [
        { text: "Keep" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            setSyncing(true);
            const { toldStudio } = await unlinkAccount();
            setSyncing(false);
            refresh();
            setAccountNote(null);
            if (!toldStudio) {
              Alert.alert(
                "Unlinked on this phone",
                "The studio could not be told, so it still lists this phone. Unlink it from the Streams page there as well.",
              );
            }
          },
        },
      ],
    );
  };

  /**
   * One code per scan. The camera reports a code on every frame it can see it,
   * and several frames land before the screen has re-rendered without the
   * scanner - so one QR saved itself two or three times, as identical
   * destinations. The latch is a ref because it has to hold within the same
   * render; it is let go each time the scanner opens.
   */
  const scanned = useRef(false);
  const openScanner = useCallback(() => {
    scanned.current = false;
    setScanning(true);
  }, []);

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned.current) return;
      scanned.current = true;
      setScanning(false);

      // The account QR carries a code, not a destination: it is spent at the
      // studio it names, exactly as a typed one would be.
      const accountCode = accountLinkCodeFromUrl(data);
      if (accountCode) {
        setSyncing(true);
        const result = await claimPairingCode(accountCode.studio, accountCode.code, phoneName());
        setSyncing(false);
        if (!result.ok) {
          Alert.alert("Could not link this phone", result.message);
          return;
        }
        rememberStudio(accountCode.studio);
        await accept(result);
        return;
      }

      const connection = connectionFromPairingUrl(data);
      if (!connection) {
        Alert.alert(
          "Not a Framevane code",
          "Scan the code on the Streams page in Framevane, or on one stream's page.",
        );
        return;
      }
      saveConnection(connection);
      setActiveConnection(connection.id);
      refresh();
    },
    [refresh, accept],
  );

  const remove = (connection: Connection) => {
    Alert.alert(
      `Remove ${connection.name || "this destination"}?`,
      "The stream key goes with it. It is on the stream's page in Framevane if you need it again.",
      [
        { text: "Keep" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            deleteConnection(connection.id);
            refresh();
          },
        },
      ],
    );
  };

  if (scanning) {
    return (
      <View className="flex-1 bg-black">
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
        <SafeAreaView className="absolute inset-x-0 bottom-0" edges={["bottom"]}>
          <View className="items-center gap-2 p-6">
            <Text className="text-center text-white">
              Point this at the code in Framevane - the one for linking this phone, or one
              stream's.
            </Text>
            <Button variant="secondary" onPress={() => setScanning(false)}>
              <Text>Cancel</Text>
            </Button>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const scan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    openScanner();
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => {
              void sync();
              void refreshStudioNames();
            }}
          />
        }
      >
        {/* The way back. This screen used to be a tab, and the tab bar was the
            way out of it; the bar is gone, so the screen has to carry one. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the viewfinder"
          onPress={() => router.back()}
          className="min-h-11 flex-row items-center gap-2 self-start pr-3 active:opacity-60"
        >
          <BackIcon className="h-5 w-5 text-foreground" />
          <Text className="text-base">Viewfinder</Text>
        </Pressable>

        <Text className="text-2xl font-bold">Where to send it</Text>

        {/* The account first, because it is the one that keeps up: every
            stream on the dashboard arrives here and stays named the same.
            Pairing one stream at a time is still below it, for a phone that
            should only ever see one. */}
        {link ? (
          <View className="gap-2 rounded-2xl border border-border bg-card p-4">
            <Text className="font-semibold" numberOfLines={1}>
              Linked to {accountHost(link)}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {link.name ? `${link.name}'s streams. ` : "Every stream on the account. "}
              A stream added, renamed or removed on the dashboard is the same here the next time
              this list is opened or pulled down.
            </Text>
            {accountNote ? <Text className="text-xs text-amber-400">{accountNote}</Text> : null}
            <View className="flex-row gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={syncing}
                onPress={() => {
                  void sync();
                  void refreshStudioNames();
                }}
              >
                <Text>{syncing ? "Refreshing" : "Refresh"}</Text>
              </Button>
              <Button size="sm" variant="ghost" disabled={syncing} onPress={unlink}>
                <Text>Unlink</Text>
              </Button>
            </View>
          </View>
        ) : (
          <View className="gap-2 rounded-2xl border border-border bg-card p-4">
            <Text className="font-semibold">Link this phone to your studio</Text>
            <Text className="text-xs text-muted-foreground">
              Every stream on your Framevane account, here and kept up to date. On the dashboard,
              open Streams and press "Link a phone", then scan the code or type the eight
              characters under it.
            </Text>
            {accountNote ? <Text className="text-xs text-amber-400">{accountNote}</Text> : null}
            <View className="flex-row gap-2 pt-1">
              <Button className="flex-1" disabled={syncing} onPress={() => void scan()}>
                <Text>{syncing ? "Linking" : "Scan to link"}</Text>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={syncing}
                onPress={() => {
                  setDraft(null);
                  setClaimFor("account");
                  setClaiming((open) => !open || claimFor !== "account");
                }}
              >
                <Text>Use a code</Text>
              </Button>
            </View>
          </View>
        )}

        <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          One stream at a time
        </Text>
        <View className="flex-row gap-2">
          <Button variant={link ? "default" : "outline"} className="flex-1" onPress={() => void scan()}>
            <Text>Scan the code</Text>
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => {
              setDraft(null);
              setClaimFor("stream");
              setClaiming((open) => !open || claimFor !== "stream");
            }}
          >
            <Text>Use a code</Text>
          </Button>
        </View>

        {/* Third, and smaller, because it is the path that cannot pair: it
            carries a server and a key and no way to receive the studio's
            address or this stream's token, so a destination made this way has
            no overlays and no title for as long as it exists. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Or type a server and key by hand"
          onPress={() => {
            setClaiming(false);
            setDraft(blankConnection());
          }}
          className="min-h-11 items-center justify-center active:opacity-60"
        >
          <Text className="text-sm text-muted-foreground underline">
            Or type a server and key by hand
          </Text>
        </Pressable>

        {claiming ? (
          <CodePairing
            purpose={claimFor}
            onCancel={() => setClaiming(false)}
            onPaired={(result) => {
              setClaiming(false);
              void accept(result);
            }}
          />
        ) : null}

        {draft ? (
          <Editor
            connection={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => {
              // A Framevane card a sync has removed meanwhile - its stream
              // deleted on the dashboard, or the link undone - is not brought
              // back by saving an old copy of it.
              if (draft.controlToken && !listConnections().some((c) => c.id === draft.id)) {
                setDraft(null);
                refresh();
                return;
              }
              // A destination with no name is saved as its host rather than
              // as an empty card, which reads as a bug.
              const named = draft.name.trim()
                ? draft
                : { ...draft, name: nameFromServer(draft.server) };
              saveConnection(named);
              setActiveConnection(named.id);
              setDraft(null);
              refresh();
            }}
          />
        ) : null}

        {connections.length === 0 && !draft ? (
          <View className="rounded-2xl border border-dashed border-border p-4">
            <Text className="text-sm text-muted-foreground">
              Nothing here yet. Link this phone above to bring in every stream on your account, or
              open one stream in Framevane and press "Show the pairing code" to add just that one -
              either way the address, the key and the studio's token arrive together.
            </Text>
          </View>
        ) : null}

        {connections.map((connection) => {
          // Falling back to the newest is what the broadcast does when nothing
          // has been chosen, so the card says so in those words rather than
          // claiming someone picked it.
          const chosen = connection.id === activeId;
          const fallback = activeId === null && connection.id === connections[0]?.id;
          return (
            <Pressable
              key={connection.id}
              accessibilityRole="button"
              accessibilityLabel={
                chosen || fallback
                  ? `${connection.name}, sending here. Open the viewfinder.`
                  : `${connection.name}. Send here and open the viewfinder.`
              }
              accessibilityState={{ selected: chosen || fallback }}
              onPress={() => {
                setActiveConnection(connection.id);
                setActiveId(connection.id);
                router.push("/(tabs)");
              }}
              className={`gap-1 rounded-2xl border bg-card p-4 ${
                chosen || fallback ? "border-foreground" : "border-border"
              }`}
            >
              <View className="flex-row items-center justify-between gap-3">
                {/* Directed by its own first letter: a class named in Arabic
                    sits right and keeps its punctuation at the right end. */}
                <Text
                  className="flex-1 font-semibold"
                  numberOfLines={1}
                  style={bidi(connection.name)}
                >
                  {connection.name}
                </Text>
                <Text className="font-mono text-xs uppercase text-muted-foreground">
                  {connection.protocol}
                </Text>
              </View>
              {chosen || fallback ? (
                <Text className="text-xs font-medium">
                  {chosen ? "Sending here" : "Sending here, because nothing else was chosen"}
                </Text>
              ) : null}
              {isAccountConnection(connection) ? (
                <Text className="text-xs text-muted-foreground">From your studio account</Text>
              ) : null}
              <Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
                {connection.server}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {connection.height}p · {connection.fps} fps ·{" "}
                {formatKbps(connection.videoBitrate)} ·{" "}
                {codec === "h265" ? "H.265" : "H.264"}
                {connection.protocol === "srt" ? ` · ${connection.srtLatencyMs} ms` : ""}
                {connection.protocol === "srt" && connection.passphrase ? " · encrypted" : ""}
              </Text>
              <View className="flex-row gap-2 pt-2">
                <Button size="sm" variant="outline" onPress={() => setDraft(connection)}>
                  <Text>Edit</Text>
                </Button>
                {/* Not offered for a synced card: the next sync would put it
                    straight back. It goes when the stream is deleted on the
                    dashboard, or with the link. */}
                {isAccountConnection(connection) ? null : (
                  <Button size="sm" variant="ghost" onPress={() => remove(connection)}>
                    <Text>Remove</Text>
                  </Button>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function blankConnection(): Connection {
  // A new card starts at the picture chosen under Settings > Video; a saved
  // one keeps whatever it was saved with.
  const picture = defaultPicture();
  return {
    id: `conn_${Date.now().toString(36)}`,
    name: "",
    server: "rtmp://framevane-live.linkfa.de:1935/live",
    streamKey: "",
    protocol: "rtmp",
    srtLatencyMs: DEFAULT_SETTINGS.srtLatencyMs,
    passphrase: "",
    width: picture.width,
    height: picture.height,
    fps: picture.fps,
    videoBitrate: DEFAULT_SETTINGS.videoBitrate,
    createdAt: Date.now(),
  };
}

function Editor({
  connection,
  onChange,
  onSave,
  onCancel,
}: {
  connection: Connection;
  onChange: (connection: Connection) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Connection>(key: K, value: Connection[K]) =>
    onChange({ ...connection, [key]: value });

  /**
   * Who can watch, for a destination that came from a pairing code.
   *
   * It is a property of the stream rather than of this phone, so it is read
   * from the dashboard rather than stored here: the studio can change it while
   * the phone is in a pocket, and a remembered copy would show "Private" over a
   * broadcast somebody had made public from a laptop.
   *
   * Only for paired destinations. A destination that is a server and a key is a
   * pipe - there is nothing on the other end of it that this app can ask.
   */
  const paired = Boolean(connection.api && connection.controlToken);
  /** Came with the account link; its address and key are the studio's to change. */
  const synced = Boolean(connection.studioStreamId);
  const [watch, setWatch] = useState<WhoCanWatch | null>(null);
  const [watchNote, setWatchNote] = useState<string | null>(null);

  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    void getWhoCanWatch(connection).then((result) => {
      if (cancelled) return;
      if (result.ok) setWatch(result.value);
      // A dashboard too old for this endpoint answers 404, and that is not a
      // fault worth a banner - the control simply is not offered.
      else setWatchNote(result.message);
    });
    return () => {
      cancelled = true;
    };
    // Re-read when the destination changes, not on every keystroke in the form.
  }, [paired, connection.id]);

  const chooseVisibility = async (next: Visibility) => {
    const previous = watch;
    setWatch((current) => (current ? { ...current, visibility: next } : current));
    const result = await setWhoCanWatch(connection, next);
    if (!result.ok) {
      // Put it back rather than leave the screen claiming a change the
      // dashboard refused.
      setWatch(previous);
      setWatchNote(result.message);
    }
  };

  /**
   * One name, for a destination that goes through Framevane.
   *
   * There used to be two: a Name that was a label in this phone's list, and a
   * Broadcast title that was the stream's own name in the studio - the one
   * the dashboard shows and the one YouTube and Facebook are given. They looked
   * alike and meant different things, so a stream renamed here kept its old
   * name everywhere that mattered. Now the Name is the studio's: read from it
   * when the editor opens, and written back to it as it is typed.
   *
   * A destination that is only a server and a key keeps a Name of its own, as
   * before; there is no studio behind it to agree with.
   */
  const [titleNote, setTitleNote] = useState<string | null>(null);

  /**
   * The draft as it is now, and whether this editor is still open, for
   * answers that come back after the operator has typed on or closed it. An
   * answer that wrote the draft it started from would undo their typing, and
   * one that wrote a draft after Cancel would open the editor again.
   */
  const latest = useRef(connection);
  latest.current = connection;
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  /** Takes the studio's spelling, unless the operator is mid-edit. */
  const adoptName = (name: string) => {
    renameConnection(connection.id, name);
    if (!open.current || pendingTitle.current !== null || latest.current.name === name) return;
    onChange({ ...latest.current, name });
  };

  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    void getTitle(connection).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        savedTitle.current = result.value;
        if (result.value.trim()) adoptName(result.value);
      } else setTitleNote(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [paired, connection.id]);

  /**
   * Saved as it is typed, not only when the box loses focus.
   *
   * Blur was the only trigger, and on Android pressing Back or switching tab
   * straight after typing takes the box away without one - so a corrected
   * title stayed on this screen and never reached the studio, and the lesson
   * went out under the old name with nothing to say it had not saved.
   */
  const savedTitle = useRef<string | null>(null);
  const pendingTitle = useRef<string | null>(null);
  const [titleSaved, setTitleSaved] = useState(false);

  const saveTitle = async (wanted: string | null = pendingTitle.current) => {
    if (!paired) return;
    if (wanted === null || wanted.trim() === "" || wanted === savedTitle.current) return;
    pendingTitle.current = null;
    const result = await setTitle(connection, wanted);
    if (result.ok) {
      savedTitle.current = result.value;
      adoptName(result.value);
      if (!open.current) return;
      setTitleNote(null);
      setTitleSaved(true);
      return;
    }
    pendingTitle.current = wanted;
    if (!open.current) return;
    setTitleSaved(false);
    setTitleNote(result.message);
  };

  const editName = (value: string) => {
    set("name", value);
    if (!paired) return;
    setTitleSaved(false);
    pendingTitle.current = value;
  };

  useEffect(() => {
    if (!paired || pendingTitle.current === null) return;
    const timer = setTimeout(() => void saveTitle(), 900);
    return () => clearTimeout(timer);
  }, [connection.name]);

  // Leaving mid-edit still saves what was typed: closing the editor, and
  // leaving the screen - which, with the tabs kept mounted, closes nothing.
  useEffect(() => () => void saveTitle(), [connection.id]);
  useFocusEffect(useCallback(() => () => void saveTitle(), []));

  /**
   * Where the studio sends the picture on, switched from here.
   *
   * The same shape as the WhatsApp groups below it: the studio answers every
   * change with the whole list as stored, and a refusal puts the previous
   * list back, because a chip left ticked after the server said no is the
   * screen promising a channel that will not get the lesson.
   */
  const [outputs, setOutputs] = useState<StudioDestination[] | null>(null);
  const [outputsNote, setOutputsNote] = useState<string | null>(null);
  /** What the studio said the last switch did - live now, or next broadcast. */
  const [outputsResult, setOutputsResult] = useState<string | null>(null);

  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    void getDestinations(connection).then((result) => {
      if (cancelled) return;
      if (result.ok) setOutputs(result.value);
      // A dashboard too old for this endpoint answers 404; the control is
      // simply not offered rather than shown broken.
      else setOutputsNote(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [paired, connection.id]);

  const toggleOutput = async (target: StudioDestination) => {
    const previous = outputs;
    setOutputs((current) =>
      current
        ? current.map((item) =>
            item.id === target.id ? { ...item, enabled: !target.enabled } : item,
          )
        : current,
    );
    const result = await setDestinationEnabled(connection, target.id, !target.enabled);
    if (result.ok) {
      setOutputs(result.value.destinations);
      setOutputsNote(null);
      setOutputsResult(result.value.message);
      return;
    }
    setOutputs(previous);
    setOutputsResult(null);
    setOutputsNote(result.message);
  };

  const [announce, setAnnounceState] = useState<Announce | null>(null);
  const [announceNote, setAnnounceNote] = useState<string | null>(null);

  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    void getAnnounce(connection).then((result) => {
      if (cancelled) return;
      if (result.ok) setAnnounceState(result.value);
      else setAnnounceNote(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [paired, connection.id]);

  /**
   * Every change is sent on its own and the studio answers with the whole
   * setting, so the screen shows what was actually stored rather than what was
   * typed. A refusal puts the previous value back: a switch that stays on after
   * the server said no is the screen telling the operator a group will be
   * messaged when it will not.
   */
  const changeAnnounce = async (patch: Parameters<typeof setAnnounce>[1]) => {
    const previous = announce;
    setAnnounceState((current) => (current ? { ...current, ...patch } : current));
    const result = await setAnnounce(connection, patch);
    if (result.ok) {
      setAnnounceState(result.value);
      setAnnounceNote(null);
      return;
    }
    setAnnounceState(previous);
    setAnnounceNote(result.message);
  };

  const toggleChat = (chat: string) => {
    if (!announce) return;
    const chosen = announce.announceChats.includes(chat)
      ? announce.announceChats.filter((name) => name !== chat)
      : [...announce.announceChats, chat];
    void changeAnnounce({ announceChats: chosen });
  };

  const problems = connectionProblems(connection);
  const blocking = problems.filter((problem) => problem.blocking);
  const advisory = problems.filter((problem) => !problem.blocking);

  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <Field label={paired ? "Name, here and in the studio" : "Name"}>
        <Input
          value={connection.name}
          onChangeText={editName}
          onBlur={paired ? () => void saveTitle() : undefined}
          onSubmitEditing={paired ? () => void saveTitle() : undefined}
          placeholder={paired ? "What the stream is called" : "Studio phone"}
          autoCapitalize="sentences"
        />
        {/* Said plainly either way, because the cost of assuming otherwise is
            an hour of video under the wrong title. */}
        {paired ? (
          <>
            {titleSaved ? (
              <Text className="text-xs text-emerald-400">
                Saved. A broadcast already live is renamed on YouTube too.
              </Text>
            ) : null}
            <Text className="text-xs text-muted-foreground">
              The stream's name on the dashboard, and the title YouTube and Facebook are given
              when the broadcast is created. One name: changing it here changes it there.
            </Text>
            {titleNote ? <Text className="text-xs text-amber-400">{titleNote}</Text> : null}
          </>
        ) : (
          <Text className="text-xs text-muted-foreground">
            How this destination is listed on this phone. It is not the title of the video.
          </Text>
        )}
      </Field>
      <Field label="Server URL">
        <Input
          value={connection.server}
          onChangeText={(value) =>
            onChange({ ...connection, server: value, protocol: protocolFor(value) })
          }
          editable={!synced}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="rtmp://host:1935/live"
        />
        {synced ? (
          <Text className="text-xs text-muted-foreground">
            The address and key come from your studio account and follow it - a key rotated on
            the dashboard is the key here after the next refresh.
          </Text>
        ) : null}
        {synced ? null : (
          <View className="flex-row gap-2">
            {SCHEMES.map((scheme) => (
              <Choice
                key={scheme.value}
                label={scheme.label}
                selected={connection.protocol === scheme.value}
                onPress={() => {
                  const server = withScheme(connection.server, scheme.value);
                  onChange({ ...connection, server, protocol: scheme.value });
                }}
              />
            ))}
          </View>
        )}
        {synced ? null : (
          <Text className="text-xs text-muted-foreground">
            These rewrite the scheme in the URL above, which is where the protocol comes from.
            RTMPS is RTMP inside TLS and usually listens on a different port, so check the port
            when you switch.
          </Text>
        )}
      </Field>
      <Field label="Stream key">
        <Input
          value={connection.streamKey}
          onChangeText={(value) => set("streamKey", value.trim())}
          editable={!synced}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </Field>
      {/*
        Where these three came from, and what they are not.
        
        The pairing code carries the studio's picture settings, so a freshly
        paired destination arrives holding the stream's own numbers - which
        makes them look like a live view of the server's settings. They are
        not: they are a copy taken at pairing, they only ever describe what
        this phone encodes and uploads, and nothing syncs them afterwards in
        either direction. An operator reasonably read the studio's own output
        settings off this screen and changed the wrong one.
      */}
      <Text className="pt-1 text-xs text-muted-foreground">
        These three are what this phone encodes and sends, and they are what your mobile data is
        spent on. They started as the studio’s settings when you paired and are this
        phone’s own copy now - changing them here changes nothing on the server, and what the
        server sends onward to YouTube is set on the web.
      </Text>

      <Field label="Picture">
        <View className="flex-row gap-2">
          {RESOLUTIONS.map((option) => (
            <Choice
              key={option.height}
              label={option.label}
              selected={connection.height === option.height}
              onPress={() =>
                onChange({ ...connection, width: option.width, height: option.height })
              }
            />
          ))}
        </View>
      </Field>

      <Field label="Frame rate">
        <View className="flex-row gap-2">
          {[30, 60].map((fps) => (
            <Choice
              key={fps}
              label={`${fps} fps`}
              selected={connection.fps === fps}
              onPress={() => set("fps", fps)}
            />
          ))}
        </View>
      </Field>

      <Field label="Bitrate">
        {/* Wraps: four of these in kbps are wider than a phone. */}
        <View className="flex-row flex-wrap gap-2">
          {BITRATES.map((option) => (
            <Choice
              key={option}
              label={formatKbps(option)}
              selected={connection.videoBitrate === option}
              onPress={() => set("videoBitrate", option)}
            />
          ))}
        </View>
        <Text className="text-xs text-muted-foreground">
          What the encoder aims at. On a weak connection it sends less by itself rather than
          stalling, and climbs back when the connection recovers.
        </Text>
      </Field>

      {/* Decided in the same minute as the picture size, and until now the one
          of those settings that meant opening a laptop. Only for a destination
          that came from a pairing code: the others are a server and a key, with
          nothing on the far end to ask. */}
      {paired && watch ? (
        <Field label="Who can watch">
          <View className="flex-row gap-2">
            {(["private", "unlisted", "public"] as const).map((option) => (
              <Choice
                key={option}
                label={option === "private" ? "Private" : option === "unlisted" ? "Unlisted" : "Public"}
                selected={watch.visibility === option}
                onPress={() => void chooseVisibility(option)}
              />
            ))}
          </View>
          <Text className="text-xs text-muted-foreground">
            {watch.visibility === "private"
              ? "On YouTube only the channel owner can open it. On Facebook it is created but never published."
              : watch.visibility === "unlisted"
                ? "Not on your channel and not in search, but anyone with the link can open it. This is the one to test with."
                : "Listed on the channel and pushed to feeds."}
          </Text>
          {watch.ignoredBy.length > 0 ? (
            <Text className="text-xs text-muted-foreground">
              <Text className="text-xs font-semibold text-foreground">
                This does not reach {watch.ignoredBy.join(", ")}.
              </Text>{" "}
              Framevane can only set this where it creates the broadcast for you, which means a
              YouTube channel or Facebook Page you have connected. A pasted stream key is just a
              pipe, so the platform&rsquo;s own default decides.
            </Text>
          ) : null}
          {watchNote ? <Text className="text-xs text-amber-400">{watchNote}</Text> : null}
        </Field>
      ) : null}

      {/* Source type and orientation. Only for a paired destination. */}
      {paired ? (
        <SourceSection connection={connection} />
      ) : null}

      {/* Where the studio sends it. Only for a paired destination, and only
          once there is a list to show. */}
      {paired && outputs && outputs.length > 0 ? (
        <Field label="Where the studio sends it">
          <View className="flex-row flex-wrap gap-2">
            {outputs.map((item) => (
              <Choice
                key={item.id}
                label={`${item.name} · ${item.platform === "youtube" ? "YouTube" : item.platform === "facebook" ? "Facebook" : item.platform}`}
                selected={item.enabled}
                onPress={() => void toggleOutput(item)}
              />
            ))}
          </View>
          <Text className="pt-1 text-xs text-muted-foreground">
            Ticked ones get the next broadcast. A change made while you are live reaches the
            running broadcast if the studio can change it on air, and otherwise waits for the next
            one - the studio says which after each switch.
          </Text>
          {outputsResult ? (
            <Text className="pt-1 text-xs text-foreground">{outputsResult}</Text>
          ) : null}
          {outputsNote ? (
            <Text className="pt-1 text-xs text-destructive">{outputsNote}</Text>
          ) : null}

          {outputs.some(() => true) ? (
            <DestinationOrientations
              connection={connection}
              destinations={outputs}
              onUpdate={setOutputs}
            />
          ) : null}
        </Field>
      ) : null}

      {/* Announcing the session. Only for a paired destination, and only when
          the studio has somewhere to send it - a switch that cannot do anything
          is worse than no switch. */}
      {paired && announce?.available ? (
        <Field label="Announce on WhatsApp">
          <View className="flex-row gap-2">
            <Choice
              label="Off"
              selected={!announce.announce}
              onPress={() => void changeAnnounce({ announce: false })}
            />
            <Choice
              label="On"
              selected={announce.announce}
              onPress={() => void changeAnnounce({ announce: true })}
            />
          </View>

          {announce.announce ? (
            <>
              <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Groups
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {announce.chats.map((chat) => (
                  <Choice
                    key={chat}
                    label={chat}
                    selected={announce.announceChats.includes(chat)}
                    onPress={() => toggleChat(chat)}
                  />
                ))}
              </View>

              <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Session
              </Text>
              <Input
                value={announce.announceSession}
                onChangeText={(value) =>
                  setAnnounceState((current) =>
                    current ? { ...current, announceSession: value } : current,
                  )
                }
                /* Written when the field is left rather than on every letter:
                   one request per keystroke would be a request per keystroke to
                   a server in another country. */
                onBlur={() => void changeAnnounce({ announceSession: announce.announceSession })}
                placeholder="What is being taught"
                autoCapitalize="words"
              />

              <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Teacher
              </Text>
              <Input
                value={announce.announceTeacher}
                onChangeText={(value) =>
                  setAnnounceState((current) =>
                    current ? { ...current, announceTeacher: value } : current,
                  )
                }
                onBlur={() => void changeAnnounce({ announceTeacher: announce.announceTeacher })}
                placeholder="Who is teaching"
                autoCapitalize="words"
              />

              <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Wait before announcing
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {[0, 30, 120, 300].map((seconds) => (
                  <Choice
                    key={seconds}
                    label={seconds === 0 ? "At once" : seconds < 60 ? `${seconds}s` : `${seconds / 60} min`}
                    selected={announce.announceDelay === seconds}
                    onPress={() => void changeAnnounce({ announceDelay: seconds })}
                  />
                ))}
              </View>
              <Text className="text-xs text-muted-foreground">
                Sent when the phone starts publishing, not when you press Go live - so a delay is
                the room to get the microphone on before three groups are told.
              </Text>

              {announce.preview ? (
                <>
                  <Text className="text-xs text-muted-foreground">
                    They will see:{" "}
                    <Text className="text-xs font-semibold text-foreground">{announce.preview}</Text>
                  </Text>

                  {/*
                    Which of the two this is, said plainly.

                    The written version and the template are the same grey
                    paragraph on this screen, so there was no way to tell a
                    working writer from a silent one - and the writer fails
                    quietly on purpose, because the template is a working
                    fallback. Quiet is right for the broadcast and wrong for
                    the operator, who asked how they would know.
                  */}
                  <Text className="text-xs text-muted-foreground">
                    {!announce.wording
                      ? "Written from the standard wording. The studio has no writer configured."
                      : announce.written
                        ? "Written for this session. Change the session or the teacher and it is rewritten."
                        : "The standard wording, for now - the studio is still writing one, or could not. Come back to this screen to see."}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    The watch link is added underneath when the broadcast opens - it does not exist
                    until then, so it is not in this preview. The description comes from the
                    stream's own, on the web.
                  </Text>
                </>
              ) : null}
            </>
          ) : null}
          {announceNote ? <Text className="text-xs text-amber-400">{announceNote}</Text> : null}
        </Field>
      ) : null}

      {connection.protocol === "srt" ? (
        <>
          <Field label="SRT latency">
            <View className="flex-row gap-2">
              {[500, 1000, 2000, 4000].map((ms) => (
                <Choice
                  key={ms}
                  label={`${ms} ms`}
                  selected={connection.srtLatencyMs === ms}
                  onPress={() => set("srtLatencyMs", ms)}
                />
              ))}
            </View>
            <Text className="text-xs text-muted-foreground">
              The buffer SRT may use to ask for a lost packet again. It has to be at least the
              round trip, and the server has a figure of its own with the larger of the two
              winning - so this is a floor, not a decision. More is steadier on a bad mobile
              connection and further behind live.
            </Text>
          </Field>

          <Field label="Passphrase">
            <Input
              value={connection.passphrase ?? ""}
              onChangeText={(value) => set("passphrase", value)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="Leave empty for none"
            />
            <Text className="text-xs text-muted-foreground">
              Encrypts the stream between this phone and the server. Both ends must have the same
              one, and it is 10 to 79 characters. Treated like the stream key: kept on this phone,
              never logged.
            </Text>
          </Field>
        </>
      ) : null}

      {blocking.length > 0 ? (
        <View className="gap-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          {blocking.map((problem) => (
            <Text key={problem.message} className="text-xs text-destructive">
              {problem.message}
            </Text>
          ))}
        </View>
      ) : null}

      {advisory.length > 0 ? (
        <View className="gap-1 rounded-xl border border-border p-3">
          {advisory.map((problem) => (
            <Text key={problem.message} className="text-xs text-muted-foreground">
              {problem.message}
            </Text>
          ))}
        </View>
      ) : null}

      <View className="flex-row gap-2">
        <Button className="flex-1" disabled={blocking.length > 0} onPress={onSave}>
          <Text>{blocking.length > 0 ? "Fix the above to save" : "Save"}</Text>
        </Button>
        <Button variant="ghost" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
      </View>
    </View>
  );
}

const SCHEMES = [
  { label: "rtmp", value: "rtmp" as const },
  { label: "rtmps", value: "rtmps" as const },
  { label: "srt", value: "srt" as const },
];

/** Swaps the scheme and leaves everything the operator typed after it alone. */
function withScheme(server: string, scheme: Connection["protocol"]): string {
  const rest = server.replace(/^[a-z]+:\/\//i, "");
  return `${scheme}://${rest}`;
}

const RESOLUTIONS = [
  { label: "360p", width: 640, height: 360 },
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
] as const;

/** Bits per second. 2.5M at 720p is the figure most platforms ask for. */
const BITRATES = [800_000, 1_500_000, 2_500_000, 4_500_000] as const;

/**
 * One of a set where exactly one is chosen, so a radio to a screen reader -
 * which is told which one is on. As tall as the settings screen's ChoiceRow:
 * at 32 points these were the smallest targets in the app, on the screen
 * operators use with a stream key half-typed and a class waiting.
 */
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      className={`min-h-[44px] justify-center rounded-xl border px-3 py-2 ${
        selected ? "border-foreground bg-foreground" : "border-border bg-background"
      }`}
    >
      {/* Group and destination names are whatever their owners typed, often
          in Arabic script, so each takes its direction from its own words. */}
      <Text
        style={bidi(label)}
        className={`text-xs font-medium ${selected ? "text-background" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Pairing by the code the studio shows under the QR.
 *
 * Two fields, and the first one is not a formality: this is self-hosted, so
 * nothing can guess where the studio is. It is remembered afterwards, because
 * an operator pairs a second phone against the same studio far more often than
 * they move house.
 *
 * The code is spent the moment this succeeds, and the result goes through the
 * same parser the scanner uses - a destination paired here and one paired by
 * scanning are the same object, with the same overlays, title and announcement
 * controls. That is the whole reason this exists rather than more fields on
 * the hand-typed form.
 */
function CodePairing({
  purpose,
  onPaired,
  onCancel,
}: {
  /**
   * Wording only. The studio decides what a code is, and either kind is
   * accepted whichever button opened this - an operator who typed the account
   * code into the stream form has still linked their phone.
   */
  purpose: "account" | "stream";
  onPaired: (result: Extract<ClaimResult, { ok: true }>) => void;
  onCancel: () => void;
}) {
  const [studio, setStudio] = useState(() => lastStudio());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await claimPairingCode(studio, code, phoneName());
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }

    // Only once it has worked. Remembering an address that turned out to be
    // wrong would hand the same mistake back on the next attempt.
    const base = studioUrlFrom(studio);
    if (base) rememberStudio(base);
    onPaired(result);
  };

  return (
    <View className="gap-3 rounded-2xl border border-border p-4">
      <Text className="text-base font-semibold">
        {purpose === "account" ? "Link with a code" : "Pair with a code"}
      </Text>

      <Field label="Studio address">
        <Input
          value={studio}
          onChangeText={setStudio}
          placeholder="framevane.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
        />
      </Field>

      <Field label={purpose === "account" ? "Linking code" : "Pairing code"}>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="K7M4-QP2X"
          autoCapitalize="characters"
          autoCorrect={false}
          // Letters and digits both, so not a number pad - and no spellcheck
          // turning a code into a word.
          maxLength={12}
        />
        <Text className="text-xs text-muted-foreground">
          {purpose === "account"
            ? 'Under the QR after "Link a phone" on the Streams page. It works once, and only for ten minutes.'
            : "Under the QR on the stream's page. It works once, and only for ten minutes."}
        </Text>
      </Field>

      {problem ? <Text className="text-sm text-destructive">{problem}</Text> : null}

      <View className="flex-row gap-2">
        <Button className="flex-1" disabled={busy} onPress={() => void submit()}>
          <Text>
            {purpose === "account" ? (busy ? "Linking" : "Link") : busy ? "Pairing" : "Pair"}
          </Text>
        </Button>
        <Button variant="outline" className="flex-1" disabled={busy} onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
      </View>
    </View>
  );
}

/**
 * Source type (live camera / looped file), stream orientation, and upload/loop
 * controls. Only shown for paired destinations that go through Framevane.
 */
function SourceSection({ connection }: { connection: Connection }) {
  const [source, setSource] = useState<SourceSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [looping, setLooping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSourceSettings(connection).then((result) => {
      if (cancelled) return;
      if (result.ok) setSource(result.value);
      else setNote(result.message);
    });
    return () => { cancelled = true; };
  }, [connection.id]);

  const changeSourceType = async (type: "live" | "file") => {
    const prev = source;
    setSource((s) => s ? { ...s, sourceType: type } : s);
    const result = await setSourceSettings(connection, { sourceType: type });
    if (result.ok) { setSource(result.value); setNote(null); }
    else { setSource(prev); setNote(result.message); }
  };

  const changeOrientation = async (orientation: "landscape" | "portrait") => {
    const prev = source;
    const [w, h] = orientation === "portrait" ? [1080, 1920] : [1920, 1080];
    setSource((s) => s ? { ...s, width: w, height: h } : s);
    const result = await setSourceSettings(connection, { orientation });
    if (result.ok) { setSource(result.value); setNote(null); }
    else { setSource(prev); setNote(result.message); }
  };

  const pickAndUpload = async () => {
    const pick = await DocumentPicker.getDocumentAsync({ type: "video/*" });
    if (pick.canceled || !pick.assets?.[0]) return;
    const asset = pick.assets[0];

    setUploading(true);
    setNote(null);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileId = `phone_${Date.now().toString(36)}`;
      const result = await uploadSourceVideo(connection, fileId, base64);
      if (result.ok) {
        setSource((s) => s ? { ...s, sourceType: "file", sourceFile: fileId } : s);
        setNote(`Uploaded ${formatBytes(result.value.bytes)}.`);
      } else {
        setNote(result.message);
      }
    } catch (error) {
      setNote(`Upload failed: ${(error as Error)?.message ?? "unknown error"}`);
    }
    setUploading(false);
  };

  const toggleLoop = async (action: "start" | "stop") => {
    setLooping(true);
    const result = await controlFileLoop(connection, action);
    setLooping(false);
    if (!result.ok) setNote(result.message);
    else setNote(action === "start" ? "Loop started." : "Loop stopped.");
  };

  if (!source) return note ? <Text className="text-xs text-amber-400">{note}</Text> : null;

  const isPortrait = source.height > source.width;

  return (
    <>
      <Field label="Source">
        <View className="flex-row gap-2">
          <Choice
            label="Live camera"
            selected={source.sourceType === "live"}
            onPress={() => void changeSourceType("live")}
          />
          <Choice
            label="Loop a file"
            selected={source.sourceType === "file"}
            onPress={() => void changeSourceType("file")}
          />
        </View>
        {source.sourceType === "file" ? (
          <>
            {source.sourceFile ? (
              <Text className="text-xs text-muted-foreground">
                File ready: {source.sourceFile}
              </Text>
            ) : (
              <Text className="text-xs text-amber-400">
                No video uploaded yet.
              </Text>
            )}
            <View className="flex-row gap-2 pt-1">
              <Pressable
                accessibilityRole="button"
                onPress={() => void pickAndUpload()}
                disabled={uploading}
                className="min-h-[44px] flex-1 items-center justify-center rounded-xl border border-border bg-background px-3 py-2 active:opacity-60"
              >
                <Text className="text-xs font-medium text-foreground">
                  {uploading ? "Uploading…" : source.sourceFile ? "Replace video" : "Upload video"}
                </Text>
              </Pressable>
              {source.sourceFile ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void toggleLoop("start")}
                    disabled={looping}
                    className="min-h-[44px] items-center justify-center rounded-xl border border-border bg-background px-3 py-2 active:opacity-60"
                  >
                    <Text className="text-xs font-medium text-foreground">
                      {looping ? "…" : "Start"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void toggleLoop("stop")}
                    disabled={looping}
                    className="min-h-[44px] items-center justify-center rounded-xl border border-border bg-background px-3 py-2 active:opacity-60"
                  >
                    <Text className="text-xs font-medium text-foreground">Stop</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            <Text className="text-xs text-muted-foreground">
              Upload a video to loop as a 24/7 live stream. Start begins the loop, Stop ends it.
            </Text>
          </>
        ) : (
          <Text className="text-xs text-muted-foreground">
            The phone's camera is the source. Point and go live.
          </Text>
        )}
      </Field>

      <Field label="Stream orientation">
        <View className="flex-row gap-2">
          <Choice
            label="Landscape"
            selected={!isPortrait}
            onPress={() => void changeOrientation("landscape")}
          />
          <Choice
            label="Portrait"
            selected={isPortrait}
            onPress={() => void changeOrientation("portrait")}
          />
        </View>
        <Text className="text-xs text-muted-foreground">
          {isPortrait ? "1080 × 1920 — tall, for Shorts and Reels." : "1920 × 1080 — wide, the standard."}
          {" "}Takes effect on the next broadcast.
        </Text>
      </Field>

      {note ? <Text className="text-xs text-amber-400">{note}</Text> : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Per-destination orientation toggles, shown below each destination in the list.
 */
function DestinationOrientations({
  connection,
  destinations,
  onUpdate,
}: {
  connection: Connection;
  destinations: StudioDestination[];
  onUpdate: (destinations: StudioDestination[] | null) => void;
}) {
  const [note, setNote] = useState<string | null>(null);

  const change = async (dest: StudioDestination, orientation: "landscape" | "portrait" | null) => {
    const prev = destinations;
    onUpdate(destinations.map((d) => d.id === dest.id ? { ...d, orientation } : d));
    const result = await setDestinationOrientation(connection, dest.id, orientation);
    if (!result.ok) {
      onUpdate(prev);
      setNote(result.message);
    } else {
      setNote(null);
    }
  };

  return (
    <>
      <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Orientation per destination
      </Text>
      {destinations.map((dest) => (
        <View key={dest.id} className="gap-1">
          <Text className="text-xs text-foreground">{dest.name}</Text>
          <View className="flex-row gap-2">
            <Choice
              label="Auto"
              selected={dest.orientation === null}
              onPress={() => void change(dest, null)}
            />
            <Choice
              label="16:9"
              selected={dest.orientation === "landscape"}
              onPress={() => void change(dest, "landscape")}
            />
            <Choice
              label="9:16"
              selected={dest.orientation === "portrait"}
              onPress={() => void change(dest, "portrait")}
            />
          </View>
        </View>
      ))}
      <Text className="text-xs text-muted-foreground">
        Auto uses the stream's orientation. A destination pinned to a different
        orientation gets center-cropped and re-encoded on the server, so one broadcast can go
        landscape to one channel and portrait to another.
      </Text>
      {note ? <Text className="text-xs text-amber-400">{note}</Text> : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}
