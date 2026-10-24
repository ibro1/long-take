import type { StringKey } from "./en.ts";

/**
 * The operator's viewfinder strings in Hausa (Boko Latin script).
 *
 * This is a DRAFT, machine-assisted translation. A native Hausa speaker must
 * review it before anyone relies on it in front of a class.
 *
 * It is deliberately short, because these strings sit on head-up chips on a
 * camera viewfinder and have to fit where the English fits.
 *
 * Brand and protocol names stay as they are: Framevane, YouTube, Facebook,
 * RTMP, RTMPS, SRT, Wi-Fi, USB, Bluetooth, fps, kbps, and the p in 720p. The
 * `{placeholders}` are filled in by `t` and must survive untouched.
 */
export const ha: Record<StringKey, string> = {
  // The state chip, top left.
  "hud.reconnecting": "Ana sake haɗawa",
  "hud.paused": "An dakata",
  "hud.connecting": "Ana haɗawa",
  "hud.offAir": "Ba a iska",
  "hud.goingLive": "Ana farawa",
  "hud.fpsOut": "{fps} fps na fita",
  "hud.dropped": "· {count} sun faɗi",

  // The studio's answer about each platform, beside the uptime.
  "studio.live": "kai tsaye",
  "studio.waiting": "ana jira",
  "studio.starting": "ana farawa",
  "studio.ended": "ya ƙare",
  "studio.unpublished": "na sirri",
  "studio.liveA11y": "{platform} yana kai tsaye.",
  "studio.waitingA11y": "{platform} bai fara ba tukuna, ko da yake wannan waya tana aikawa.",
  "studio.startingA11y": "{platform} bai gama farawa ba.",
  "studio.endedA11y": "{platform} ya ƙare taronsa, ko da yake wannan waya tana ci gaba da aikawa.",
  "studio.unpublishedA11y": "{platform} yana karɓar bidiyon, ba a wallafa ba.",

  // The shutter.
  "primary.setUp": "Saita",
  "primary.cancel": "Soke",
  "primary.end": "Kammala watsa",
  "primary.goLive": "Fara kai tsaye",

  // The discs, and their rows behind More.
  "control.camera": "Kyamara",
  "control.cameraHint": "Tabarau, zuƙowa, haske da fokas.",
  "control.shape": "Siffa",
  "control.shapeHint": "A tsaye, a kwance, ko bin wayar.",
  "control.overlays": "Lulluɓi",
  "control.overlaysHint": "Katunan suna da rubutu da aka sanya cikin hoton.",
  "control.stats": "Ƙididdiga",
  "control.statsHint": "Abin da ke barin wayar a zahiri.",
  "control.log": "Rajista",
  "control.logHint": "Abin da mai sarrafa bidiyo ya faɗa, bi da bi.",
  "control.record": "Naɗa",
  "control.recordHint": "Kwafi a wannan waya, ban da abin da sabar ke ajiyewa.",
  "control.stopRecording": "Daina naɗa",
  "control.stopRecordingHint": "Yana kammala naɗin kuma yana ajiye fayil a waya.",
  "control.photo": "Hoto",
  "control.photoHint": "Hoto tsayayye daga bidiyon kai tsaye, ana ajiye shi a waya.",
  "control.pause": "Dakata",
  "control.paused": "An dakata",
  "control.pauseHint": "Riƙe hoton ba tare da yanke haɗi ba.",
  "control.flip": "Juya",
  "control.flipHint": "Sauya tsakanin kyamarar gaba da ta baya.",
  "control.settings": "Saituna",
  "control.analytics": "Nazari",
  "control.more": "Ƙari",
  "control.destinations": "Wuraren aikawa",
  "control.nowhere": "Babu inda za a tura wannan tukuna.",
  "control.mute": "Kashe sauti",
  "control.muted": "Sauti a kashe",
  "control.torch": "Fitila",
  "control.torchOn": "Fitila a kunne",
  "control.torchOff": "Fitila a kashe",
  "control.recordingA11y": "Daina naɗa, {time} zuwa yanzu",
  "control.rec": "Naɗa",
  "control.longTake": "naɗi mai tsawo",

  // The microphone chip, bottom left.
  "mic.chip": "Makirufo: {name}",
  "mic.chipA11y": "Makirufo: {name}. Canza shi.",
  "mic.androidChoice": "Zaɓin Android",
  "mic.auto": "Atomatik",
  "mic.builtin": "Mik",
  "mic.builtinNumbered": "Mik {n}",
  "mic.wired": "Mai waya",
  "mic.bluetooth": "Bluetooth",
  "mic.usb": "USB",
  "mic.other": "Wani",
  "mic.wiredFull": "Makirufo mai waya",
  "mic.bluetoothFull": "Makirufo na Bluetooth",
  "mic.usbFull": "Makirufo na USB",
  "mic.externalFull": "Makirufo na waje",

  // Where it is going.
  "destination.none": "Babu wurin aikawa",
  "destination.choose": "Zaɓi wurin aikawa",
  "destination.a11y": "Wurin aikawa: {name}. Canza shi.",

  // Shared furniture.
  "common.close": "Rufe",
  "common.dismiss": "Watsar",
  "common.openLog": "Buɗe rajista",

  // Banners.
  "banner.offAir":
    "Watsawa ta tsaya. Haɗin ya yanke kuma ba a iya dawo da shi ba, don haka masu kallo ba sa samun komai.",
  "banner.goLiveAgain": "Sake fara kai tsaye",
  "banner.tryAgain": "Sake gwadawa",
  "banner.stall":
    "Babu abin da ya bar wayar na wasu daƙiƙoƙi. Haɗin yana nan a buɗe, don haka matsalar ta hanyar sadarwa ce ko mai sarrafa bidiyo, ba sabar ba.",
  "banner.restart": "Sake fara haɗi",
  "banner.micCall": "Ba a jin komai - wannan waya tana kan kira. Hoton yana ci gaba da fita.",
  "banner.micHeadset":
    "Belun kunne na Bluetooth bai buɗe makirufonsa ba. Sake zaɓe shi, ko zaɓi makirufon wayar.",
  "banner.micTaken": "Makirufo ya tsaya. Wataƙila wata manhaja a wayar ta ɗauke shi.",
  "banner.micSilent":
    "Makirufo a buɗe yake amma babu sauti ko kaɗan. Wataƙila wata manhaja a wayar ta ɗauke shi.",
  "banner.reopenMic": "Sake buɗe makirufo",
  "banner.congestion":
    "Haɗin ba ya ɗaukar komai. Framevane yana rage abin da yake aikawa don hoton ya ci gaba da motsi.",

  // Why a broadcast failed (lib/broadcast/failure.ts).
  "failure.flapping":
    "Sabar ta yi ta karɓar watsawar sannan ta yanke ta bayan daƙiƙoƙi, don haka wayar ta daina sake gwadawa. Tabbatar babu wani abu da ke aikawa zuwa wannan rafi, sannan sake fara kai tsaye.",
  "failure.refused": "Sabar ta ƙi haɗin. Duba adireshin sabar, da cewa sabar tana aiki.",
  "failure.dns": "Ba a sami sunan sabar ba. Duba adireshin sabar, da cewa wayar tana kan intanet.",
  "failure.unreachable": "Wannan waya ba ta da hanyar zuwa sabar. Duba Wi-Fi ko data.",
  "failure.timeout": "Sabar ba ta amsa a kan lokaci ba. Wataƙila intanet ya yi jinkiri sosai, ko adireshin ba daidai ba ne.",
  "failure.auth": "Sabar ta ƙi wannan maɓallin rafi. Sake kwafo shi daga shafin rafin a Framevane.",
  "failure.malformed": "Wannan manhaja ba za ta iya amfani da adireshin sabar nan ba. Duba shi a wurin aikawa.",
  "failure.handshake":
    "Sabar ta amsa amma ba ta gama haɗawa ba. Duba adireshin da ka'idar - RTMP, RTMPS ko SRT.",
  "failure.reset": "Sabar ta rufe haɗin.",
  "failure.configure": "Kyamara ko mai sarrafa bidiyo ba su fara da waɗannan saituna ba. Gwada ƙaramin girman hoto.",
  "failure.unknown": "Watsawar ba ta fara ba. Rajista na ɗauke da bayanin wayar kan dalilin.",

  // The phone's own state (lib/broadcast/guards.ts).
  "guard.batteryClosing": "Batir ya kusa ƙarewa. Ana rufe naɗin yanzu don a iya kunna fayil ɗin.",
  "guard.batteryGone": "Batir ya kusa ƙarewa.",
  "guard.storageClosing": "Wayar ta cika. Ana rufe naɗin yanzu don a iya kunna fayil ɗin.",
  "guard.tooHot": "Wayar ta yi zafi sosai. Ana rage gudun mai sarrafa bidiyo - rage girman hoto mataki ɗaya.",
  "guard.minutesLeft": "Kusan {left} na naɗi ya rage a wannan waya.",
  "guard.nearlyFull": "Wannan waya ta kusa cika.",
  "guard.gettingHot": "Wayar tana ƙara zafi. Nan ba da jimawa ba za a fara zubar da firam.",
  "guard.battery": "Batir {percent}%.",
  "guard.preBatteryGone": "Batir ya kusa ƙarewa. Saka wayar a caji kafin a fara kai tsaye.",
  "guard.preStorage": "{room} Watsawar za ta fita; amma ba za a sami kwafi a wannan waya ba.",
  "guard.preTooHot":
    "Wayar ta riga ta yi zafi sosai. Za a rage gudun mai sarrafa bidiyo - bari ta huce, ko rage girman hoto mataki ɗaya.",
  "guard.preWarm": "Wayar ta riga ta ɗan yi zafi. A sa ran faɗuwar firam a dogon watsa.",
  "guard.preBattery": "Batir {percent}%. Saka caji don watsa mai tsawo.",
  "guard.noMore": "babu sauran",
  "guard.underAMinute": "ƙasa da minti ɗaya",
  "guard.aMinute": "minti ɗaya",
  "guard.minutes": "minti {n}",
  "guard.tooLittleRoom": "Akwai {free} a wannan waya, kuma naɗi yana buƙatar {needed} kafin ya fara.",

  // The check before going live.
  "preflight.title": "Kafin ka fara kai tsaye",
  "preflight.goLive": "Fara kai tsaye",
  "preflight.goLiveAnyway": "Fara duk da haka",
  "preflight.microphone": "Makirufo",
  "preflight.androidMic": "Na wayar, wanda Android ya zaɓa",
  "preflight.muted": "An kashe makirufo.",
  "preflight.unmute": "Kunna sauti",
  "preflight.usual": "Makirufonka na kullum.",
  "preflight.usualConnected": "Na kullum shi ne {name}, kuma an haɗa shi.",
  "preflight.switchTo": "Koma {name}",
  "preflight.usualMissing": "Ba a haɗa {name} ba. Haɗa shi zai bayyana a nan - ko ka fara kai tsaye da wannan.",
  "preflight.tellUsual":
    "Faɗa wa Framevane makirufon da kake koyarwa da shi, kuma zai sanar duk lokacin da ake amfani da wani daban.",
  "preflight.makeUsualInstead": "Mayar da wannan na kullum",
  "preflight.makeUsual": "Wannan ne makirufona na kullum",
  "preflight.heard": "An ji ka.",
  "preflight.notHeard": "Ba a jin komai tukuna. Yi magana, sandar hagu za ta motsa.",
  "preflight.thisPhone": "Wannan waya",
  "preflight.goingOut": "Abin da ke fita",
  "preflight.picture": "{height}p · {fps} fps · {rate} zuwa {name}",
  "preflight.changePicture": "Canza hoto",
  "preflight.copy": "Kwafi a wannan waya",
  "preflight.recordToo": "Naɗa a wannan waya ma",
  "preflight.sameAsBroadcast": "Daidai da watsawa, {height}p",
  "preflight.recordOn": "{quality} - yana farawa da tsayawa tare da watsawa",
  "preflight.recordOff": "A kashe - abin da ke fita kawai, da kwafin sabar idan tana ajiyewa",
  "preflight.secondEncoder":
    "Naɗa a {quality} yayin aika {height}p yana gudanar da mai sarrafa bidiyo na biyu. Wayar za ta ƙara aiki da zafi - Daidai da watsawa ya fi sauƙi.",
  "preflight.changeRecording": "Canza girman naɗi",

  // Ending.
  "end.title": "A kammala watsawa?",
  "end.body": "Masu kallo za su ga ta tsaya. Sake farawa zai buɗe sabon watsa maimakon ci gaba da wannan.",
  "end.keep": "Ci gaba da watsa",
  "end.confirm": "Kammala watsa",

  // The full-frame states.
  "overlay.reconnecting": "Ana sake haɗawa",
  "overlay.reconnectingBody": "Masu kallo suna ganin rafin ya tsaya. Wayar tana sake haɗawa - bar ta inda take.",
  "overlay.reconnectingA11y": "Ana sake haɗawa. Masu kallo suna ganin rafin ya tsaya yayin da wayar ke sake haɗawa.",
  "overlay.onAirFor": "a iska tsawon {time}",
  "overlay.offAir": "Ba a iska",
  "overlay.offAirBody": "Ba a iya dawo da haɗin ba. Babu abin da ke fita.",
  "overlay.offAirA11y": "Ba a iska. Ba a iya dawo da haɗin ba.",
  "overlay.paused": "An dakata",
  "overlay.pausedLive": "Masu kallo suna ganin hoto tsayayye kuma ba sa jin komai. Haɗin yana nan.",
  "overlay.pausedIdle": "An riƙe hoton kuma makirufo a kashe.",
  "overlay.pausedAt": "an dakata a {time}",
};
