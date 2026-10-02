# ♟ 7AMO CHESS — Discord Chess Pro

بوت شطرنج احترافي وفاخر لـ Discord، مبني حول `chess.js` للقواعد و`Stockfish 18` للخصم الذكي، مع Canvas مخصص بخامات Ebony Wood + Ivory Marble وإضاءة ثلاثية الأبعاد وDiscord Components V2 وإيموجي مخصصة مملوكة للتطبيق.

## 7AMO Chess DEV — الإصدار 7.0.1

نسخة تثبيت نهائية باسم `chess-bot-dev7amo`: أصول غير مكررة، إيموجيات مملوكة للتطبيق، لوحة Ebony Wood + Ivory Marble، استعادة مباريات، وقفل عمليات المباراة لمنع التعارضات، مع حماية كاملة من انتهاء صلاحية Discord Interactions أثناء الانتظار على Canvas/Stockfish.

## ما تم تحسينه

- واجهة Canvas جديدة: Obsidian / Ivory / Silver، شارات LIVE، رقم النقلة، مؤشرات الدور، فرق القطع، آخر نقلة، والـpreview بشكل أوضح.
- Preview قبل تنفيذ النقلة مع أسهم ومعلومات capture / check / promotion.
- تلميح ذكي يعمل بالمحرك على طلب اللاعب ولا ينفذ النقلة تلقائيًا.
- Rematch مباشر بعد انتهاء المباراة.
- حماية أقوى لتوكنات المعاينة ومنع لاعب آخر من استهلاك/إلغاء معاينة غيره.
- حماية من بدء مباراتين نشطتين في نفس القناة بسبب إعداد قديم أو تحدٍ معلّق.
- معالجة فشل Stockfish بمسار fallback قانوني بدل الدخول في تكرار AI.
- تقسيم وجهات النقلة عند تجاوز 25 خيارًا، احترامًا لحدود Discord Select Menus.
- تحسين إدارة انتظار Stockfish وإزالة waiter قديم عند الـtimeout وتنظيف callbacks عند الإنهاء.
- إصلاح `DiscordAPIError[10062] Unknown interaction`: يتم ACK للـComponent/Modal قبل Game Lock وCanvas وStockfish، والـlistener أصبح ينتظر الـPromise داخل `try/catch` حتى لا يتحول خطأ interaction إلى crash للـNode process.
- الإيموجي المخصصة عبارة عن PNG عالية الجودة من حزمة 3D موحّدة، وتُرفع كـApplication Emojis من التطبيق نفسه؛ لا تحتاج إضافتها يدويًا لكل سيرفر.

الـCanvas يستخدم خامات 2×2 متغيرة لكل مربع مع bevel وإضاءة سينمائية، ويحتوي على fallback vector للقطع عند تعذر تحميل الأصول.

## الأوامر

```text
/chess ai
/chess pvp @user
/chess board
/chess stats
/chess leaderboard
/chess help
```

## التشغيل

الإصدار المستهدف للتشغيل هو Node.js 22 أو أحدث.

```bash
npm install
npm run deploy
npm start
```

لا تحتاج أي أمر إضافي. عند تشغيل البوت، `ClientReady` يتولى تلقائيًا مزامنة وإنشاء Application Emojis الخاصة بالتطبيق نفسه ثم يحفظ الـIDs لاستخدامها في واجهة البوت.

## البيانات

إحصائيات اللاعبين محفوظة في `data/players.json`، وحالة المباريات في `data/games.json` بحفظ ذري للـmove history والـmetadata. بعد Restart يعيد البوت المباريات النشطة تلقائيًا، بينما يحتفظ بالمباراة المنتهية لمدة قصيرة لدعم Rematch.

## الملفات غير اللازمة

لا يتم شحن تقارير الفحص أو ملفات PNG مكررة أو مجلدات بيانات فارغة داخل الحزمة النهائية. مجلد `data/` يتم إنشاؤه تلقائيًا عند أول تشغيل، وملفات التشغيل المحلية مثل `.env` وبيانات المباريات مستثناة من Git عبر `.gitignore`.

## الحقوق

__**Powered By TC Team — 7amo**__
