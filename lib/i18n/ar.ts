import type { StringKey } from "./en.ts";

/**
 * The operator's viewfinder strings in Modern Standard Arabic.
 *
 * This is a DRAFT, machine-assisted translation. A native Arabic speaker must
 * review it before anyone relies on it in front of a class.
 *
 * It is deliberately short, because these strings sit on head-up chips on a
 * camera viewfinder and have to fit where the English fits.
 *
 * Brand and protocol names stay as they are: Framevane, YouTube, Facebook,
 * RTMP, RTMPS, SRT, Wi-Fi, USB, Bluetooth, fps, kbps, and the p in 720p. The
 * `{placeholders}` are filled in by `t` and must survive untouched.
 */
export const ar: Record<StringKey, string> = {
  // The state chip, top left.
  "hud.reconnecting": "إعادة الاتصال",
  "hud.paused": "إيقاف مؤقت",
  "hud.connecting": "جارٍ الاتصال",
  "hud.offAir": "خارج البث",
  "hud.rec": "تسجيل",
  "hud.ready": "جاهز",
  "hud.goingLive": "بدء البث",
  "hud.fpsOut": "{fps} fps صادرة",
  "hud.dropped": "· {count} مفقودة",

  // The studio's answer about each platform, beside the uptime.
  "studio.live": "مباشر",
  "studio.waiting": "انتظار",
  "studio.starting": "يبدأ",
  "studio.ended": "انتهى",
  "studio.unpublished": "خاص",
  "studio.liveA11y": "{platform} على الهواء.",
  "studio.waitingA11y": "{platform} لم يبدأ البث بعد، رغم أن هذا الهاتف يرسل.",
  "studio.startingA11y": "{platform} ما زال يبدأ.",
  "studio.endedA11y": "أنهى {platform} الحدث، رغم أن هذا الهاتف ما زال يرسل.",
  "studio.unpublishedA11y": "{platform} يستقبل الفيديو، دون نشره.",

  // The shutter.
  "primary.setUp": "إعداد",
  "primary.cancel": "إلغاء",
  "primary.end": "إنهاء البث",
  "primary.goLive": "ابدأ البث",

  // The discs, and their rows behind More.
  "control.camera": "الكاميرا",
  "control.cameraHint": "العدسة والتكبير والتعريض والتركيز.",
  "control.shape": "الاتجاه",
  "control.shapeHint": "عمودي أو أفقي أو حسب الهاتف.",
  "control.overlays": "الطبقات",
  "control.overlaysHint": "بطاقات الأسماء والتعليقات المدمجة في الصورة.",
  "control.stats": "الإحصاءات",
  "control.statsHint": "ما يخرج فعلًا من الهاتف.",
  "control.log": "السجل",
  "control.logHint": "ما قاله المرمّز، بالترتيب.",
  "control.record": "تسجيل",
  "control.recordHint": "نسخة على هذا الجهاز، إضافة إلى ما يحفظه الخادم.",
  "control.noRoom": "لا مساحة",
  "control.noRoomHint": "أفرغ بعض المساحة على الهاتف ليعمل هذا مرة أخرى.",
  "control.stopRecording": "إيقاف التسجيل",
  "control.stopRecordingHint": "ينهي اللقطة ويحفظ الملف على الهاتف.",
  "control.photo": "صورة",
  "control.photoHint": "لقطة ثابتة من البث المباشر، تُحفظ على الهاتف.",
  "control.pause": "إيقاف مؤقت",
  "control.paused": "متوقف",
  "control.pauseHint": "تثبيت الصورة دون قطع الاتصال.",
  "slate.title": "سنعود بعد قليل",
  "slate.message": "سيستمر البث قريبًا",
  "control.flip": "تبديل",
  "control.flipHint": "التبديل بين الكاميرا الأمامية والخلفية.",
  "control.settings": "الإعدادات",
  "control.analytics": "التحليلات",
  "control.more": "المزيد",
  "control.destinations": "الوجهات",
  "control.nowhere": "لا توجد وجهة للإرسال بعد.",
  "control.mute": "كتم",
  "control.muted": "مكتوم",
  "control.torch": "المصباح",
  "control.torchOn": "المصباح مضاء",
  "control.torchOff": "المصباح مطفأ",
  "control.recordingA11y": "إيقاف التسجيل، {time} حتى الآن",
  "control.rec": "تسجيل",
  "control.longTake": "لقطة طويلة",

  // The microphone chip, bottom left.
  "mic.chip": "الإدخال: {name}",
  "mic.chipA11y": "الإدخال: {name}. غيّره.",
  "mic.androidChoice": "اختيار Android",
  "mic.auto": "تلقائي",
  "mic.builtin": "ميكروفون",
  "mic.builtinNumbered": "ميكروفون {n}",
  "mic.wired": "سلكي",
  "mic.bluetooth": "Bluetooth",
  "mic.usb": "USB",
  "mic.other": "آخر",
  "mic.wiredFull": "ميكروفون سلكي",
  "mic.bluetoothFull": "ميكروفون Bluetooth",
  "mic.usbFull": "ميكروفون USB",
  "mic.externalFull": "ميكروفون خارجي",

  // Where it is going.
  "destination.none": "لا وجهة",
  "destination.choose": "اختر وجهة",
  "destination.recordOnly": "تسجيل فقط",
  "destination.a11y": "الوجهة: {name}. غيّرها.",

  // Shared furniture.
  "common.close": "إغلاق",
  "common.dismiss": "تجاهل",
  "common.openLog": "فتح السجل",

  // Banners.
  "banner.offAir":
    "البث متوقف. انقطع الاتصال وتعذّرت استعادته، فلم يعد المشاهدون يستقبلون شيئًا.",
  "banner.goLiveAgain": "ابدأ البث مجددًا",
  "banner.tryAgain": "حاول مجددًا",
  "banner.stall":
    "لم يخرج شيء من الهاتف منذ عدة ثوانٍ. الاتصال ما زال مفتوحًا، فالمشكلة في الشبكة أو المرمّز، لا الخادم.",
  "banner.restart": "أعد تشغيل الاتصال",
  "banner.micCall": "لا يُسمع شيء - الهاتف في مكالمة. الصورة ما زالت تُبث.",
  "banner.micHeadset":
    "سماعة Bluetooth لم تفتح الميكروفون. اخترها مجددًا، أو اختر ميكروفون الهاتف.",
  "banner.micTaken": "توقف الميكروفون. ربما استحوذ عليه تطبيق آخر على الهاتف.",
  "banner.micSilent":
    "الميكروفون مفتوح لكن كل العينات صامتة. ربما استحوذ عليه تطبيق آخر على الهاتف.",
  "banner.reopenMic": "أعد فتح الميكروفون",
  "banner.congestion":
    "الاتصال لا يحمل كل شيء. يرسل Framevane أقل للحفاظ على حركة الصورة.",

  // Why a broadcast failed (lib/broadcast/failure.ts).
  "failure.flapping":
    "ظل الخادم يقبل البث ثم يقطعه بعد ثوانٍ، فتوقف الهاتف عن إعادة المحاولة. تأكد أن لا شيء آخر يرسل إلى هذا البث، ثم ابدأ البث مجددًا.",
  "failure.refused": "رفض الخادم الاتصال. تحقق من عنوان الخادم، ومن أنه يعمل.",
  "failure.dns": "تعذّر العثور على اسم الخادم. تحقق من عنوان الخادم، ومن اتصال الهاتف بالإنترنت.",
  "failure.unreachable": "لا يصل هذا الهاتف إلى الخادم. تحقق من Wi-Fi أو بيانات الجوال.",
  "failure.timeout": "لم يرد الخادم في الوقت المحدد. قد تكون الشبكة بطيئة جدًا، أو العنوان خاطئًا.",
  "failure.auth": "رفض الخادم مفتاح البث هذا. انسخه مجددًا من صفحة البث في Framevane.",
  "failure.malformed": "عنوان الخادم غير صالح لهذا التطبيق. تحقق منه في الوجهة.",
  "failure.handshake":
    "ردّ الخادم لكنه لم يُكمل الاتصال. تحقق من العنوان والبروتوكول - RTMP أو RTMPS أو SRT.",
  "failure.reset": "أغلق الخادم الاتصال.",
  "failure.configure": "تعذّر تشغيل الكاميرا أو المرمّز بهذه الإعدادات. جرّب حجم صورة أصغر.",
  "failure.unknown": "تعذّر بدء البث. السجل يذكر السبب بكلمات الهاتف نفسه.",

  // The phone's own state (lib/broadcast/guards.ts).
  "guard.batteryClosing": "البطارية على وشك النفاد. يُغلق التسجيل الآن ليبقى الملف قابلًا للتشغيل.",
  "guard.batteryGone": "البطارية على وشك النفاد.",
  "guard.storageClosing": "امتلأت ذاكرة الهاتف. يُغلق التسجيل الآن ليبقى الملف قابلًا للتشغيل.",
  "guard.tooHot": "حرارة مرتفعة جدًا: أُوقفت أدوات التحكم حتى يبرد الهاتف. البث مستمر.",
  "guard.minutesLeft": "يتبقى نحو {left} من التسجيل على هذا الهاتف.",
  "guard.nearlyFull": "ذاكرة الهاتف شبه ممتلئة.",
  "guard.gettingHot": "الهاتف يسخن: خُفّضت جودة الصورة ليبرد.",
  "guard.battery": "البطارية {percent}%.",
  "guard.minutesOfBattery": "يتبقى نحو {minutes} دقيقة من البطارية",
  "guard.preBatteryGone": "البطارية على وشك النفاد. اشحن الهاتف قبل بدء البث.",
  "guard.preStorage": "{room} البث سيستمر؛ لكن النسخة على هذا الهاتف لن تُحفظ.",
  "guard.preTooHot":
    "الهاتف ساخن جدًا مسبقًا. سيُبطّأ المرمّز - دعه يبرد، أو خفّض حجم الصورة درجة.",
  "guard.preWarm": "الهاتف دافئ مسبقًا. توقّع إسقاط إطارات في البث الطويل.",
  "guard.preBattery": "البطارية {percent}%. اشحنه لأي بث طويل.",
  "guard.noMore": "لا شيء",
  "guard.underAMinute": "أقل من دقيقة",
  "guard.aMinute": "دقيقة",
  "guard.minutes": "{n} دقيقة",
  "guard.tooLittleRoom": "المساحة الحرة على الهاتف {free}، والتسجيل يحتاج {needed} ليبدأ.",

  // The check before going live.
  "preflight.title": "قبل بدء البث",
  "preflight.goLive": "ابدأ البث",
  "preflight.goLiveAnyway": "ابدأ على أي حال",
  "preflight.microphone": "الميكروفون",
  "preflight.androidMic": "ميكروفون الهاتف، باختيار Android",
  "preflight.muted": "الميكروفون مكتوم.",
  "preflight.unmute": "إلغاء الكتم",
  "preflight.usual": "ميكروفونك المعتاد.",
  "preflight.usualConnected": "ميكروفونك المعتاد {name}، وهو متصل.",
  "preflight.switchTo": "التبديل إلى {name}",
  "preflight.usualMissing": "{name} غير متصل. صِله وسيظهر هنا - أو ابدأ البث بهذا.",
  "preflight.tellUsual":
    "أخبر Framevane بالميكروفون الذي تدرّس به، وسينبّهك كلما استُخدم ميكروفون آخر.",
  "preflight.makeUsualInstead": "اجعل هذا المعتاد بدلًا منه",
  "preflight.makeUsual": "هذا ميكروفوني المعتاد",
  "preflight.heard": "سمعتك.",
  "preflight.notHeard": "لا أسمع شيئًا بعد. قل شيئًا وسيتحرك الشريط على اليسار.",
  "preflight.thisPhone": "هذا الهاتف",
  "preflight.goingOut": "الصادر",
  "preflight.picture": "{height}p · {fps} fps · {rate} إلى {name}",
  "preflight.changePicture": "تغيير الصورة",
  "preflight.copy": "نسخة على الهاتف",
  "preflight.recordToo": "سجّل على الهاتف أيضًا",
  "preflight.sameAsBroadcast": "مثل البث، {height}p",
  "preflight.recordOn": "{quality} - يبدأ ويتوقف مع البث",
  "preflight.recordOff": "متوقف - فقط ما يُبث، ونسخة الخادم إن احتفظ بها",
  "preflight.secondEncoder":
    "التسجيل بدقة {quality} مع إرسال {height}p يشغّل مرمّز فيديو ثانيًا. يعمل الهاتف بجهد أكبر ويسخن أسرع - خيار مثل البث أخف.",
  "preflight.changeRecording": "تغيير حجم التسجيل",

  // Ending.
  "end.title": "إنهاء البث؟",
  "end.body": "سيرى المشاهدون البث يتوقف. البدء مجددًا يفتح بثًا جديدًا ولا يستأنف هذا.",
  "end.keep": "متابعة البث",
  "end.confirm": "إنهاء البث",

  // The full-frame states.
  "overlay.reconnecting": "إعادة الاتصال",
  "overlay.reconnectingBody": "يرى المشاهدون البث متجمّدًا. الهاتف يعيد الاتصال - اتركه في مكانه.",
  "overlay.reconnectingA11y": "إعادة الاتصال. يرى المشاهدون البث متجمّدًا بينما يعيد الهاتف الاتصال.",
  "overlay.onAirFor": "على الهواء منذ {time}",
  "overlay.offAir": "خارج البث",
  "overlay.offAirBody": "تعذّرت استعادة الاتصال. لا شيء يُبث.",
  "overlay.offAirA11y": "خارج البث. تعذّرت استعادة الاتصال.",
  "overlay.paused": "متوقف مؤقتًا",
  "overlay.pausedLive": "يرى المشاهدون صورة ثابتة ولا يسمعون شيئًا. الاتصال ما زال قائمًا.",
  "overlay.pausedIdle": "الصورة مثبّتة والميكروفون مغلق.",
  "overlay.pausedAt": "توقف عند {time}",
};
