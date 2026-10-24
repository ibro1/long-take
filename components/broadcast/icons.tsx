import {
  AlignJustify,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Crop,
  EyeOff,
  Focus,
  Gauge,
  Globe,
  Image,
  Crosshair,
  Layers,
  Lock,
  LockOpen,
  Mic,
  MicOff,
  MoreVertical,
  Palette,
  Pause,
  Play,
  Radio,
  ScrollText,
  Settings,
  Search,
  Square,
  Sun,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";

/**
 * The glyphs the viewfinder is built out of.
 *
 * A viewfinder cannot spend words. A 10px label inside a thumb-sized disc is
 * unreadable on a real phone and unreadable in every language we have not
 * translated yet, whereas a slashed microphone is understood without reading.
 * So every control on the glass is an icon, and the words - where there is
 * room for words at all - sit outside it.
 *
 * Local to this folder on purpose: lib/icons is the shared set for the ordinary
 * screens and is owned elsewhere. These are named for the job they do here
 * rather than for the shape they are, because that is how the layout code
 * talks about them - and it keeps `Image` from colliding with the one in
 * react-native.
 */

/**
 * Same treatment lib/icons/iconWithClassName applies, so nativewind can drive
 * colour and size from `className` - `h-6 w-6 text-black` on an icon has to
 * mean what it means everywhere else, or the buttons cannot be styled with
 * the rest of the chrome.
 */
function withClassName(...icons: LucideIcon[]) {
  for (const icon of icons) {
    cssInterop(icon, {
      className: {
        target: "style",
        nativeStyleToProp: { color: true, opacity: true, width: true, height: true },
      },
    });
  }
}

withClassName(
  AlignJustify,
  EyeOff,
  Focus,
  Palette,
  Camera,
  Crosshair,
  Search,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Crop,
  Gauge,
  Globe,
  Image,
  Layers,
  Lock,
  LockOpen,
  Mic,
  MicOff,
  MoreVertical,
  Pause,
  Play,
  Radio,
  ScrollText,
  Settings,
  Square,
  Sun,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
);

export {
  Camera as CameraIcon,
  /** The way back, on the screens that used to be reached by a tab. */
  ChevronLeft as BackIcon,
  ChevronRight as ChevronIcon,
  /** Ready to record. The ring is the shutter, not a stop button. */
  CircleDot as RecordIcon,
  /** The shape of the outgoing picture, which is a crop before it is anything else. */
  Crop as ShapeIcon,
  Gauge as StatsIcon,
  /** Where the picture goes once it leaves the phone. */
  Globe as GlobeIcon,
  Image as PhotoIcon,
  /** Overlays: cards stacked on the picture, which is what the compositor does with them. */
  Layers as OverlayIcon,
  /** Exposure: the thing being metered is the light. */
  Sun as ExposureIcon,
  /** The zoom rail. A magnifier is what the gesture means to everyone. */
  Search as ZoomIcon,
  /** The focus rail. The reticle a tap already draws on the picture. */
  Crosshair as FocusIcon,
  /** The metering is held where it is. */
  Lock as LockedIcon,
  LockOpen as UnlockedIcon,
  Mic as MicIcon,
  /** Everything that is not reached for with the phone already raised. */
  MoreVertical as MoreIcon,
  Settings as SettingsIcon,
  /** Sound is off. The slash carries it; the word "muted" is not needed. */
  MicOff as MicOffIcon,
  Pause as PauseIcon,
  Play as ResumeIcon,
  /** Going on air - a transmitter, not a play button. */
  Radio as GoLiveIcon,
  ScrollText as LogIcon,
  /** Stop: ending a broadcast or ending a recording. */
  Square as StopIcon,
  SwitchCamera as FlipIcon,
  X as CloseIcon,
  Zap as TorchIcon,
  ZapOff as TorchOffIcon,
  /** Monitoring off: no aid drawn on the picture. */
  EyeOff as MonitorOffIcon,
  /** Focus peaking: the sharp plane outlined. */
  Focus as PeakingIcon,
  /** Zebras: diagonal stripes over blown highlights. */
  AlignJustify as ZebraIcon,
  /** False colour: exposure mapped to a palette. */
  Palette as FalseColorIcon,
};
