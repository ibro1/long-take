import { useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useFocusEffect } from "@react-navigation/native";
import { useKeepAwake } from "expo-keep-awake";
import { type Href, useRouter } from "expo-router";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BufferMeter } from "@/components/broadcast/buffer-meter";
import { Blend, ChartSpline, Thermometer, type LucideIcon } from "lucide-react-native";

import { useImmersiveScreen } from "@/lib/immersive";
import {
  loadPreferences,
  loadSettings,
  recordQualityFor,
  savePreferences,
  saveSettings,
  QUICK_CONTROLS,
  type QuickControl,
} from "@/lib/broadcast/settings";
import { MoreSheet, type MoreItem } from "@/components/broadcast/more-sheet";
import { Reticles as ReticlesView } from "@/components/broadcast/reticles";
import { ZoomRocker } from "@/components/broadcast/zoom-rocker";
import { GainHandle } from "@/components/broadcast/gain-handle";
import {
  availableAxes,
  type Axis,
  AxisWheel,
  CenterWeightOverlay,
  ManualControls,
  METERING_ICON,
  type MeteringMode,
  MeteringModeBar,
} from "@/components/broadcast/metering-modes";
import { FramingGuides, type GuideSet } from "@/components/broadcast/framing-guides";
import { ReadoutStrip } from "@/components/broadcast/readout-strip";
import {
  ColorDiamond,
  GlassDisc,
  InfoPanel,
  RingButton,
  StatusBadge,
  type BroadcastState,
} from "@/components/broadcast/filmic-chrome";
import { type SpotPoint, useSpotMeter } from "@/lib/broadcast/useSpotMeter";
import { ladderEffects, useThermalLadder } from "@/lib/broadcast/thermal-ladder";
import { useIdleDim } from "@/lib/broadcast/idle-dim";
import { DrainEstimator } from "@/lib/broadcast/battery-estimate";
import { listPresets, type Preset, savePreset, subscribePresets } from "@/lib/broadcast/presets";
import { ColorPanel } from "@/components/broadcast/color-panel";
import { GammaTab, LooksTab, LutTab } from "@/components/broadcast/grade-tabs";
import { applyGrade, GRADE_DEFAULTS, type GradeState, loadGrade, saveGrade } from "@/lib/broadcast/grade";
import { registerPresetActions } from "@/lib/broadcast/preset-actions";
import { routeForTile, SettingsGrid } from "@/components/settings/settings-grid";
import { ChoiceRow, Group, Page, SwitchRow } from "@/components/settings/chrome";
import { useReadout } from "@/lib/broadcast/readouts";
import { MonitoringSelector } from "@/components/broadcast/monitoring-selector";
import { topBanner } from "@/lib/broadcast/banners";
import { plainFailure } from "@/lib/broadcast/failure";
import { guardFor, preflightGuards } from "@/lib/broadcast/guards";
import { formatKbps } from "@/lib/broadcast/units";
import { offerableInputs } from "@/lib/broadcast/inputs";
import { levelSnapshot, noteRender, subscribeLevel } from "@/lib/broadcast/level-store";
import {
  Banner,
  HUD_TEXT,
  Panel,
  ShutterButton,
  Readout,
  Row,
  Toggle,
} from "@/components/broadcast/chrome";
import {
  AnalyticsIcon,
  CameraIcon,
  CloseIcon,
  DrawerIcon,
  FlipIcon,
  GoLiveIcon,
  GlobeIcon,
  LogIcon,
  MicIcon,
  MicOffIcon,
  OverlayIcon,
  PauseIcon,
  PhotoIcon,
  RecordIcon,
  ResumeIcon,
  PresetIcon,
  SettingsIcon,
  ShapeIcon,
  StatsIcon,
  StopIcon,
} from "@/components/broadcast/icons";
import { LevelMeter } from "@/components/broadcast/level-meter";
import { LogPanel } from "@/components/broadcast/log-panel";
import { Mono } from "@/components/broadcast/mono";
import { Notice } from "@/components/broadcast/notice";
import { OverlaysPanel } from "@/components/broadcast/overlays-panel";
import { OffAirOverlay, ReconnectingOverlay } from "@/components/broadcast/connection-overlay";
import { StudioChip } from "@/components/broadcast/studio-chip";
import { PausedOverlay } from "@/components/broadcast/paused-overlay";
import { RecordPill } from "@/components/broadcast/record-pill";
import { Stepper } from "@/components/broadcast/stepper";
import { TouchLayer } from "@/components/broadcast/touch-layer";
import { UpdateCard, useHostUpdatePrompt } from "@/components/updates/update-prompt";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { activeConnection, type Connection, saveConnection } from "@/lib/broadcast/connections";
import { pushLog } from "@/lib/broadcast/log";
import { endBroadcast } from "@/lib/broadcast/overlays";
import { isSettled } from "@/lib/broadcast/studio-status";
import { useHealthHeartbeat } from "@/lib/broadcast/useHealthHeartbeat";
import { useStudioStatus } from "@/lib/broadcast/useStudioStatus";
import { mark, tick } from "@/lib/haptics";
import { applyLanguagePreference, bidi, type Language, t, textDir } from "@/lib/i18n";
import { AWB_AUTO, formatUptime, useBroadcast } from "@/lib/broadcast/useBroadcast";
import {
  type AudioDevice,
  BroadcasterView,
  type CameraInfo,
  LevelMeterView,
  type MonitorMode,
  type Orientation,
  setMonitor,
  setMonitorOptions,
  setScreenBrightness,
  hasColorGrade,
  setMicGain,
  setPauseSlate,
  setThermalBitrateCap,
} from "@/modules/framevane-broadcaster";

/**
 * The clear band of the landscape picture a panel may use: under the top row
 * (discs, readout strip, destination pill) and over the bottom row (info
 * panel, corner discs). Measured off the layout those rows are drawn with.
 */
const PANEL_BAND_TOP = 88;
const PANEL_BAND_BOTTOM = 72;

const COLOR_TABS = [
  { id: "wb", label: "White balance", Icon: Thermometer },
  { id: "looks", label: "Looks", Icon: Blend },
  { id: "gamma", label: "Gamma", Icon: ChartSpline },
  { id: "lut", label: "LUT", Icon: Thermometer },
] as const;

const COLOR_PANEL = {
  position: "absolute",
  flexDirection: "row",
  backgroundColor: "#EEEEEE",
  borderRadius: 4,
  overflow: "hidden",
  zIndex: 20,
} as const;

/** Named apart from the Panel component: one is a box, this is which box. */
/**
 * Long enough to lift the phone and frame the shot, short enough that nobody
 * presses it twice thinking it did not take. Three is what every camera timer
 * settled on.
 */
const COUNTDOWN_SECONDS = 3;

/**
 * How loud counts as heard, on the 0-100 peak the level event carries.
 *
 * Speech sits around the middle of the meter, which the meter draws from the
 * square root of this - so a voice at arm's length is well over 5, and a quiet
 * room's hum is under it. The point is to catch a microphone that delivers
 * nothing at all, the "every sample is silent" case, not to grade a voice.
 */
const HEARD_PEAK = 5;

/**
 * The two buzzes, as Android vibration patterns: wait, buzz, gap, buzz.
 * Two short for a drop that is being dealt with; three long for one that is
 * not, so the two can be told apart from a pocket without looking.
 */
const DROPPED_BUZZ = [0, 180, 120, 180];
const GAVE_UP_BUZZ = [0, 500, 200, 500, 200, 500];

/**
 * Asks for the notification permission on the way to air, when the broadcast
 * is going to need it.
 *
 * Background broadcasting is on by default now, so the settings toggle - the
 * one place that used to ask - is never pressed by an operator who keeps the
 * default. From Android 13 the service's notification is hidden without this
 * permission, and a broadcast holding the camera behind a notification nobody
 * can see or stop from is not one to start without asking. Asked here, after
 * the check and before the countdown, because this is the moment the request
 * plainly belongs to.
 *
 * A refusal does not stop the broadcast. The service still runs; only its
 * notification is hidden, and the log says so for whoever reads it afterwards.
 * Asking again on every go-live costs nothing once Android has stopped
 * showing the dialog: the request then answers at once.
 */
async function askForBroadcastNotification(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  if (!loadPreferences().backgroundBroadcast) return;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(permission)) return;
    const result = await PermissionsAndroid.request(permission);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      pushLog({
        at: Date.now(),
        level: "warn",
        message:
          "Notifications are not allowed, so the background broadcast runs without a notification to see or stop it from.",
      });
    }
  } catch {
    // A permission request that throws is not a reason to stay off air.
  }
}

/**
 * Below this the charge is worth showing; below the second it is worth
 * colouring. Above it the number is just clutter on top of a picture - the
 * phone's own status bar already carries it for anyone who wants it, and this
 * screen is covered by the operator's hand often enough as it is.
 */
const LOW_BATTERY = 0.4;
const CRITICAL_BATTERY = 0.15;

type PanelId =
  | "camera"
  | "image"
  | "presets"
  | "shape"
  | "overlays"
  | "stats"
  | "log"
  | "mic"
  | "preflight"
  | null;

/**
 * How wide the landscape control column is. Fixed rather than proportional,
 * and derived from its widest row: four 44px discs and the gaps between them,
 * plus the column's own padding. A proportional width gets narrower on a
 * narrower phone, and the discs do not - they just stop fitting, which is how
 * the old layout ended up with controls off the edge of the screen.
 */
/**
 * Hoisted because it is a prop on a native view. An object literal in the JSX
 * is a new object on every render, so the camera view was handed a "changed"
 * style every time anything on this screen moved - the uptime ticking, a
 * bitrate arriving - and paid for a native style update each time.
 */
const FILL = { flex: 1 } as const;

/**
 * Wide enough for what is in it and no wider.
 *
 * Two 44px discs, the 8px between them and 12px of padding either side comes to
 * 120. It was 224 - a number from when this column held four discs in a row
 * with their labels under them - and every pixel past what the controls need is
 * picture taken away from the shot.
 */
const COLUMN = 120;

/**
 * Landscape's leading column, Filmic's black strip with the framing ring, the
 * state badge and the colour diamond. It sits in the letterbox a 16:9 picture
 * leaves on a 20:9 phone, so it costs the shot almost nothing.
 */
const LEFT_COLUMN = 84;


export default function BroadcastScreen() {
  const router = useRouter();
  const [camera, requestCamera] = useCameraPermissions();
  const [microphone, requestMicrophone] = useMicrophonePermissions();
  const [connection, setConnection] = useState<Connection | null>(null);
  // The status bar and the navigation keys come off while this screen has
  // focus. See lib/immersive.ts for why this is focus-driven and not a mount.
  useImmersiveScreen();

  // Dev-only: counts commits of this screen, reported once a second with the
  // meter counters.
  useEffect(() => {
    noteRender();
  });

  const [moreOpen, setMoreOpen] = useState(false);
  /**
   * Which of the optional controls sit on the glass rather than behind More.
   *
   * Re-read whenever this screen comes back, because Settings is one tap away
   * and both screens stay mounted - so a change made there would otherwise not
   * show until the app was restarted.
   */
  const [glass, setGlass] = useState<QuickControl[]>(() => loadPreferences().quickAccess);
  /** The viewfinder's own preferences (Device and Interface pages). */
  const [viewPrefs, setViewPrefs] = useState(() => viewPrefsOf(loadPreferences()));
  useFocusEffect(
    useCallback(() => {
      const prefs = loadPreferences();
      setGlass(prefs.quickAccess);
      setViewPrefs(viewPrefsOf(prefs));
    }, []),
  );
  const [panel, setPanel] = useState<PanelId>(null);
  const { width, height } = useWindowDimensions();
  const {
    state,
    detail,
    reconnects,
    lastDrop,
    lostAir,
    dismissLostAir,
    congested,
    stalled,
    dropped,
    setStatsWatched,
    live,
    muted,
    cameras,
    charge,
    orientation,
    start,
    stop,
    restart,
    selectCamera,
    setOrientation,
    toggleMute,
    onStatus,
    onBitrate,
    onStats,
    onLevel,
    onCameras,
    onAudioDevices,
    audioInput,
    audioDevices,
    selectAudioInput,
    capabilities,
    zoom,
    zoomRange,
    setZoom,
    autoFocus,
    focusAt,
    setAutoFocus,
    exposure,
    exposureLocked,
    exposureRange,
    setExposure,
    setExposureLock,
    focusDistance,
    manualFocus,
    setFocusDistance,
    resumeAutoFocus,
    whiteBalance,
    setWhiteBalance,
    kelvin,
    tint,
    setWhiteBalanceKelvin,
    exposureMode,
    setExposureMode,
    manualIso,
    manualExposureNs,
    setManualExposure,
    onExposureState,
    noiseReduction,
    setNoiseReduction,
    antiFlicker,
    setAntiFlicker,
    stabilization,
    setStabilization,
    torch,
    toggleTorch,
    flipCamera,
    paused,
    pausedAt,
    togglePause,
    recording,
    toggleRecording,
    onRecord,
    onThermal,
    thermal,
    usableBytes,
    micSilence,
    onAudioInterrupted,
    restoreMicrophone,
    takePhoto,
    notice,
    notify,
    onLog,
  } = useBroadcast();

  // The screen must not sleep mid-broadcast; a locked phone stops the preview
  // and an operator who put it on a stand has not asked to go off air.
  useKeepAwake();

  /**
   * Tells the studio how the phone is doing while it is live - heat, battery,
   * the frame rate actually leaving it. Nothing here is shown on this screen:
   * it is for whoever has to find out afterwards why a class went wrong.
   */
  useHealthHeartbeat({ connection, live, state, thermal, charge, reconnects, lastDrop });

  /**
   * Asks the studio whether YouTube is actually on air, for the chip beside the
   * uptime. The answer goes to a store the chip reads, not into this screen's
   * state - see lib/broadcast/studio-status.ts.
   */
  useStudioStatus({ connection, live });

  /**
   * The language of the words on the glass, re-read on focus because it is
   * chosen on the Settings tab. Held in state only so that a change re-renders
   * this screen; the strings themselves come from `t`.
   */
  const [, setLanguage] = useState<Language>(() => applyLanguagePreference());
  useFocusEffect(
    useCallback(() => {
      setLanguage(applyLanguagePreference());
    }, []),
  );

  /**
   * Re-read on every focus, not once on mount.
   *
   * The navigator was told to stop detaching inactive tabs - so that a tab
   * change could not tear down the camera or end a broadcast - and the cost of
   * that is this screen no longer being rebuilt when the operator comes back
   * to it. Adding a destination and returning here left it still saying there
   * was none.
   */
  useFocusEffect(
    useCallback(() => {
      setConnection(activeConnection());
    }, []),
  );

  // Only read the encoder's numbers while the panel showing them is open. It
  // is already read on its own while live, for the head-up display.
  useEffect(() => {
    setStatsWatched(panel === "stats");
  }, [panel, setStatsWatched]);

  /**
   * A few seconds between pressing and broadcasting.
   *
   * Going live is the one action on this screen that an audience sees
   * immediately, and the moment just after pressing is exactly when an
   * operator is still moving the phone into position. The count gives them
   * that moment back, and gives anyone who pressed it by mistake a way out -
   * the button becomes Cancel for as long as it is running.
   */
  const [counting, setCounting] = useState<number | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * The count itself, kept beside the state rather than read out of it.
   *
   * React is free to run a state updater more than once - in development it
   * does, every time - and going live from inside one meant two startStream
   * calls on one camera. So the updater does nothing but set a number, and the
   * decision to start lives out here in the tick, which runs once.
   */
  const remaining = useRef(0);

  const cancelCountdown = useCallback(() => {
    if (countdown.current) clearInterval(countdown.current);
    countdown.current = null;
    remaining.current = 0;
    setCounting(null);
  }, []);

  const beginCountdown = useCallback(
    (destination: Connection) => {
      if (countdown.current) return;
      remaining.current = COUNTDOWN_SECONDS;
      setCounting(COUNTDOWN_SECONDS);
      countdown.current = setInterval(() => {
        remaining.current -= 1;
        if (remaining.current > 0) {
          setCounting(remaining.current);
          return;
        }
        // The last tick starts the broadcast rather than showing a zero
        // nobody needs to read.
        if (countdown.current) clearInterval(countdown.current);
        countdown.current = null;
        setCounting(null);
        // Felt as well as seen: the phone is often already on its stand, and
        // this is the moment the operator looks away from it to the class.
        mark();
        // `start` closes its own failures out onto the banner, which is why
        // this can be fired and forgotten from a timer with nobody waiting.
        void start(destination);
      }, 1000);
    },
    [start],
  );

  // A countdown left running after the screen goes would start a broadcast
  // nobody is watching for.
  useEffect(() => () => cancelCountdown(), [cancelCountdown]);

  /**
   * And after the screen is merely left. The tabs stay mounted, so the unmount
   * above never fires on a tab change - an operator who pressed Go live and
   * then went to check the destination came back to a broadcast already on
   * air, started by a count they had walked away from.
   */
  useFocusEffect(useCallback(() => () => cancelCountdown(), [cancelCountdown]));

  /**
   * Ending asks first.
   *
   * Every other control here is reversible in a second; this one is not - it
   * drops the connection, and on platforms that end their event with the
   * stream it cannot simply be picked up again. A system dialog rather than
   * one of our panels because it has to be impossible to tap through by
   * accident, which is the whole point.
   */
  const confirmEnd = useCallback(() => {
    Alert.alert(
      t("end.title"),
      t("end.body"),
      [
        { text: t("end.keep"), style: "cancel" },
        {
          text: t("end.confirm"),
          style: "destructive",
          onPress: () => {
            mark();
            void (async () => {
              /**
               * The encoder first, so the studio is told by a phone that has
               * already gone quiet: ending the run while this one is still
               * publishing would have the ingest edge open a new broadcast a
               * second later.
               *
               * But the studio is told whatever the encoder does. It used to
               * be told only after a clean stop, so a stop that threw - or
               * never came back - skipped the call without a word, and a
               * finished class sat on YouTube as a live event with a spinner
               * for the whole reconnect grace. A failed stop is logged and
               * the end still goes out.
               */
              try {
                await Promise.race([stop(), new Promise((resolve) => setTimeout(resolve, 8000))]);
              } catch (error) {
                pushLog({
                  at: Date.now(),
                  level: "warn",
                  message: `The encoder did not stop cleanly: ${(error as Error)?.message ?? error}`,
                });
              }
              if (!connection) return;
              /**
               * Tried a few times. The end of a class is often the worst
               * signal of it, and a lost request here costs the channel five
               * minutes of an empty live event.
               */
              let last = "";
              for (const wait of [0, 2000, 5000]) {
                if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
                const ended = await endBroadcast(connection);
                if (ended.ok) {
                  pushLog({ at: Date.now(), level: "info", message: "The studio ended the broadcast." });
                  return;
                }
                last = ended.message;
              }
              pushLog({
                at: Date.now(),
                level: "warn",
                message: `The studio could not be told the broadcast ended (${last}). It closes on its own within five minutes.`,
              });
            })();
          },
        },
      ],
    );
  }, [stop, connection]);

  /**
   * The hardware back button, while live.
   *
   * Back on this screen leaves it, and leaving it is one step from the app
   * going behind the launcher - which, for an operator who never turned on
   * background broadcasting, used to be the end of the broadcast by a gesture
   * nobody thinks of as ending anything. So while live it asks the same
   * question the End button asks. An open panel or the overflow sheet is
   * closed first, because that is what back means to everyone holding the
   * phone at that moment. Off air, back does what it always does.
   *
   * Focus-scoped: the other tabs keep their own back behaviour.
   */
  useFocusEffect(
    useCallback(() => {
      if (!live) return undefined;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (moreOpen) {
          setMoreOpen(false);
          return true;
        }
        if (panel !== null) {
          setPanel(null);
          return true;
        }
        confirmEnd();
        return true;
      });
      return () => subscription.remove();
    }, [live, moreOpen, panel, confirmEnd]),
  );

  /**
   * One buzz when the stream drops, and a longer one when it gives up.
   *
   * The operator of a phone on a stand is looking at the room, and a dropped
   * connection drawn on a screen nobody is facing is a dropped connection
   * nobody knows about until a viewer says so. Once per change, not per retry:
   * the native side holds `reconnecting` for the whole of an outage, and a
   * phone that buzzed on every attempt would be switched to silent within the
   * first minute of one.
   */
  const previousState = useRef(state);
  useEffect(() => {
    const before = previousState.current;
    previousState.current = state;
    if (state === "reconnecting" && before !== "reconnecting") {
      Vibration.vibrate(DROPPED_BUZZ);
    }
  }, [state]);

  const previousLostAir = useRef(lostAir);
  useEffect(() => {
    if (lostAir && !previousLostAir.current) Vibration.vibrate(GAVE_UP_BUZZ);
    previousLostAir.current = lostAir;
  }, [lostAir]);

  /**
   * The check before going live.
   *
   * Two mistakes kept reaching the air: the wrong microphone - the phone's own
   * instead of the Bluetooth headset the lessons are taught on - and a
   * recording set to a size nobody meant. Both are visible on this screen if
   * you know where to look, and neither is where anyone looks in the minute
   * before a class. So GO LIVE now opens one panel that shows the three things
   * worth a glance - the microphone, the picture going out, the copy on the
   * phone - and checks what it can check itself rather than asking to be
   * ticked. A list the operator ticks every time becomes a list they tap
   * through; a panel that is quiet when all is well and speaks up about the
   * one thing that is off does not.
   */
  const [usualMic, setUsualMic] = useState(() => loadPreferences().usualMic);
  // The colour panel's tab, and its Looks / Gamma / LUT grade - sent to the
  // camera once at launch and again on every change.
  const [colorTab, setColorTab] = useState<"wb" | "looks" | "gamma" | "lut">("wb");
  const [grade, setGrade] = useState<GradeState>(() => loadGrade());
  useEffect(() => {
    void applyGrade(grade);
    // Once, at mount: later changes go through changeGrade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gradeRef = useRef(grade);
  const changeGrade = useCallback((next: GradeState) => {
    // Side effects outside the state updater, which React may run twice.
    saveGrade(next, gradeRef.current);
    gradeRef.current = next;
    setGrade(next);
  }, []);
  const [wbSlots, setWbSlots] = useState(() => {
    const p = loadPreferences();
    return { a: p.wbSlotA, b: p.wbSlotB };
  });
  const [recordOnStart, setRecordOnStart] = useState(
    () => loadPreferences().recordWhileStreaming,
  );
  const [recordHeight, setRecordHeight] = useState(() => loadPreferences().recordHeight);
  const [heard, setHeard] = useState(false);
  const inputInUse = audioDevices.find((device) => device.current) ?? null;

  /**
   * Read fresh each time the check opens. The viewfinder stays mounted behind
   * the Settings tab, so a value read once at mount would show last week's
   * choice after it was changed there.
   */
  useEffect(() => {
    if (panel !== "preflight") return;
    const preferences = loadPreferences();
    setUsualMic(preferences.usualMic);
    setRecordOnStart(preferences.recordWhileStreaming);
    setRecordHeight(preferences.recordHeight);
  }, [panel]);

  /**
   * Whether the microphone has actually been heard since the check opened.
   *
   * Starts over when the microphone changes: a headset switched in has not been
   * heard just because the phone's own microphone was. The level store is read
   * directly rather than through state, so the whole screen is not re-rendered
   * eight times a second to find out one yes.
   */
  useEffect(() => {
    if (panel !== "preflight") return;
    setHeard(false);
    const listen = () => {
      if (levelSnapshot() >= HEARD_PEAK) setHeard(true);
    };
    listen();
    return subscribeLevel(listen);
  }, [panel, inputInUse?.id]);

  /**
   * The microphone the operator just tapped, until it is the one in use.
   *
   * The row's highlight follows the device actually recording, which is the
   * honest readout - and a headset takes seconds to answer, so for those
   * seconds the tap looked ignored and got tapped again. It says it is
   * connecting instead, and lets go when the switch lands or after twelve
   * seconds, by which time the native side has said what happened.
   */
  const [pendingMic, setPendingMic] = useState<number | null>(null);
  useEffect(() => {
    if (pendingMic === null) return;
    if (audioDevices.some((device) => device.id === pendingMic && device.current)) {
      setPendingMic(null);
      return;
    }
    const timer = setTimeout(() => setPendingMic(null), 12_000);
    return () => clearTimeout(timer);
  }, [pendingMic, audioDevices]);

  const ready = camera?.granted && microphone?.granted;

  /**
   * The update card goes in this screen's banner column rather than floating
   * over it. Only once the viewfinder is up: the permission screen has no
   * column, and there the floating copy is the right one.
   */
  useHostUpdatePrompt(Boolean(ready));

  /**
   * Whether the answer is in yet, which is not the same as the answer being no.
   *
   * `useCameraPermissions` resolves asynchronously and returns null until it
   * does. Treating null as "not granted" meant every launch rendered the
   * "Framevane needs the camera" screen for a frame before flipping to the
   * viewfinder - so an operator who granted these months ago was told they had
   * not, briefly, every single time they opened the app.
   */
  const answered = camera !== null && microphone !== null;

  /**
   * Android stops showing the dialog after two refusals and answers every
   * later request with a denial nobody saw. A screen whose only control is an
   * Allow button that has silently stopped doing anything is a dead end, and
   * the app is the camera - there is nothing else to use. So once the system
   * will not ask again, the button stops pretending to and opens the one place
   * the decision can still be changed.
   */
  const blocked =
    (camera !== null && !camera.granted && !camera.canAskAgain) ||
    (microphone !== null && !microphone.granted && !microphone.canAskAgain);

  /**
   * Landscape is not portrait reflowed, it is the other half of the job. A
   * phone on a tripod shooting wide has a third of the vertical room, so the
   * controls leave the bottom of the frame entirely and stand in a column down
   * the trailing edge, under the hand already holding the phone - with the
   * button that ends the broadcast at the bottom corner where the thumb rests.
   * Portrait keeps its dock along the bottom, which is where a phone held
   * upright puts the thumb.
   */
  const wide = width > height;

  /**
   * The last tap on the picture, which is where the exposure rail hangs.
   *
   * Kept here rather than in the touch layer because the rail has to be drawn
   * above that layer to take its own drag, and the frame travels with the
   * point so the rail can be kept inside the picture - in landscape the
   * picture is not the whole screen.
   *
   * Above the permission gates with every other hook, not down beside the code
   * that uses it: those gates return early, and a hook declared after them is
   * a hook React counts on one render and not the next. That is what
   * "rendered more hooks than during the previous render" means, and it took
   * the screen down the moment the permission check answered.
   */
  /**
   * The state of the phone itself, ranked into at most one thing to say.
   *
   * The take's size is estimated from how long it has been running rather than
   * measured: the figure is only used against a floor that already carries
   * 400 MB of slack, and stat-ing a growing file every fifteen seconds to
   * refine a number that never needs refining is work for nothing.
   */
  // Whole minutes: the estimate feeds a floor with 400 MB of slack, so a
  // per-second figure only re-ran this - and re-rendered the screen - for nothing.
  const recordMinute = useReadout((r) => Math.floor(r.recordSeconds / 60));
  const guard = useMemo(
    () =>
      guardFor({
        thermal,
        usableBytes,
        battery: charge.level,
        charging: charge.charging,
        recordingBitrate: recordingBitrateOf(connection),
        takeBytes: recording ? (recordMinute * 60 * recordingBitrateOf(connection)) / 8 : 0,
        recording,
        live,
      }),
    [
      thermal,
      usableBytes,
      charge.level,
      charge.charging,
      connection,
      recording,
      recordMinute,
      live,
    ],
  );

  /**
   * A guard the operator has put away, remembered as what it was warning
   * about. A different condition, or the same one gone worse, is news again
   * and comes back; the same one saying the same thing does not.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shownGuard = guard && `${guard.id}:${guard.tone}` !== dismissed ? guard : null;

  /** The one banner drawn, out of everything that could be - see banners.ts. */
  const shownBanner = topBanner({
    // Not gated on `detail`, which it used to be: the native side reports
    // `authError` with no detail at all, so a refused key drew nothing.
    failure: lostAir || state === "failed" || state === "authError",
    stall: stalled,
    micSilence: micSilence !== null,
    guard: shownGuard !== null,
    congestion: congested && live && !stalled,
  });

  /**
   * The one thing in here the app does rather than says.
   *
   * Closing the file is the whole point - an unfinished MP4 plays nowhere - and
   * the guard's text says it is happening before it happens. The ref is what
   * keeps it to once: the conditions that triggered it are still true on the
   * next render, and a stop called in a loop would fight the recorder.
   */
  const acted = useRef(false);
  useEffect(() => {
    if (guard?.action !== "stopRecording") {
      acted.current = false;
      return;
    }
    if (acted.current || !recording) return;
    acted.current = true;
    void toggleRecording();
  }, [guard, recording, toggleRecording]);


  // Display-only monitoring (focus peaking). The native side clears it on air;
  // this keeps the control in step and resets it when a broadcast starts.
  const [monitor, setMonitorMode] = useState<MonitorMode>("off");
  const applyMonitor = useCallback((mode: MonitorMode) => {
    setMonitorMode(mode);
    void setMonitor(mode).catch(() => {});
  }, []);
  useEffect(() => {
    if (live && monitor !== "off") setMonitorMode("off");
  }, [live, monitor]);

  /**
   * The heat ladder: as Android's thermal status climbs, shed the viewfinder's
   * own load before the phone throttles everything - aids off and slower meters
   * at moderate, a bitrate cap and a quieter, dimmer screen at severe, a bare
   * viewfinder at critical. It comes back down one step a minute. See
   * lib/broadcast/thermal-ladder.ts; Device settings can switch it off.
   */
  const ladderStep = useThermalLadder(thermal, viewPrefs.thermalLadder);
  const ladder = useMemo(() => ladderEffects(ladderStep), [ladderStep]);
  // The heat ladder takes the aids away only while a take is running - that is
  // when the heat costs something. Off air a warm phone (Android says "light"
  // just from being held) must not silently lock the operator out of peaking.
  const aidsHeld = ladder.aidsOff && (live || recording);
  useEffect(() => {
    if (aidsHeld && monitor !== "off") applyMonitor("off");
  }, [aidsHeld, monitor, applyMonitor]);
  useEffect(() => {
    setThermalBitrateCap(ladder.bitrateCap);
  }, [ladder.bitrateCap]);

  // Peaking colour and zebra threshold from Interface settings.
  useEffect(() => {
    setMonitorOptions({
      peakingColor: viewPrefs.peakingColor,
      zebraThreshold: viewPrefs.zebraThreshold,
    });
  }, [viewPrefs.peakingColor, viewPrefs.zebraThreshold]);

  /**
   * Dim after 30 s untouched - the operator's choice for a tripod class, or the
   * ladder's at severe heat. The screen is the second-biggest heat source after
   * the chip, and on a tripod nobody is looking at it most of the hour.
   */
  const { touched } = useIdleDim({
    enabled: viewPrefs.dimWhenIdle || ladder.dimIdle,
    dimAfterMs: 30_000,
    onDim: () => setScreenBrightness(ladder.dimIdle ? 0.6 : 0.35),
    onWake: () => setScreenBrightness(-1),
  });

  /** Minutes of battery left at the recent rate of drain, said when the info panel is held. */
  const drain = useRef(new DrainEstimator());
  useEffect(() => {
    drain.current.sample(charge.level, charge.charging, Date.now());
  }, [charge.level, charge.charging]);
  const sayBattery = useCallback(() => {
    const minutes = drain.current.minutesLeft();
    notify(
      charge.charging
        ? "Charging"
        : minutes === null
          ? "Measuring the battery - ask again in a couple of minutes"
          : t("guard.minutesOfBattery", { minutes }),
    );
  }, [charge.charging, notify]);

  /** Analytics (peaking / zebra / false colour) live behind one button, as in Filmic. */
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  // Filmic's reticle modes, behind the ring at the top of the leading column.
  const [meterMode, setMeterMode] = useState<MeteringMode>("reticle");
  const [meterBarOpen, setMeterBarOpen] = useState(false);
  const [manualAxis, setManualAxis] = useState<Axis>("lv");
  // Focus held on the reticle - by a tap on the puck, or carried back from
  // Manual's ruler. Owned here so Manual can hand it over.
  const [focusHeld, setFocusHeld] = useState(false);
  /** Filmic's settings grid, opened over the viewfinder from the gear. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The page the settings panel opens on, or null for the grid. */
  const [settingsOpenTo, setSettingsOpenTo] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>(() => listPresets());
  useEffect(() => subscribePresets(() => setPresets(listPresets())), []);
  const [presetName, setPresetName] = useState("");

  /**
   * Where the exposure reticle sits, in fractions of the camera view. The spot
   * meter reads the picture there and steers compensation toward a mid-grey -
   * held while the exposure is locked, and while a monitoring aid recolours the
   * picture it would otherwise be measuring.
   */
  // A ref, not state: dragging the reticle reports a dozen points a second, and
  // as state each one re-rendered the whole viewfinder. The meter reads it.
  const exposurePoint = useRef<SpotPoint | null>(null);
  const onExposurePoint = useCallback((x: number, y: number) => {
    exposurePoint.current = { x, y, movedAt: Date.now() };
  }, []);
  useSpotMeter({
    pointRef: exposurePoint,
    enabled:
      (capabilities?.available ?? false) &&
      exposureRange.max > exposureRange.min &&
      !exposureLocked &&
      monitor === "off" &&
      panel === null &&
      meterMode === "reticle" &&
      exposureMode === "auto",
    exposure,
    min: exposureRange.min,
    max: exposureRange.max,
    onExposure: setExposure,
    intervalMs: ladder.spotMeterIntervalMs,
  });

  /**
   * The picture area the reticles may use: between the Filmic side columns in
   * landscape, between the head-up band and the dock in portrait.
   */
  /**
   * The landscape columns' real widths, measured: each is a SafeAreaView, so on
   * a phone with a cutout it is wider than its content by the inset - and
   * `useSafeAreaInsets` is not available here (no SafeAreaProvider at the root; the
   * hook returned undefined and took the screen down once). The
   * picture's own chrome is offset from these, not from the constants, or it
   * slides under the columns by exactly the cutout.
   */
  const [lead, setLead] = useState(LEFT_COLUMN);
  const [trail, setTrail] = useState(COLUMN);
  // Portrait's Filmic bars, measured for the same reason.
  const [topBar, setTopBar] = useState(64);
  const [bottomBar, setBottomBar] = useState(160);

  /** Framing guides drawn over the picture; set in the Shape panel. */
  const [guides, setGuides] = useState<GuideSet>({
    thirds: false,
    centre: false,
    safe43: false,
    safe11: false,
  });
  const toggleGuide = useCallback(
    (key: keyof GuideSet) => setGuides((g) => ({ ...g, [key]: !g[key] })),
    [],
  );

  /** The codec in use, for the readout strip. Re-read when the destination changes. */
  const videoCodec = useMemo(() => loadSettings().videoCodec, [connection]);

  // Memoised so the reticles see the same object between renders and skip them.
  const reticleInsets = useMemo(
    () =>
      wide
        ? { left: lead, right: trail, top: 0, bottom: 0 }
        : { left: 0, right: 0, top: topBar + 28, bottom: bottomBar + 80 },
    [wide, lead, trail, topBar, bottomBar],
  );

  // Nothing yet, rather than the wrong thing. The check takes a frame or two.
  // What the Presets page borrows from the viewfinder; filled in further down,
  // once the functions it lends exist. Hooks stay above the early returns.
  const presetActionsRef = useRef({ save: (_: string) => {}, apply: (_: Preset) => {}, reset: () => {} });
  useEffect(() => {
    registerPresetActions({
      save: (name) => presetActionsRef.current.save(name),
      apply: (preset) => presetActionsRef.current.apply(preset),
      reset: () => presetActionsRef.current.reset(),
    });
    return () => registerPresetActions(null);
  }, []);

  if (!answered) {
    return <SafeAreaView className="flex-1 bg-background" />;
  }

  if (!ready) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text className="text-center text-lg font-semibold">
          Framevane needs the camera and microphone
        </Text>
        <Text className="text-center text-muted-foreground">
          Both are used only while you are broadcasting. Nothing is recorded on the phone unless you
          press Record.
        </Text>
        {blocked ? (
          <>
            <Text className="text-center text-muted-foreground">
              Android will not ask again from here. Turn Camera and Microphone on for Framevane
              under Permissions, then come back.
            </Text>
            <Button onPress={() => void Linking.openSettings()}>
              <Text>Open Android settings</Text>
            </Button>
          </>
        ) : (
          <Button
            onPress={async () => {
              await requestCamera();
              await requestMicrophone();
            }}
          >
            <Text>Allow</Text>
          </Button>
        )}
      </SafeAreaView>
    );
  }

  const canZoom = zoomRange.max > zoomRange.min;
  const canExpose = exposureRange.max > exposureRange.min;

  const whiteBalanceModes = capabilities?.whiteBalanceModes ?? [];
  const noiseReductionModes = capabilities?.noiseReductionModes ?? [];
  const antiFlickerModes = capabilities?.antiFlickerModes ?? [];
  /**
   * What the chip says. "Let Android choose" rather than a guess at which
   * microphone that turned out to be: the phone has not said, and inventing a
   * name here is how a screen comes to disagree with the sound going out.
   */
  const micLabel = shortAudioInput(audioInput);

  /**
   * What the picker offers, which is not everything the phone lists - see
   * offerableInputs. An input this app cannot name is one it will not put in
   * front of an operator about to teach.
   */
  const micChoices = offerableInputs(audioDevices);

  /** The usual microphone, if it is plugged in or paired right now. */
  const usualConnected = usualMic
    ? (micChoices.find(
        (device) => device.kind === usualMic.kind && device.name === usualMic.name,
      ) ?? null)
    : null;
  const onUsualMic = Boolean(usualConnected?.current);
  /**
   * Silence alone is not a reason to look twice. Most operators open the
   * check and press Go live without saying a word, and on the microphone they
   * always use that silence means nothing - so "Not hearing anything yet" was
   * an amber warning and the button said "Go live anyway" on nearly every
   * broadcast, which taught everyone to ignore both. It counts when there is
   * already a reason to doubt the input: muted, or not the usual one.
   */
  const micDoubtful = muted || (usualMic !== null && !onUsualMic);

  /**
   * The phone's own fitness to start, which the banners keep quiet about off
   * air - see preflightGuards.
   */
  const fitness = preflightGuards({
    thermal,
    usableBytes,
    battery: charge.level,
    charging: charge.charging,
    willRecord: recordOnStart,
  });
  const unfit = fitness.some((line) => line.tone === "bad");

  const rememberUsualMic = (device: AudioDevice) => {
    const next = { kind: device.kind, name: device.name };
    savePreferences({ usualMic: next });
    setUsualMic(next);
  };

  const toggleRecordOnStart = () => {
    const next = !recordOnStart;
    savePreferences({ recordWhileStreaming: next });
    setRecordOnStart(next);
  };

  const goLiveFromCheck = async () => {
    if (!connection) return;
    setPanel(null);
    await askForBroadcastNotification();
    beginCountdown(connection);
  };



  const closePanel = () => setPanel(null);
  const togglePanel = (id: Exclude<PanelId, null>) => setPanel(panel === id ? null : id);

  /**
   * Off air with nowhere to send it, the primary button goes and fetches the
   * missing piece rather than sitting there greyed out. A disabled button is a
   * dead end, and "no destination" is a question with one obvious answer.
   */

  /**
   * Recording first: with no destination chosen Framevane is a recorder, and
   * the big button records - Filmic's red disc, no words. Choosing a
   * destination is what switches streaming on, and then it is GO LIVE.
   */
  const primary = !connection
    ? recording
      ? {
          mode: "stop" as const,
          label: t("control.stopRecording"),
          icon: StopIcon,
          onPress: () => {
            tick();
            void toggleRecording();
          },
        }
      : {
          mode: "record" as const,
          label: t("control.record"),
          icon: RecordIcon,
          onPress: () => {
            tick();
            void toggleRecording();
          },
        }
    : counting !== null
      ? { mode: "stop" as const, label: t("primary.cancel"), icon: CloseIcon, onPress: cancelCountdown }
      : live
        ? { mode: "stop" as const, label: t("primary.end"), icon: StopIcon, onPress: confirmEnd }
        : state === "connecting"
          ? {
              mode: "stop" as const,
              label: t("primary.cancel"),
              icon: CloseIcon,
              // Pressed from a button with nobody awaiting it, so a stop that
              // throws has to be caught here or it is an unhandled rejection.
              onPress: () => {
                stop().catch((error: unknown) => {
                  pushLog({
                    at: Date.now(),
                    level: "warn",
                    message: `Cancelling the connection did not stop cleanly: ${
                      (error as Error)?.message ?? error
                    }`,
                  });
                });
              },
            }
          : {
              mode: "start" as const,
              label: t("primary.goLive"),
              icon: GoLiveIcon,
              // The check first; its own Go live starts the countdown.
              onPress: () => setPanel("preflight"),
            };

  /**
   * Four ways in, not one gear with tabs behind it.
   *
   * Larix's single gear is tidier, but it puts every camera control two taps
   * and a guess away, and the shape of the broadcast is the thing an operator
   * most often gets wrong in the last ten seconds before going live. Four
   * labelled discs cost one row and keep everything one tap from the
   * viewfinder, which is the rule this screen is held to.
   *
   * They stay the small size in both orientations. These are the controls
   * touched before going live rather than during, and a smaller target is how
   * that rank is shown without moving them off the glass.
   */

  /**
   * One description per optional control, used in both places it can appear.
   *
   * A control is either a disc on the glass or a row behind More, and which one
   * is the operator's choice - so the name, the glyph and the action are
   * written once here rather than twice, where the two copies would drift and
   * the same button would end up called different things in different places.
   */
  const CONTROL: Record<
    QuickControl,
    {
      icon: LucideIcon;
      label: string;
      hint: string;
      on?: boolean;
      tone?: "alert" | "warn";
      /** The label already names the state, so "selected" is not said on top. */
      labelCarriesState?: boolean;
      onPress: () => void;
    }
  > = {
    camera: {
      icon: CameraIcon,
      label: t("control.camera"),
      hint: t("control.cameraHint"),
      on: panel === "camera",
      onPress: () => togglePanel("camera"),
    },
    shape: {
      icon: ShapeIcon,
      label: t("control.shape"),
      hint: t("control.shapeHint"),
      on: settingsOpen && settingsOpenTo === "/settings/framing",
      // The light Framing page, as the framing ring opens.
      onPress: () => openSettings("/settings/framing"),
    },
    overlays: {
      // Offered whether or not this destination has a compositor behind it: an
      // operator wondering where the overlays went is owed the answer, and the
      // panel itself is the one line that explains it.
      icon: OverlayIcon,
      label: t("control.overlays"),
      hint: t("control.overlaysHint"),
      on: panel === "overlays",
      onPress: () => togglePanel("overlays"),
    },
    stats: {
      icon: StatsIcon,
      label: t("control.stats"),
      hint: t("control.statsHint"),
      on: panel === "stats",
      onPress: () => togglePanel("stats"),
    },
    log: {
      icon: LogIcon,
      label: t("control.log"),
      hint: t("control.logHint"),
      on: panel === "log",
      onPress: () => togglePanel("log"),
    },
    record: {
      // Named for what pressing it does, not for what it is. A row that still
      // says "Record" while a recording is running reads as the way to start
      // one, and the way to stop is then nowhere on the screen.
      icon: recording ? StopIcon : RecordIcon,
      label: recording ? t("control.stopRecording") : t("control.record"),
      hint: recording ? t("control.stopRecordingHint") : t("control.recordHint"),
      on: recording,
      tone: "alert",
      labelCarriesState: true,
      onPress: () => {
        tick();
        void toggleRecording();
      },
    },
    photo: {
      icon: PhotoIcon,
      label: t("control.photo"),
      hint: t("control.photoHint"),
      onPress: takePhoto,
    },
    pause: {
      // The one control whose glyph shows the next action rather than the
      // state, because that is what every transport control on earth does and
      // the frame already carries an amber border saying PAUSED.
      icon: paused ? ResumeIcon : PauseIcon,
      // The label names the state, like Mute: "Pause, selected" left a
      // listener to work out whether the broadcast was held.
      label: paused ? t("control.paused") : t("control.pause"),
      hint: t("control.pauseHint"),
      on: paused,
      labelCarriesState: true,
      tone: "warn",
      onPress: () => {
        // Viewers see the slate in the operator's language, read at the
        // moment of pausing so a language change since is honoured.
        if (!paused) setPauseSlate(t("slate.title"), t("slate.message"));
        void togglePause();
      },
    },
    flip: {
      icon: FlipIcon,
      label: t("control.flip"),
      hint: t("control.flipHint"),
      onPress: flipCamera,
    },
  };

  const onGlass = QUICK_CONTROLS.filter((id) => glass.includes(id));




  /** The rest, as rows with room for a label and a line of explanation. */
  const moreItems: MoreItem[] = [
    {
      icon: PresetIcon,
      label: "Presets",
      hint: presets.length > 0 ? `${presets.length} saved` : "Save this camera setup",
      // One place for presets, as Filmic has: the Presets page.
      onPress: () => openSettings("/settings/presets"),
    },
    {
      icon: GlobeIcon,
      label: t("control.destinations"),
      hint: connection?.name ?? t("control.nowhere"),
      onPress: () => router.push("/(tabs)/connections"),
    },
    ...QUICK_CONTROLS.filter((id) => !glass.includes(id) || id === "flip").map((id) => ({
      icon: CONTROL[id].icon,
      label: CONTROL[id].label,
      hint: CONTROL[id].hint,
      on: CONTROL[id].on,
      onPress: CONTROL[id].onPress,
    })),
  ];

  /** Mute, with the tick that says it took. Used by every mute on this screen. */
  const muteWithTick = () => {
    tick();
    void toggleMute();
  };



  /** What the leading column's badge says - Filmic's PRO spot, given to the air. */
  const badgeState: BroadcastState = !connection
    ? recording
      ? "live"
      : "offAir"
    : state === "reconnecting"
      ? "reconnecting"
      : paused
        ? "paused"
        : live
          ? "live"
          : state === "connecting" || counting !== null
            ? "connecting"
            : "offAir";
  const badgeLabel = !connection
    ? recording
      ? t("hud.rec")
      : t("hud.ready")
    : badgeState === "live"
      ? t("studio.live")
      : badgeState === "reconnecting"
        ? t("hud.reconnecting")
        : badgeState === "paused"
          ? t("hud.paused")
          : badgeState === "connecting"
            ? t("hud.connecting")
            : t("hud.offAir");

  /**
   * The operator's quick controls, on the picture's bottom corners in landscape.
   * Framing and the camera panel have fixed homes in the leading column, so
   * they are not repeated here; flip joins the torch on the left, as camera
   * things, and the rest go right.
   */
  // Flip and the torch are off the glass (owner, 25 Oct 2026): the lens is
  // chosen in Settings - Hardware, the torch is there too, and flip stays in
  // the drawer.
  const cornerIds = onGlass.filter((id) => id !== "camera" && id !== "shape" && id !== "flip");
  // With torch and flip gone the bottom-left corner is empty; the operator's
  // controls all sit bottom right.
  const leftCornerIds: QuickControl[] = [];
  // Pause is a live-stream control - it holds the picture behind a "be right
  // back" slate for viewers - so it appears only on air (or while still paused).
  const rightCornerIds = cornerIds.filter((id) => id !== "pause" || live || paused);
  const cornerDisc = (id: QuickControl) => {
    const control = CONTROL[id];
    return (
      <GlassDisc
        key={id}
        icon={control.icon}
        label={control.label}
        active={control.on}
        tone={control.tone === "alert" ? "alert" : "accent"}
        onPress={control.onPress}
      />
    );
  };

  /** Frames out and dropped, when something is going wrong while live. */
  const troubled = live && (congested || dropped > 0);
  const infoWarn = troubled || (charge.level <= CRITICAL_BATTERY && !charge.charging);

  /** What the camera is set to now, as a preset would keep it. */
  const presetSnapshot = (name: string): Omit<Preset, "id" | "createdAt"> => ({
    name,
    video: {
      width: connection?.width ?? 1280,
      height: connection?.height ?? 720,
      fps: connection?.fps ?? 30,
      codec: videoCodec,
    },
    exposure:
      exposureMode === "manual"
        ? { mode: "manual", iso: manualIso, exposureNs: manualExposureNs }
        : { mode: "auto", ev: exposure },
    whiteBalance:
      kelvin !== null ? { mode: "kelvin", kelvin, tint } : { mode: "preset", awb: whiteBalance },
  });

  /**
   * Apply a preset. The camera half lands at once; the picture size and frame
   * rate belong to the destination and only change off air, because a stream
   * cannot change shape mid-broadcast.
   */
  const applyPreset = (preset: Preset) => {
    if (preset.exposure.mode === "manual") {
      void setManualExposure(preset.exposure.iso, preset.exposure.exposureNs);
    } else {
      void setExposureMode("auto");
      void setExposure(preset.exposure.ev);
    }
    if (preset.whiteBalance.mode === "kelvin") {
      void setWhiteBalanceKelvin(preset.whiteBalance.kelvin, preset.whiteBalance.tint);
    } else {
      void setWhiteBalance(preset.whiteBalance.awb);
    }
    if (!live && connection) {
      const next = {
        ...connection,
        width: preset.video.width,
        height: preset.video.height,
        fps: preset.video.fps,
      };
      saveConnection(next);
      setConnection(next);
      saveSettings({ videoCodec: preset.video.codec as typeof videoCodec });
    }
    notify(live ? `${preset.name}: camera applied (picture size waits until off air)` : `${preset.name} applied`);
  };

  /** Filmic's Reset: the camera back to auto, the grade off, zoom out. */
  const resetCamera = () => {
    if (exposureMode === "manual") void setExposureMode("auto");
    if (exposureLocked) void setExposureLock(false);
    void setExposure(0);
    void setWhiteBalance(1);
    if (manualFocus) void resumeAutoFocus();
    setFocusHeld(false);
    setMeterMode("reticle");
    void setZoom(Math.max(1, zoomRange.min));
    changeGrade({ ...GRADE_DEFAULTS, luts: gradeRef.current.luts });
    notify("Camera reset to auto");
  };
  // Lent to the Presets page through a ref, so it always calls this render's.
  // The ref and its registration are hooks, declared above the permission
  // early returns; only the assignment is down here.
  presetActionsRef.current = {
    save: (name: string) => {
      savePreset(presetSnapshot(name));
      notify(`Saved "${name}"`);
    },
    apply: applyPreset,
    reset: resetCamera,
  };
  const panelBody =
    // The colour panel is hosted on its own, beside the leading column.
    panel === null || panel === "image" || panel === "presets" ? null : panel === "log" ? (
      <LiveLogPanel onClose={closePanel} />
    ) : panel === "camera" ? (
      <Panel title="Camera" onClose={closePanel}>
        {cameras.length === 0 ? (
          <Text className="text-sm text-white/70">The phone has not reported its cameras.</Text>
        ) : (
          cameras.map((entry) => (
            <Row
              key={entry.id}
              label={describeCamera(entry)}
              selected={entry.current}
              onPress={() => selectCamera(entry.id)}
            />
          ))
        )}
        <Text className="text-xs text-white/70">
          A camera plugged in over USB appears here on its own.
        </Text>

        {capabilities?.available ? (
          <>
            <Toggle
              label="Auto focus"
              hint={
                autoFocus ? "Tap the picture to focus somewhere else" : "Focus is held where you tapped"
              }
              on={autoFocus}
              onPress={() => setAutoFocus(!autoFocus)}
            />

            {canZoom ? (
              /* An action, so it says what it does. It read "Zoom · 2.4x" and
                 reset the zoom on a tap with nothing on screen saying it would. */
              <Row
                label={`Reset zoom to ${zoomRange.min.toFixed(1)}×`}
                hint={`Now ${zoom.toFixed(1)}× · pinch to zoom`}
                selected={false}
                onPress={() => setZoom(zoomRange.min)}
              />
            ) : null}

            {canExpose ? (
              <Stepper
                label="Exposure"
                value={exposure}
                min={exposureRange.min}
                max={exposureRange.max}
                evStep={exposureRange.evStep}
                locked={exposureLocked}
                canLock={exposureRange.lockAvailable}
                onChange={setExposure}
                onLock={setExposureLock}
              />
            ) : null}

            {/* Offered because the camera has it; on or off because the camera
                says it is. */}
            {capabilities.stabilization ? (
              <Toggle
                label="Stabilisation"
                hint="Steadier handheld, a slightly tighter picture"
                on={stabilization}
                onPress={() => setStabilization(!stabilization)}
              />
            ) : null}

            {/* Only worth a list when the camera has more than auto to offer;
                one entry is a control that does nothing. */}
            {whiteBalanceModes.length > 1 ? (
              <>
                <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                  White balance
                </Text>
                {whiteBalanceModes.map((mode) => (
                  <Row
                    key={mode}
                    label={describeWhiteBalance(mode)}
                    selected={whiteBalance === mode}
                    onPress={() => setWhiteBalance(mode)}
                  />
                ))}
              </>
            ) : null}

            {/* Same rule: a lens reporting one mode has no choice to offer. */}
            {antiFlickerModes.length > 1 ? (
              <>
                <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                  Anti-flicker
                </Text>
                {antiFlickerModes.map((mode) => (
                  <Row
                    key={mode}
                    label={describeAntiFlicker(mode)}
                    selected={antiFlicker === mode}
                    onPress={() => setAntiFlicker(mode)}
                  />
                ))}
                <Text className="pb-1 text-xs text-white/70">
                  Mains lighting flickers at twice the supply frequency, and a sensor out of step
                  with it bands the picture. It cannot be fixed afterwards.
                </Text>
              </>
            ) : null}

            {noiseReductionModes.length > 1 ? (
              <>
                <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                  Noise reduction
                </Text>
                {noiseReductionModes.map((mode) => (
                  <Row
                    key={mode}
                    label={describeNoiseReduction(mode)}
                    selected={noiseReduction === mode}
                    onPress={() => setNoiseReduction(mode)}
                  />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <Text className="text-xs text-white/70">
            The camera's own controls appear once it is open.
          </Text>
        )}
      </Panel>
    ) : panel === "overlays" ? (
      <OverlaysPanel connection={connection} onClose={closePanel} />
    ) : panel === "mic" ? (
      <Panel title="Where the sound comes from" onClose={closePanel}>
        <Row
          label="Let Android choose"
          selected={audioDevices.every((device) => !device.current)}
          onPress={() => void selectAudioInput(-1)}
        />
        {micChoices.map((device) => (
          <Row
            key={device.id}
            label={
              pendingMic === device.id && !device.current
                ? `${describeAudioInput(device)} - connecting…`
                : describeAudioInput(device)
            }
            selected={device.current}
            onPress={() => {
              setPendingMic(device.id);
              void selectAudioInput(device.id);
            }}
          />
        ))}
        {micChoices.length === 0 ? (
          <Text className="pt-1 text-xs text-white/70">
            Nothing to list. The microphone has not been opened yet.
          </Text>
        ) : null}
        {/*
          Said here rather than discovered mid-lesson. Moving a live recording
          to another microphone is Android's decision, not this app's: it will
          do it for the phone's own inputs and it will not stop a broadcast to
          do it for a headset, whose audio link has to be built first.
        */}
        <Text className="pt-1 text-xs text-white/70">
          {live || recording
            ? "While this is running the phone may refuse to move - a refusal is kept and used from the next broadcast."
            : "Changes now. A Bluetooth headset takes a few seconds to answer, and the meter keeps reading the old microphone until it does."}
        </Text>
      </Panel>
    ) : panel === "preflight" && connection ? (
      <Panel
        title={t("preflight.title")}
        tall
        onClose={closePanel}
        footer={
          /*
            Never a wall, and never out of reach. Every warning above can be
            exactly what the operator wants tonight - a borrowed microphone, a
            deliberate 360p - so the button changes its word rather than
            refusing. Pinned below the checks so it is in view without a
            scroll, however many of them there are.
          */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={micDoubtful || unfit ? t("preflight.goLiveAnyway") : t("preflight.goLive")}
            onPress={goLiveFromCheck}
            className="items-center rounded-xl bg-red-600 py-3"
          >
            <Text className="text-base font-semibold text-white">
              {micDoubtful || unfit ? t("preflight.goLiveAnyway") : t("preflight.goLive")}
            </Text>
          </Pressable>
        }
      >
        {/* The microphone first: it is the mistake that reached the air. */}
        <Text style={textDir()} className="text-xs font-semibold uppercase tracking-wide text-white/70">
          {t("preflight.microphone")}
        </Text>
        <Text style={textDir()} className="text-sm text-white">
          {inputInUse ? describeAudioInput(inputInUse) : t("preflight.androidMic")}
        </Text>

        {muted ? (
          <>
            <CheckLine tone="warn">{t("preflight.muted")}</CheckLine>
            <Row label={t("preflight.unmute")} selected={false} onPress={muteWithTick} />
          </>
        ) : null}

        {usualMic ? (
          onUsualMic ? (
            <CheckLine tone="ok">{t("preflight.usual")}</CheckLine>
          ) : usualConnected ? (
            <>
              <CheckLine tone="warn">{t("preflight.usualConnected", { name: usualMic.name })}</CheckLine>
              <Row
                label={t("preflight.switchTo", { name: usualMic.name })}
                selected={false}
                onPress={() => void selectAudioInput(usualConnected.id)}
              />
            </>
          ) : (
            <CheckLine tone="warn">{t("preflight.usualMissing", { name: usualMic.name })}</CheckLine>
          )
        ) : (
          <Text style={textDir()} className="text-xs text-white/70">
            {t("preflight.tellUsual")}
          </Text>
        )}

        {inputInUse && !onUsualMic ? (
          <Row
            label={usualMic ? t("preflight.makeUsualInstead") : t("preflight.makeUsual")}
            selected={false}
            onPress={() => rememberUsualMic(inputInUse)}
          />
        ) : null}

        {heard ? (
          <CheckLine tone="ok">{t("preflight.heard")}</CheckLine>
        ) : (
          <CheckLine tone={micDoubtful ? "warn" : "info"}>{t("preflight.notHeard")}</CheckLine>
        )}

        {/* The phone, before the picture: a phone too hot or too flat to last
            the class is the one thing here that no setting below can fix. */}
        {fitness.length > 0 ? (
          <>
            <Text
              style={textDir()}
              className="pt-2 text-xs font-semibold uppercase tracking-wide text-white/70"
            >
              {t("preflight.thisPhone")}
            </Text>
            {fitness.map((line) => (
              <CheckLine key={`${line.id}:${line.tone}`} tone={line.tone === "bad" ? "bad" : "warn"}>
                {line.text}
              </CheckLine>
            ))}
          </>
        ) : null}

        <Text style={textDir()} className="pt-2 text-xs font-semibold uppercase tracking-wide text-white/70">
          {t("preflight.goingOut")}
        </Text>
        {/* Directed by the destination's name, not by the language: it is the
            one part of the line somebody typed, and an Arabic name is what
            otherwise lands with its punctuation at the wrong end. */}
        <Text style={bidi(connection.name) ?? textDir()} className="text-sm text-white">
          {t("preflight.picture", {
            height: connection.height,
            fps: connection.fps,
            rate: formatKbps(connection.videoBitrate),
            name: connection.name,
          })}
        </Text>
        <Row
          label={t("preflight.changePicture")}
          selected={false}
          onPress={() => {
            setPanel(null);
            router.push("/(tabs)/connections");
          }}
        />

        <Text style={textDir()} className="pt-2 text-xs font-semibold uppercase tracking-wide text-white/70">
          {t("preflight.copy")}
        </Text>
        <Toggle
          label={t("preflight.recordToo")}
          hint={
            recordOnStart
              ? t("preflight.recordOn", {
                  quality:
                    recordQualityFor(recordHeight).height === 0
                      ? t("preflight.sameAsBroadcast", { height: connection.height })
                      : recordQualityFor(recordHeight).label,
                })
              : t("preflight.recordOff")
          }
          on={recordOnStart}
          onPress={toggleRecordOnStart}
        />
        {/*
          A different size is a second video encoder. The recording and the
          stream are encoded separately whenever their sizes differ, and two
          encoders plus the camera are what heat a phone until it throttles -
          at which point the whole app slows, the controls included. Said here
          because it is a choice made once in Settings and then forgotten.
        */}
        {recordOnStart &&
        recordQualityFor(recordHeight).height !== 0 &&
        recordQualityFor(recordHeight).height !== connection.height ? (
          <CheckLine tone="warn">
            {t("preflight.secondEncoder", {
              quality: recordQualityFor(recordHeight).label,
              height: connection.height,
            })}
          </CheckLine>
        ) : null}
        {recordOnStart ? (
          <Row
            label={t("preflight.changeRecording")}
            selected={false}
            onPress={() => {
              setPanel(null);
              router.push("/(tabs)/settings");
            }}
          />
        ) : null}

      </Panel>
    ) : panel === "shape" ? (
      <Panel title="Shape of the broadcast" onClose={closePanel}>
        {(["auto", "portrait", "landscape"] as Orientation[]).map((mode) => (
          <Row
            key={mode}
            label={
              mode === "auto"
                ? "However the phone is held"
                : mode === "portrait"
                  ? "Portrait - tall"
                  : "Landscape - wide"
            }
            selected={orientation === mode}
            onPress={() => setOrientation(mode)}
          />
        ))}
        <Toggle label="Thirds" on={guides.thirds} onPress={() => toggleGuide("thirds")} />
        <Toggle label="Centre cross" on={guides.centre} onPress={() => toggleGuide("centre")} />
        <Toggle
          label="4:3 safe area"
          hint="What a 4:3 crop keeps"
          on={guides.safe43}
          onPress={() => toggleGuide("safe43")}
        />
        <Toggle
          label="1:1 safe area"
          hint="What a square crop keeps"
          on={guides.safe11}
          onPress={() => toggleGuide("safe11")}
        />
        <Text className="pt-1 text-xs text-white/70">
          Set this before going live. A stream that changes shape halfway through gets letterboxed by
          every platform downstream.
        </Text>
      </Panel>
    ) : (
      <EncoderStatsPanel live={live} onClose={closePanel} />
    );

  /**
   * Analytics never just does nothing: a panel over the picture is closed
   * first (the strip cannot show under one), and the strip always opens - on
   * air or held by the heat ladder it opens greyed and says why.
   */
  /**
   * Changing mode hands the camera to whatever the mode means: Reticle and
   * Center Weight give focus and metering back to the camera (the pucks then
   * steer them again), Manual starts the tapes from what the sensor is doing
   * now so the picture does not jump.
   */
  const chooseMeterMode = (mode: MeteringMode) => {
    setMeterMode(mode);
    if (mode === "manual") {
      if (capabilities?.manualSensor) void setExposureMode("manual");
      if ((capabilities?.focusNear ?? 0) > 0) void setFocusDistance(focusDistance);
      return;
    }
    exposurePoint.current = null;
    setFocusHeld(false);
    if (exposureMode === "manual") void setExposureMode("auto");
    if (manualFocus) void resumeAutoFocus();
    if (mode === "center" && exposureLocked) void setExposureLock(false);
  };
  const manualAxes = availableAxes(
    !!(capabilities?.manualSensor && capabilities.isoRange && capabilities.exposureTimeRange),
    zoomRange.max > zoomRange.min,
  );
  // A lens that cannot do the chosen axis falls back to the first it can.
  const manualAxisShown: Axis = manualAxes.some((a) => a.axis === manualAxis)
    ? manualAxis
    : (manualAxes[0]?.axis ?? "z");
  /**
   * Done on Manual, as Filmic does it: a tap on the picture closes the rulers
   * and brings the reticles back, locked on what was set - the ISO and shutter
   * and the focus distance stay exactly as they are. Tapping a locked puck
   * then hands that one back to the camera.
   */
  const finishManual = () => {
    setMeterBarOpen(false);
    setMeterMode("reticle");
    if (manualFocus) setFocusHeld(true);
  };
  /** Unlocking the exposure puck ends a manual exposure as well as a lock. */
  const onReticleExposureLock = (on: boolean) => {
    if (!on && exposureMode === "manual") {
      void setExposureMode("auto");
      if (exposureLocked) void setExposureLock(false);
      return;
    }
    void setExposureLock(on);
  };
  /** And the focus puck: unlocked, a held distance goes back to auto focus. */
  const onReticleFocusLock = (on: boolean) => {
    setFocusHeld(on);
    if (!on && manualFocus) void resumeAutoFocus();
  };
  const meterRing = (size?: number) => (
    <RingButton
      icon={METERING_ICON[meterMode] as unknown as LucideIcon}
      size={size}
      label={meterMode === "reticle" ? "Reticle" : meterMode === "center" ? "Center Weight" : "Manual"}
      active={meterBarOpen}
      tone="accent"
      onPress={() => {
        setPanel(null);
        setMeterBarOpen((open) => !open);
      }}
    />
  );

  const toggleAnalytics = () => {
    setPanel(null);
    setAnalyticsOpen((open) => !open);
  };

  const openSettings = (to: string | null = null) => {
    setSettingsOpenTo(to);
    setSettingsOpen(true);
  };
  /**
   * Closing the panel is this screen's "coming back": it never lost focus, so
   * re-read what the panel may have changed - the destination, the viewfinder
   * preferences, the language.
   */
  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsOpenTo(null);
    setConnection(activeConnection());
    const prefs = loadPreferences();
    setGlass(prefs.quickAccess);
    setViewPrefs(viewPrefsOf(prefs));
    setLanguage(applyLanguagePreference());
  };

  /** Where this is going: opens Destinations in the settings panel. */
  const drawerPill = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("control.destinations")}
      accessibilityHint={connection?.name ?? t("destination.choose")}
      onPress={() => openSettings("/(tabs)/connections")}
      // The drawer is the readout strip's tap; holding the pill reaches it
      // too, for when the strip is switched off or hidden by the heat ladder.
      onLongPress={() => setMoreOpen(true)}
      hitSlop={8}
      className="max-w-full flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-60"
      style={{ backgroundColor: "rgba(10,10,12,0.55)" }}
    >
      <DrawerIcon className="h-5 w-5 text-filmic-ink" />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={HUD_TEXT}
        style={connection ? bidi(connection.name) : textDir()}
        className="shrink text-xs text-filmic-ink"
      >
        {connection?.name ?? t("destination.recordOnly")}
      </Text>
    </Pressable>
  );

  /** Filmic's line of numbers along the top of the picture; tapping it opens the drawer. */
  const readoutStrip = !viewPrefs.readoutStrip || ladder.minimal ? null : (
    <ReadoutStrip
      zoom={zoom}
      exposure={exposure}
      evStep={exposureRange.evStep}
      exposureLocked={exposureLocked}
      whiteBalance={shortWhiteBalance(whiteBalance)}
      codec={videoCodec}
      resolution={connection ? `${connection.height}p` : null}
      fps={connection?.fps ?? null}
      live={live}
      onPress={() => setMoreOpen(true)}
    />
  );

  /** Mic: tap mutes, holding opens the input list (chosen beforehand, not mid-shot). */
  const micControl = (
    <View pointerEvents="box-none" className="items-center gap-1">
      <RingButton
        icon={muted ? MicOffIcon : MicIcon}
        label={muted ? t("control.muted") : t("control.mute")}
        active={muted}
        tone="alert"
        onPress={muteWithTick}
        onLongPress={micChoices.length > 0 ? () => togglePanel("mic") : undefined}
      />
      {micChoices.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mic.chipA11y", {
            name: audioInput ? describeAudioInput(audioInput) : t("mic.androidChoice"),
          })}
          accessibilityState={{ expanded: panel === "mic" }}
          onPress={() => togglePanel("mic")}
          hitSlop={6}
          className="max-w-[104px] px-1 py-0.5 active:opacity-60"
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={HUD_TEXT}
            className={`text-[10px] ${panel === "mic" ? "text-filmic-accent" : "text-filmic-inkmuted"}`}
          >
            {micLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-black" onTouchStart={touched}>
      <BroadcasterView
        style={FILL}
        onStatus={onStatus}
        onBitrate={onBitrate}
        onStats={onStats}
        onExposureState={onExposureState}
        onLevel={onLevel}
        onCameras={onCameras}
        onAudioDevices={onAudioDevices}
        onRecord={onRecord}
        onAudioInterrupted={onAudioInterrupted}
        onThermal={onThermal}
        onLog={onLog}
      />

      {/* Between the picture and the chrome, so pinch and tap reach the camera
          while every button drawn after this still takes its own press. The
          overlays that follow are all box-none, so the picture keeps the whole
          frame apart from the discs themselves. */}
      <TouchLayer
        canZoom={canZoom}
        /* Focus now lives on the draggable focus reticle below; the touch
           layer keeps only pinch-to-zoom so the two never fight over a drag. */
        canFocus={false}
        zoom={zoom}
        range={zoomRange}
        onZoom={setZoom}
        onFocus={focusAt}
      />

      {/* The persistent Filmic reticles - focus and exposure pucks that stay on
          the picture and are dragged to place each measurement. Drawn after the
          touch layer so a puck takes its own drag rather than the picture
          reading it as a pinch. Hidden while a panel covers the shot. */}
      {panel === null && meterMode === "center" ? <CenterWeightOverlay insets={reticleInsets} /> : null}
      {panel === null && meterMode === "manual" ? (
        <ManualControls
          insets={reticleInsets}
          axis={manualAxisShown}
          onAxis={setManualAxis}
          wheelInline={!wide}
          onDone={finishManual}
          fps={connection?.fps ?? 30}
          isoRange={capabilities?.manualSensor ? (capabilities?.isoRange ?? null) : null}
          exposureTimeRange={capabilities?.manualSensor ? (capabilities?.exposureTimeRange ?? null) : null}
          iso={manualIso}
          exposureNs={manualExposureNs}
          onManualExposure={setManualExposure}
          focusNear={capabilities?.focusNear ?? 0}
          focusDistance={focusDistance}
          onFocusDistance={setFocusDistance}
          zoom={zoom}
          zoomRange={zoomRange}
          onZoom={setZoom}
        />
      ) : null}
      {panel === null && meterMode === "reticle" && (capabilities?.available ?? false) ? (
        <View pointerEvents="box-none" className="absolute inset-0">
          <Reticles
            canFocus={capabilities?.available ?? false}
            canExpose={canExpose}
            insets={reticleInsets}
            exposureLocked={exposureLocked || exposureMode === "manual"}
            focusLocked={focusHeld || manualFocus}
            onFocusLock={onReticleFocusLock}
            onFocus={focusAt}
            onExposurePoint={onExposurePoint}
            onExposureLock={onReticleExposureLock}
          />
        </View>
      ) : null}

      {panel === null && !ladder.minimal ? (
        <FramingGuides guides={guides} insets={reticleInsets} />
      ) : null}

      {/* One full-frame state at a time, most urgent first: a reconnect is
          news even while paused, and a broadcast that has gone off air is no
          longer paused in any sense that matters to viewers. */}
      {state === "reconnecting" ? (
        <LiveReconnectingOverlay />
      ) : lostAir && !live && panel === null ? (
        <OffAirOverlay />
      ) : paused ? (
        <PausedOverlay live={live} seconds={pausedAt} />
      ) : null}

      {/* Centred on the picture, and a child of the screen rather than of the
          head-up bar.
          It was nested inside that bar, so `inset-0` resolved against a strip a
          few tiles tall: the count sat at the top of the frame with its circle
          cut off by the edge. In landscape it centres on the picture rather
          than the screen, because the panel down the trailing edge is not part
          of the shot. */}
      {counting !== null ? (
        <View
          pointerEvents="none"
          className="absolute inset-y-0 items-center justify-center"
          style={{ left: wide ? lead : 0, right: wide ? trail : 0 }}
        >
          <View className="h-28 w-28 items-center justify-center rounded-full border border-filmic-line bg-filmic-surface/80">
            <Mono className="text-6xl font-bold text-white">{counting}</Mono>
          </View>
          <Text
            maxFontSizeMultiplier={HUD_TEXT}
            style={textDir()}
            className="pt-3 text-sm font-medium text-white/90"
          >
            {t("hud.goingLive")}
          </Text>
        </View>
      ) : null}

      {/* The head-up display: what is happening, in the corners, out of the
          middle of the frame where a face goes. Kept to one shallow band
          because the root layout drops its update prompt into this space. */}
      <SafeAreaView
        pointerEvents="box-none"
        edges={["top", "left", "right"]}
        className="absolute inset-x-0 top-0"
      >

      <View
          pointerEvents="box-none"
          className="gap-1.5 px-3 pt-1.5"
          style={
            wide
              ? { marginLeft: lead + 64, marginRight: trail + 64, marginTop: 96 }
              : { marginTop: topBar + 32 }
          }
        >
          {/*
            One banner, the worst - see lib/broadcast/banners.ts for the order
            and why. Each used to draw on its own, so a stall arrived with the
            microphone banner and the heat guard under it and the face being
            filmed disappeared behind three boxes.
          */}
          {shownBanner === "failure" ? (
            /*
              The failure banner, and the broadcast that went off air on its
              own.

              `disconnected` is not enough to go on by itself: it is also what
              the encoder says a moment after the operator presses End.
              `lostAir` is the hook's word for the other case - it was live,
              nobody ended it, and it is not coming back - which is the one
              that used to leave nothing but a small Off air chip behind.

              The reason is said in plain words (lib/broadcast/failure.ts). The
              encoder's own - a Java exception, quoted whole - is in the log,
              one press away on the outlined button.

              Trying again goes through the check, exactly as the shutter does,
              so a broadcast restarted in a hurry still gets the microphone and
              picture looked at and the countdown to step back from.
            */
            <Banner
              tone="bad"
              text={
                state === "authError"
                  ? t("failure.auth")
                  : lostAir
                    ? `${t("banner.offAir")}${detail ? ` ${plainFailure(detail)}` : ""}`
                    : plainFailure(detail)
              }
              action={
                connection && counting === null && !live && state !== "connecting"
                  ? {
                      label: lostAir ? t("banner.goLiveAgain") : t("banner.tryAgain"),
                      onPress: () => setPanel("preflight"),
                    }
                  : undefined
              }
              secondary={{ label: t("common.openLog"), onPress: () => setPanel("log") }}
              onDismiss={lostAir ? dismissLostAir : undefined}
            />
          ) : shownBanner === "stall" ? (
            <Banner
              tone="bad"
              text={t("banner.stall")}
              action={
                connection
                  ? { label: t("banner.restart"), onPress: () => void restart(connection) }
                  : undefined
              }
            />
          ) : shownBanner === "micSilence" && micSilence ? (
            /*
              Below a stall, because it is the same class of fault - something
              has stopped going out - and unlike congestion there is nothing the
              app can do about it on its own.

              The action depends on where the microphone is: off air it can be
              reopened, and live it cannot without the risk of coming back
              silent, so the offer there is the connection restart that the
              stall banner already uses and that has been exercised on every bad
              network this app has seen.
            */
            <Banner
              tone="bad"
              text={
                micSilence.reason === "call"
                  ? t("banner.micCall")
                  : micSilence.reason === "headset"
                    ? t("banner.micHeadset")
                    : micSilence.reason === "taken"
                      ? t("banner.micTaken")
                      : t("banner.micSilent")
              }
              action={
                live
                  ? connection
                    ? { label: t("banner.restart"), onPress: () => void restart(connection) }
                    : undefined
                  : { label: t("banner.reopenMic"), onPress: () => void restoreMicrophone() }
              }
            />
          ) : shownBanner === "guard" && shownGuard ? (
            /*
              The phone's own state, which is the only banner here that can be
              true while the broadcast is perfectly healthy - and the only one
              that says what the app is about to do by itself.
            */
            <Banner
              tone={shownGuard.tone}
              text={shownGuard.text}
              /* Not the ones that say the app is about to act: those are a
                 sentence the operator has to be able to read afterwards. */
              onDismiss={
                shownGuard.action
                  ? undefined
                  : () => setDismissed(`${shownGuard.id}:${shownGuard.tone}`)
              }
            />
          ) : shownBanner === "congestion" ? (
            <Banner
              tone="warn"
              text={t("banner.congestion")}
            />
          ) : null}

          {/* In the same column, under the banner, so the two can never be
              drawn over each other. It only appears off air. */}
          <UpdateCard />
        </View>
      </SafeAreaView>

      {/* The level meter lives on the leading edge in both orientations, which
          is the edge the controls are never on - readable out of the corner of
          an eye while the operator is doing something else. It is a readout and
          nothing more: it used to mute the broadcast when tapped, which is a
          trap to put under a hand that is holding the phone. */}
      {/*
        The rails sit beside the meter on the same edge, and take their own
        touches - so this wrapper cannot be `pointerEvents="none"` the way the
        meter alone was. `box-none` lets the picture keep everything that is
        not a control.
      */}
      {/*
        Centred down the edge rather than anchored at a percentage of it.
        
        A fraction of the way down is fine for a meter, which is one fixed
        height. It is wrong for a panel that grows when a rail opens: the focus
        rail ran off the bottom of the screen and took its own AF button with
        it. Pinned top and bottom with the content centred, the panel grows
        into the space either side of the middle and cannot walk off an edge.
      */}
      {!wide ? (
      <View
        pointerEvents="box-none"
        className="absolute inset-y-0 left-3 flex-row items-center justify-center gap-2"
      >
        {/* box-none, not none: the gain bar on the meter takes a drag. */}
        <View pointerEvents="box-none" className="items-start">
          <Meter muted={muted} maxFps={ladder.levelMeterFps} />
        </View>


      </View>
      ) : null}

      {/* Analytics - peaking, zebras, false colour - in a small strip that opens
          from its button, as Filmic keeps them: there when wanted, not parked
          over the shot. Cleared and disabled on air - a focusing help, not
          something that goes out. */}
      {analyticsOpen && panel === null ? (
        <View
          pointerEvents="box-none"
          style={
            wide
              ? { position: "absolute", top: 72, right: trail + 84 }
              : { position: "absolute", top: topBar + 36, right: 12 }
          }
        >
          <MonitoringSelector
            value={monitor}
            onChange={applyMonitor}
            disabled={live || aidsHeld}
            reason={live ? "off on air" : "paused - phone is warm"}
          />
        </View>
      ) : null}

      {/* While an analytics aid recolours the picture, say so in words: a
          picture gone flat purple or striped must never read as a fault mid-class. */}
      {monitor !== "off" && panel === null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: wide ? 128 : topBar + 36,
            left: wide ? lead : 0,
            right: wide ? trail : 0,
            alignItems: "center",
          }}
        >
          <View className="rounded-full border border-filmic-accent px-3 py-1" style={{ backgroundColor: "rgba(10,10,12,0.7)" }}>
            <Text maxFontSizeMultiplier={HUD_TEXT} className="text-[10px] font-semibold uppercase tracking-widest text-filmic-accent">
              {AID_ON[monitor]}
            </Text>
          </View>
        </View>
      ) : null}

      {/* In landscape a panel is a sheet down the leading side: dropping it at
          the bottom of the frame as portrait does would leave it two lines
          tall, and putting it in the middle would cover the shot. It clears the
          level meter on its left and the control column on its right. */}
      {/* Landscape panels sit in the clear band of the picture: below the
          readout strip and destination pill, above the info panel and the
          corner discs, and between the top discs - so nothing on the glass is
          drawn over it or under it. Centred and capped in width, as Filmic's
          panels are, rather than a sheet across the whole frame. */}
      {/* Filmic's colour panel: light, beside the leading column, a rail of
          tabs down its left edge. White balance is the tab there is today. */}
      {/* Outside the colour panel closes it, as Filmic's does: the first tap
          anywhere else - a button included - only closes the panel. */}
      {panel === "image" ? (
        <Pressable
          accessibilityLabel="Close the colour panel"
          onPress={closePanel}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 }}
        />
      ) : null}
      {panel === "image" ? (
        <View
          style={[
            COLOR_PANEL,
            wide
              ? { left: lead + 6, top: 54, bottom: 26, width: Math.min(600, width - lead - trail - 120) }
              : { left: 12, right: 12, top: topBar + 12, height: 360 },
          ]}
        >
          <View style={{ width: 62, backgroundColor: "#D6D6D8" }}>
            {COLOR_TABS.filter((tab) => tab.id === "wb" || hasColorGrade()).map((tab) => {
              const on = colorTab === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={tab.label}
                  onPress={() => setColorTab(tab.id)}
                  className="active:opacity-60"
                  style={{
                    flex: 1,
                    maxHeight: 84,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: on ? "#EEEEEE" : "transparent",
                  }}
                >
                  {tab.id === "lut" ? (
                    <Text style={{ fontSize: 22, fontWeight: "300", color: on ? "#1C1C1E" : "#6B6B70" }}>LUT</Text>
                  ) : (
                    <tab.Icon size={28} color={on ? "#1C1C1E" : "#6B6B70"} strokeWidth={1.5} />
                  )}
                </Pressable>
              );
            })}
          </View>
          {colorTab === "looks" ? (
            <LooksTab state={grade} onChange={changeGrade} />
          ) : colorTab === "gamma" ? (
            <GammaTab state={grade} onChange={changeGrade} />
          ) : colorTab === "lut" ? (
            <LutTab state={grade} onChange={changeGrade} />
          ) : (
          <ColorPanel
            manualWhiteBalance={capabilities?.manualWhiteBalance ?? false}
            whiteBalanceModes={whiteBalanceModes}
            whiteBalance={kelvin !== null ? -1 : whiteBalance}
            onWhiteBalance={setWhiteBalance}
            kelvin={kelvin}
            tint={tint}
            sensorKelvin={5500}
            onKelvin={setWhiteBalanceKelvin}
            slots={wbSlots}
            onSaveSlot={(slot, value) => {
              const saved = savePreferences(slot === "a" ? { wbSlotA: value } : { wbSlotB: value });
              setWbSlots({ a: saved.wbSlotA, b: saved.wbSlotB });
              notify(`Saved to ${slot.toUpperCase()}`);
            }}
          />
          )}
        </View>
      ) : null}

      {wide && panelBody ? (
        <View
          pointerEvents="box-none"
          className="absolute items-center justify-center"
          style={{ top: PANEL_BAND_TOP, bottom: PANEL_BAND_BOTTOM, left: lead + 76, right: trail + 76 }}
        >
          <View pointerEvents="box-none" style={{ width: "100%", maxWidth: 520, maxHeight: "100%" }}>
            {panelBody}
          </View>
        </View>
      ) : null}

      {/* In landscape the one-line notice goes across the picture rather than
          into the control column, where 160px would break "Photo saved to the
          camera roll" over four lines. */}
      {wide ? (
        <View
          pointerEvents="none"
          className="absolute"
          style={{ bottom: 86, left: lead, width: width - trail - lead }}
        >
          {ladder.quietHud ? null : <Notice text={notice.text} at={notice.at} tone={notice.tone} />}
        </View>
      ) : null}

      {wide ? (
        /* Landscape, laid out the way Filmic Pro lays it out: two black columns
           in the letterbox either side of the picture, a few discs on the
           picture itself - one job per corner - and the info panel along the
           bottom edge. What is set up rather than reached for mid-shot is one
           tap away behind the drawer at the top. */
        <>
          {/* Leading column: framing, the broadcast state where Filmic shows
              PRO, and the colour diamond for the image settings. */}
          {/* No left inset: Filmic's column hugs the screen edge whatever the
              cutout does, and an inset pushed the diamond out into the picture. */}
          <SafeAreaView
            pointerEvents="box-none"
            edges={["top", "bottom"]}
            className="absolute bottom-0 left-0 top-0 bg-filmic-base"
            onLayout={(e) => setLead(Math.round(e.nativeEvent.layout.width))}
          >
            <View
              pointerEvents="box-none"
              className="h-full items-center justify-between py-3"
              style={{ width: LEFT_COLUMN }}
            >
              <View pointerEvents="box-none" className="items-center gap-3">
                {meterRing()}
                <StatusBadge state={badgeState} label={badgeLabel} />
              </View>
              {/* Manual's LV / ISO / S / Z wheel, at mid-height in line with the
                  ruler's index - here, in the column, because the column is
                  drawn over the picture layer the rulers live in. */}
              {meterMode === "manual" && panel === null && manualAxes.length > 0 ? (
                <AxisWheel
                  axes={manualAxes}
                  axis={manualAxisShown}
                  onAxis={setManualAxis}
                  left={0}
                  width={LEFT_COLUMN}
                />
              ) : null}
              {/* Up off the bottom edge, where Filmic keeps it. */}
              <View style={{ marginBottom: 44 }}>
                <ColorDiamond
                  label="Image"
                  active={panel === "image"}
                  onPress={() => togglePanel("image")}
                />
              </View>
            </View>
          </SafeAreaView>

          {/* Trailing column: the microphone and its meter, and the shutter low
              where the thumb already is when the phone is held to frame. */}
          <SafeAreaView
            pointerEvents="box-none"
            edges={["top", "right", "bottom"]}
            className="absolute bottom-0 right-0 top-0 bg-filmic-base"
            onLayout={(e) => setTrail(Math.round(e.nativeEvent.layout.width))}
          >
            <View
              pointerEvents="box-none"
              className="h-full items-center justify-between py-3"
              style={{ width: COLUMN }}
            >
              {micControl}

              {/* box-none, not none: the gain bar on the meter takes a drag. */}
              <View pointerEvents="box-none" className="flex-1 items-center justify-center py-2">
                <Meter muted={muted} maxFps={ladder.levelMeterFps} />
              </View>

              <ShutterButton label={primary.label} mode={primary.mode} onPress={primary.onPress} />
            </View>
          </SafeAreaView>

          {/* On the picture: the corners, the zoom rocker and the bottom edge. */}
          <View
            pointerEvents="box-none"
            className="absolute bottom-0 top-0"
            style={{ left: lead, right: trail }}
          >
            <SafeAreaView pointerEvents="box-none" edges={["top", "bottom"]} className="flex-1">
              <View pointerEvents="box-none" className="flex-1">
                <View
                  pointerEvents="box-none"
                  className="flex-row items-start justify-between px-3 pt-3"
                >
                  <View pointerEvents="box-none" className="items-start gap-2">
                    <GlassDisc
                      icon={SettingsIcon}
                      label={t("control.settings")}
                      onPress={() => openSettings()}
                    />
                    {live ? <LiveStudioChip /> : null}
                    {recording ? (
                      <LiveRecordPill
                        onStop={() => {
                          tick();
                          void toggleRecording();
                        }}
                      />
                    ) : null}
                  </View>

                  <View pointerEvents="box-none" className="flex-1 items-center gap-2 px-2">
                    {readoutStrip}
                    {drawerPill}
                  </View>

                  <GlassDisc
                    icon={AnalyticsIcon}
                    label={t("control.analytics")}
                    active={analyticsOpen || monitor !== "off"}
                    onPress={toggleAnalytics}
                  />
                </View>

                {/* The zoom rocker: the one slider on the glass. It springs back to
                    the middle on release, so it is a speed, not a position. */}
                {panel === null && meterMode !== "manual" ? (
                  <View
                    pointerEvents="box-none"
                    className="absolute bottom-0 top-0 justify-center"
                    style={{ right: 4 }}
                  >
                    <ZoomRocker
                      canZoom={canZoom}
                      zoom={zoom}
                      min={zoomRange.min}
                      max={zoomRange.max}
                      onZoom={setZoom}
                      height={Math.min(240, height * 0.5)}
                    />
                  </View>
                ) : null}

                <View
                  pointerEvents="box-none"
                  className="absolute bottom-3 left-3 flex-row items-end gap-2.5"
                >
                  {ladder.minimal ? null : leftCornerIds.map(cornerDisc)}
                </View>

                <View
                  pointerEvents="box-none"
                  className="absolute inset-x-0 bottom-3 items-center"
                >
                  {meterBarOpen ? (
                    <MeteringModeBar
                      mode={meterMode}
                      onChange={chooseMeterMode}
                      manualAvailable={(capabilities?.manualSensor ?? false) || (capabilities?.focusNear ?? 0) > 0}
                    />
                  ) : (
                    <LiveInfoPanel
                      fps={connection?.fps ?? null}
                      resolution={connection ? `${connection.height}p` : null}
                      live={live}
                      recording={recording}
                      troubled={troubled}
                      dropped={dropped}
                      battery={{ level: charge.level, charging: charge.charging }}
                      warn={infoWarn}
                      onPress={() => togglePanel("stats")}
                      onLongPress={sayBattery}
                    />
                  )}
                </View>

                <View
                  pointerEvents="box-none"
                  className="absolute bottom-3 right-3 flex-row items-end gap-2.5"
                >
                  <GlassDisc
                    icon={ResumeIcon}
                    label="Recordings"
                    onPress={() => router.push("/settings/recordings")}
                  />
                  {ladder.minimal ? null : rightCornerIds.map(cornerDisc)}
                </View>
              </View>
            </SafeAreaView>
          </View>
        </>
      ) : (
        /* Portrait: Filmic's layout turned - a black bar along the top with
           framing, the state, the drawer, analytics and settings; a black bar
           along the bottom with the shutter at its centre under the thumb; the
           info panel and any open panel sitting on the picture just above it. */
        <>
          <SafeAreaView
            pointerEvents="box-none"
            edges={["top", "left", "right"]}
            className="absolute inset-x-0 top-0 bg-filmic-base"
            onLayout={(e) => setTopBar(Math.round(e.nativeEvent.layout.height))}
          >
            <View pointerEvents="box-none" className="flex-row items-center gap-2 px-3 py-2">
              {meterRing(40)}
              <StatusBadge state={badgeState} label={badgeLabel} />
              <View pointerEvents="box-none" className="flex-1 items-center">
                {drawerPill}
              </View>
              <GlassDisc
                icon={AnalyticsIcon}
                size={40}
                label={t("control.analytics")}
                active={analyticsOpen || monitor !== "off"}
                onPress={toggleAnalytics}
              />
              <GlassDisc
                icon={SettingsIcon}
                size={40}
                label={t("control.settings")}
                onPress={() => openSettings()}
              />
            </View>
          </SafeAreaView>

          {/* On the picture under the top bar: the numbers, and what is live. */}
          <View
            pointerEvents="box-none"
            className="absolute inset-x-0 gap-1.5 px-3"
            style={{ top: topBar + 4 }}
          >
            {readoutStrip}
            <View pointerEvents="box-none" className="items-start gap-1.5">
              {live ? <LiveStudioChip /> : null}
              {recording ? (
                <LiveRecordPill
                  onStop={() => {
                    tick();
                    void toggleRecording();
                  }}
                />
              ) : null}
            </View>
          </View>

          {/* Above the bottom bar, on the picture: an open panel, the notice, and
              the info panel when nothing covers it. */}
          <View
            pointerEvents="box-none"
            className="absolute inset-x-0 gap-2"
            style={{ bottom: bottomBar + 8 }}
          >
            {panelBody ? (
              <View pointerEvents="box-none" className="px-3">
                {panelBody}
              </View>
            ) : null}
            {ladder.quietHud ? null : <Notice text={notice.text} at={notice.at} tone={notice.tone} />}
            {panel === null ? (
              <View pointerEvents="box-none" className="items-center">
                {meterBarOpen ? (
                  <MeteringModeBar
                    mode={meterMode}
                    onChange={chooseMeterMode}
                    manualAvailable={(capabilities?.manualSensor ?? false) || (capabilities?.focusNear ?? 0) > 0}
                  />
                ) : (
                  <LiveInfoPanel
                    fps={connection?.fps ?? null}
                    resolution={connection ? `${connection.height}p` : null}
                    live={live}
                    recording={recording}
                    troubled={troubled}
                    dropped={dropped}
                    battery={{ level: charge.level, charging: charge.charging }}
                    warn={infoWarn}
                    onPress={() => togglePanel("stats")}
                    onLongPress={sayBattery}
                  />
                )}
              </View>
            ) : null}
          </View>

          <SafeAreaView
            pointerEvents="box-none"
            edges={["bottom", "left", "right"]}
            className="absolute inset-x-0 bottom-0 bg-filmic-base"
            onLayout={(e) => setBottomBar(Math.round(e.nativeEvent.layout.height))}
          >
            <View pointerEvents="box-none" className="gap-3 px-5 pb-3 pt-3">
              {/* The operator's quick controls, a size down, above the shutter row. */}
              <View pointerEvents="box-none" className="flex-row items-center justify-center gap-3">
                {ladder.minimal ? null : leftCornerIds.map(cornerDisc)}
                {ladder.minimal ? null : rightCornerIds.map(cornerDisc)}
                <GlassDisc
                  icon={ResumeIcon}
                  size={44}
                  label="Recordings"
                  onPress={() => router.push("/settings/recordings")}
                />
              </View>
              <View pointerEvents="box-none" className="flex-row items-center justify-between">
                <ColorDiamond
                  label="Image"
                  active={panel === "image"}
                  onPress={() => togglePanel("image")}
                />
                <ShutterButton label={primary.label} mode={primary.mode} onPress={primary.onPress} />
                {micControl}
              </View>
            </View>
          </SafeAreaView>
        </>
      )}

      {/* Portrait keeps the same rocker on the trailing edge, where the picture
          is otherwise empty of controls. */}
      {!wide && panel === null && meterMode !== "manual" ? (
        <View
          pointerEvents="box-none"
          className="absolute justify-center"
          style={{ right: 4, top: topBar + 40, bottom: bottomBar + 80 }}
        >
          <ZoomRocker
            canZoom={canZoom}
            zoom={zoom}
            min={zoomRange.min}
            max={zoomRange.max}
            onZoom={setZoom}
            height={Math.min(240, height * 0.3)}
          />
        </View>
      ) : null}

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />

      <CameraSettingsContext.Provider
        value={{
          cameras,
          selectCamera,
          autoFocus,
          setAutoFocus,
          stabilizationSupported: capabilities?.stabilization ?? false,
          stabilization,
          setStabilization,
          antiFlickerModes,
          antiFlicker,
          setAntiFlicker,
          noiseReductionModes,
          noiseReduction,
          setNoiseReduction,
          hasTorch: capabilities?.torch ?? false,
          torch,
          toggleTorch,
          orientation,
          setOrientation,
          guides,
          toggleGuide,
        }}
      >
        <SettingsGrid
          open={settingsOpen}
          openTo={settingsOpenTo}
          pages={HOST_PAGES}
          onClose={closeSettings}
          onTile={(tile) => {
            closeSettings();
            const route = routeForTile(tile);
            if (route) router.push(route as Href);
            else setPanel("camera");
          }}
        />
      </CameraSettingsContext.Provider>
    </View>
  );
}

/**
 * The microphone in the operator's words, not Android's. Names come through as
 * whatever the accessory calls itself - often a long adapter name - so the
 * chip truncates and the kind is the fallback for a device that gives no name
 * at all.
 */
/**
 * The chip's version of a device name, which has about nine characters to work
 * with.
 *
 * In landscape the picture is centred and the strip beside it is roughly
 * eighty points wide - so "Built-in microphone 1" is not a label, it is a
 * banner across the lower third of the shot. The full names stay in the panel,
 * where there is room for them and where the choice is actually made; this
 * only has to answer "which one is live" at a glance.
 */
/**
 * The reticles skip the screen's renders: every prop they take is stable, so a
 * new second on the clock or a new log line no longer re-renders them - their
 * drags run on the UI thread and have nothing to wait for.
 */
const Reticles = memo(ReticlesView);

/**
 * The level meter, drawn natively when the installed build has the view: it is
 * fed straight from the microphone on the UI thread, so it keeps moving however
 * busy JavaScript gets - the meter froze first in an hour-long class when JS
 * drew it. An older build falls back to the JS meter. Same 16 x 129 footprint.
 */
function Meter({ muted, maxFps }: { muted: boolean; maxFps: number }) {
  // Filmic's proportions: tall, and wide enough that the two bars sit apart.
  const { width: screenW, height: screenH } = useWindowDimensions();
  const meterH = screenW > screenH ? Math.round(Math.min(300, screenH * 0.5)) : 170;
  const meterW = 34;
  const [gain, setGain] = useState(() => loadSettings().micGain);
  const onGain = useCallback((next: number) => {
    setGain(next);
    saveSettings({ micGain: next });
    void setMicGain(next).catch(() => {});
  }, []);
  if (LevelMeterView) {
    return (
      <View className="items-center gap-1.5">
        <View style={{ width: meterW, height: meterH }}>
          <LevelMeterView muted={muted} maxFps={maxFps} style={{ width: meterW, height: meterH }} />
          {/* Filmic's gain bar across the meter: drag for input gain. */}
          <GainHandle gain={gain} height={meterH} width={meterW} onGain={onGain} />
        </View>
        {muted ? (
          <Text className="text-[10px] font-semibold uppercase text-filmic-alert">Muted</Text>
        ) : null}
      </View>
    );
  }
  return <LevelMeter muted={muted} />;
}

// --- Live readouts ---------------------------------------------------------
//
// Each of these reads one running number from the readouts store, so a new
// second, a new bitrate or a new log line re-renders that one piece of text and
// not the whole viewfinder around it. See lib/broadcast/readouts.ts for why.




function LiveReconnectingOverlay() {
  const uptime = useReadout((r) => r.uptime);
  return <ReconnectingOverlay seconds={uptime} />;
}

/** Re-renders once, when the studio's settling window passes - not every second. */
function LiveStudioChip() {
  const settled = useReadout((r) => isSettled(r.uptime));
  return <StudioChip settled={settled} />;
}

function LiveRecordPill({ onStop }: { onStop: () => void }) {
  const seconds = useReadout((r) => r.recordSeconds);
  return <RecordPill seconds={seconds} elapsed={formatUptime(seconds)} onStop={onStop} />;
}

function LiveLogPanel({ onClose }: { onClose: () => void }) {
  const log = useReadout((r) => r.log);
  return <LogPanel entries={log} onClose={onClose} />;
}

/**
 * The info panel with its running parts filled in here: the clock (live
 * uptime, or the take when only recording) and the second line - what is
 * leaving, or what is going wrong.
 */
function LiveInfoPanel({
  live,
  recording,
  troubled,
  dropped,
  ...panel
}: Omit<React.ComponentProps<typeof InfoPanel>, "timecode" | "hot" | "subline"> & {
  live: boolean;
  recording: boolean;
  troubled: boolean;
  dropped: number;
}) {
  const seconds = useReadout((r) => (live ? r.uptime : recording ? r.recordSeconds : 0));
  const bitrate = useReadout((r) => (live ? r.bitrate : 0));
  const fpsOut = useReadout((r) => (troubled ? (r.stats?.measuredFps ?? null) : null));
  const subline = !live
    ? null
    : troubled
      ? [fpsOut !== null ? t("hud.fpsOut", { fps: fpsOut }) : null, dropped > 0 ? t("hud.dropped", { count: dropped }) : null]
          .filter(Boolean)
          .join(" ")
      : bitrate > 0
        ? formatKbps(bitrate)
        : null;
  return <InfoPanel {...panel} timecode={clock(seconds)} hot={live || recording} subline={subline} />;
}

/** The encoder's own numbers, refreshed each second while this panel is open. */
function EncoderStatsPanel({ live, onClose }: { live: boolean; onClose: () => void }) {
  const stats = useReadout((r) => r.stats);
  const bitrate = useReadout((r) => r.bitrate);
  return (
    <Panel title="What the encoder is doing" onClose={onClose}>
      <Readout label="Picture" value={stats ? `${stats.width}x${stats.height}` : "-"} />
      <Readout
        label={live ? "Frame rate out" : "Frame rate"}
        value={
          stats
            ? live
              ? `${stats.measuredFps} fps · ${stats.fps} asked for`
              : `${stats.fps} fps asked for`
            : "-"
        }
      />
      <Readout label="Codec" value={stats ? stats.codec.toUpperCase() : "-"} />
      <Readout label="Target bitrate" value={stats ? formatKbps(stats.bitrate) : "-"} />
      <Readout label="Going out" value={live ? formatKbps(bitrate) : "nothing"} />
      {stats ? <BufferMeter items={stats.queueItems} capacity={stats.queueCapacity} /> : null}
      <Readout
        label="Dropped"
        value={stats ? `${stats.droppedVideoFrames} video · ${stats.droppedAudioFrames} audio` : "-"}
      />
      <Readout
        label="Sent"
        value={
          stats ? `${(stats.bytesSent / 1_000_000).toFixed(1)} MB · ${stats.sentVideoFrames} frames` : "-"
        }
      />
      {/* The encoder's own answer, not ours - which is the point of reading it
          back when the two disagree. */}
      <Readout label="Recorder" value={stats ? (stats.recording ? "recording" : "off") : "-"} />
      <Readout label="Outgoing picture" value={stats ? (stats.videoMuted ? "held" : "moving") : "-"} />
    </Panel>
  );
}

/**
 * The running camera's controls, for the settings panel's Hardware and
 * Stabilization pages. Those pages drive the live camera, so they are drawn by
 * this screen (which owns it) and handed to the panel, not routes of their own.
 */
type CameraSettings = {
  cameras: CameraInfo[];
  selectCamera: (id: string) => void;
  autoFocus: boolean;
  setAutoFocus: (on: boolean) => void;
  stabilizationSupported: boolean;
  stabilization: boolean;
  setStabilization: (on: boolean) => void;
  antiFlickerModes: number[];
  antiFlicker: number;
  setAntiFlicker: (mode: number) => void;
  noiseReductionModes: number[];
  noiseReduction: number;
  setNoiseReduction: (mode: number) => void;
  hasTorch: boolean;
  torch: boolean;
  toggleTorch: () => void;
  orientation: Orientation;
  setOrientation: (mode: Orientation) => void;
  guides: GuideSet;
  toggleGuide: (key: keyof GuideSet) => void;
};
const CameraSettingsContext = createContext<CameraSettings | null>(null);

function HardwareSettingsPage() {
  const c = useContext(CameraSettingsContext);
  const { width, height } = useWindowDimensions();
  if (!c) return null;
  const current = c.cameras.find((entry) => entry.current);
  return (
    <Page title="Hardware">
      <Group title="Lens">
        {c.cameras.length > 0 ? (
          <ChoiceRow
            label="Camera"
            value={current?.id ?? ""}
            options={c.cameras.map((entry) => ({ label: describeCamera(entry), value: entry.id }))}
            onChange={(id) => c.selectCamera(id)}
          />
        ) : null}
        <SwitchRow
          label="Auto focus"
          detail={c.autoFocus ? "The camera keeps the picture sharp" : "Focus is held where it was set"}
          on={c.autoFocus}
          onPress={() => c.setAutoFocus(!c.autoFocus)}
        />
        {c.hasTorch ? <SwitchRow label="Torch" on={c.torch} onPress={c.toggleTorch} /> : null}
      </Group>
      {/* Filmic's Orientation Lock: off, the app turns with the phone; on, it
          holds the way the phone is held now. */}
      <Group>
        <SwitchRow
          label="Orientation lock"
          detail={
            c.orientation === "auto"
              ? "The picture turns with the phone"
              : `Held in ${c.orientation} until switched off`
          }
          on={c.orientation !== "auto"}
          onPress={() =>
            c.setOrientation(c.orientation !== "auto" ? "auto" : width > height ? "landscape" : "portrait")
          }
        />
      </Group>
      {c.antiFlickerModes.length > 1 ? (
        <Group title="Anti-flicker" note="Matches the mains frequency so lights do not band.">
          <ChoiceRow
            label="Mode"
            value={c.antiFlicker}
            options={c.antiFlickerModes.map((mode) => ({ label: describeAntiFlicker(mode), value: mode }))}
            onChange={c.setAntiFlicker}
          />
        </Group>
      ) : null}
      {c.noiseReductionModes.length > 1 ? (
        <Group title="Noise reduction" note="Higher settings smooth a dim room's grain at some cost in detail.">
          <ChoiceRow
            label="Mode"
            value={c.noiseReduction}
            options={c.noiseReductionModes.map((mode) => ({ label: describeNoiseReduction(mode), value: mode }))}
            onChange={c.setNoiseReduction}
          />
        </Group>
      ) : null}
    </Page>
  );
}

function StabilizationSettingsPage() {
  const c = useContext(CameraSettingsContext);
  if (!c) return null;
  return (
    <Page title="Stabilization">
      <Group
        note={
          c.stabilizationSupported
            ? "Optical where the lens has it, electronic otherwise. Electronic costs a slight crop. Off on a tripod."
            : "This lens offers no stabilisation."
        }
      >
        <SwitchRow
          label="Stabilise the picture"
          on={c.stabilization}
          onPress={() => c.stabilizationSupported && c.setStabilization(!c.stabilization)}
        />
      </Group>
    </Page>
  );
}

/** Filmic's framing button: the shape of the picture and the guides over it. */
function FramingSettingsPage() {
  const c = useContext(CameraSettingsContext);
  if (!c) return null;
  return (
    <Page title="Framing">
      <Group
        title="Shape"
        note="Set it before going live: a stream that changes shape halfway through is letterboxed everywhere downstream."
      >
        <ChoiceRow
          label="Picture"
          value={c.orientation}
          options={[
            { label: "Follow the phone", value: "auto" as Orientation },
            { label: "Portrait", value: "portrait" as Orientation },
            { label: "Landscape", value: "landscape" as Orientation },
          ]}
          onChange={c.setOrientation}
        />
      </Group>
      <Group title="Guides" note="Drawn on the viewfinder only - never recorded or streamed.">
        <SwitchRow label="Thirds" on={c.guides.thirds} onPress={() => c.toggleGuide("thirds")} />
        <SwitchRow label="Centre cross" on={c.guides.centre} onPress={() => c.toggleGuide("centre")} />
        <SwitchRow
          label="4:3 safe area"
          detail="What a 4:3 crop keeps"
          on={c.guides.safe43}
          onPress={() => c.toggleGuide("safe43")}
        />
        <SwitchRow
          label="1:1 safe area"
          detail="What a square crop keeps"
          on={c.guides.safe11}
          onPress={() => c.toggleGuide("safe11")}
        />
      </Group>
    </Page>
  );
}

const HOST_PAGES = {
  "/settings/framing": FramingSettingsPage,
  "/settings/hardware": HardwareSettingsPage,
  "/settings/stabilization": StabilizationSettingsPage,
};

/** The preferences the viewfinder acts on, from the Device and Interface pages. */
function viewPrefsOf(prefs: ReturnType<typeof loadPreferences>) {
  return {
    dimWhenIdle: prefs.dimWhenIdle,
    thermalLadder: prefs.thermalLadder,
    readoutStrip: prefs.readoutStrip,
    peakingColor: prefs.peakingColor,
    zebraThreshold: prefs.zebraThreshold,
  };
}

/** What the aid tag says while an analytics aid recolours the picture. */
const AID_ON: Record<MonitorMode, string> = {
  off: "",
  peaking: "Peaking on",
  zebra: "Zebras on",
  falsecolor: "False colour on",
  clipping: "Clipping on",
};

/** White balance as the readout strip has room for it: one short word. */
function shortWhiteBalance(mode: number): string {
  switch (mode) {
    case 0:
      return "Manual";
    case AWB_AUTO:
      return "AWB";
    case 2:
      return "Tungsten";
    case 3:
      return "Fluor";
    case 4:
      return "Warm fl";
    case 5:
      return "Daylight";
    case 6:
      return "Cloudy";
    case 7:
      return "Twilight";
    case 8:
      return "Shade";
    default:
      return `WB ${mode}`;
  }
}

/** Filmic's running clock: always hours, minutes and seconds, so it never changes width. */
function clock(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

function shortAudioInput(device: AudioDevice | null): string {
  if (!device) return t("mic.auto");
  switch (device.kind) {
    case "builtin": {
      // Keep the number, which is the only thing telling two of them apart.
      const n = /\d+$/.exec(device.name)?.[0];
      return n ? t("mic.builtinNumbered", { n }) : t("mic.builtin");
    }
    case "wired":
      return t("mic.wired");
    case "bluetooth":
      return t("mic.bluetooth");
    case "usb":
      return t("mic.usb");
    default:
      return t("mic.other");
  }
}

/**
 * One line of the check before going live. The mark is a word-sized glyph and
 * the colour doubles it, so neither alone carries the meaning.
 *
 * `info` is for a fact that is not a fault - a microphone nobody has spoken
 * into yet. Drawn in the same amber as a warning it was read as one, on every
 * broadcast, and a check that is always amber stops being read at all.
 */
type CheckTone = "ok" | "info" | "warn" | "bad";

const CHECK_MARK: Record<CheckTone, { glyph: string; mark: string; text: string }> = {
  ok: { glyph: "✓", mark: "text-green-400", text: "text-white" },
  info: { glyph: "·", mark: "text-white/70", text: "text-white/80" },
  warn: { glyph: "!", mark: "text-amber-400", text: "text-amber-100" },
  bad: { glyph: "!", mark: "text-red-400", text: "text-red-100" },
};

function CheckLine({ tone, children }: { tone: CheckTone; children: React.ReactNode }) {
  const look = CHECK_MARK[tone];
  /**
   * The whole line turns round in Arabic, mark and all: the mark is read
   * first, so it belongs at the start of the line, and in Arabic the start is
   * the right. Done on this row only - see RTL_TEXT for why not the app.
   */
  const dir = textDir();
  return (
    <View className="flex-row gap-2" style={dir ? { direction: "rtl" } : undefined}>
      <Text className={`text-sm font-bold ${look.mark}`}>{look.glyph}</Text>
      <Text style={dir} className={`flex-1 text-sm ${look.text}`}>
        {children}
      </Text>
    </View>
  );
}

function describeAudioInput(device: AudioDevice): string {
  if (device.name) return device.name;
  switch (device.kind) {
    case "wired":
      return t("mic.wiredFull");
    case "bluetooth":
      return t("mic.bluetoothFull");
    case "usb":
      return t("mic.usbFull");
    default:
      return t("mic.externalFull");
  }
}

/** `back · 68°`, which is what tells one rear lens from another. */
function describeCamera(entry: CameraInfo): string {
  const facing =
    entry.facing === "external"
      ? "External camera"
      : entry.facing === "front"
        ? "Front"
        : entry.facing === "back"
          ? "Rear"
          : `Camera ${entry.id}`;
  return entry.fieldOfView > 0 ? `${facing} · ${entry.fieldOfView}°` : facing;
}

/**
 * Android's CONTROL_AWB_MODE values, in the words a camera operator uses. A
 * mode this phone has that we have no name for is still offered, by number:
 * better an odd label than a control the camera supports and we hid.
 */
function describeWhiteBalance(mode: number): string {
  switch (mode) {
    case 0:
      return "Manual";
    case AWB_AUTO:
      return "Auto";
    case 2:
      return "Tungsten - warm indoor light";
    case 3:
      return "Fluorescent";
    case 4:
      return "Warm fluorescent";
    case 5:
      return "Daylight";
    case 6:
      return "Cloudy";
    case 7:
      return "Twilight";
    case 8:
      return "Shade";
    default:
      return `Mode ${mode}`;
  }
}

/**
 * Android's CONTROL_AE_ANTIBANDING_MODE values.
 *
 * Named by the supply frequency rather than the constant, because the operator
 * knows which country they are standing in and does not know what the sensor
 * calls it. Auto is right nearly always; the manual settings exist for the
 * case auto gets wrong, which is mixed lighting.
 */
function describeAntiFlicker(mode: number): string {
  switch (mode) {
    case 0:
      return "Off";
    case 1:
      return "50 Hz - Europe, Africa, Asia, Australia";
    case 2:
      return "60 Hz - Americas, Japan, Korea";
    case 3:
      return "Auto";
    default:
      return `Mode ${mode}`;
  }
}

/**
 * Android's NOISE_REDUCTION_MODE values.
 *
 * The trade is sharpness against grain and, at high quality, against the frame
 * rate the pipeline can hold - so each label says what it costs rather than
 * just what it is. Fast is the default on nearly every phone.
 */
function describeNoiseReduction(mode: number): string {
  switch (mode) {
    case 0:
      return "Off - grain kept, detail kept";
    case 1:
      return "Fast - no cost to frame rate";
    case 2:
      return "High quality - may cost frame rate";
    case 3:
      return "Minimal";
    case 4:
      return "Zero shutter lag";
    default:
      return `Mode ${mode}`;
  }
}

/**
 * What a recording is actually writing, in bits per second.
 *
 * The recorder takes the same picture the broadcast does, so the destination's
 * video bitrate is the video half; the audio half comes from the phone
 * settings, which is where it is set. With no destination chosen there is
 * nothing to record at, and a zero here reads downstream as "no estimate"
 * rather than as an infinite amount of room.
 */
function recordingBitrateOf(connection: Connection | null): number {
  const audio = loadSettings().audioBitrate;
  /**
   * The recorder's own bitrate when the operator set one, because that is what
   * is being written to the disk - the destination's figure would under-count
   * a 1080p master of a 360p stream by a factor of eight.
   */
  const chosen = recordQualityFor(loadPreferences().recordHeight);
  if (chosen.bitrate > 0) return chosen.bitrate + audio;
  if (!connection) return 0;
  return connection.videoBitrate + audio;
}
