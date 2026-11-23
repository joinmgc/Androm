# Androm

```text
Androm/
├── client/
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   ├── gradle.properties
│   ├── gradlew
│   ├── gradlew.bat
│   ├── gradle/wrapper/{gradle-wrapper.jar,gradle-wrapper.properties}
│   └── app/
│       ├── build.gradle.kts
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── java/com/androm/lab/LabActivity.kt
│           └── res/
│               ├── layout/activity_lab.xml
│               └── xml/network_security_config.xml
├── server/
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   ├── fixtures/scenarios.json
│   ├── public/{index.html,lab.js,style.css}
│   └── test/lab.test.js
├── builder/{build-apk.mjs,build.sh}
├── scripts/init-lab.mjs
├── .github/workflows/build.yml
├── .gitattributes
├── .gitignore
└── README.md
```

مختبر للتمييز بين ما يرصده الخادم وما فعله هاتف أندرويد فعليًا. يختار المدرّس جلسة ويسجّل توقّعًا، ثم يرسل الطالب معرّف عينة من التطبيق. يعرض الخادم العينة من كتالوج مشترك، ويسجّل وقت الاستلام ونتيجة المطابقة. يستطيع الطالب مقارنة إيصال الهاتف بمعرّف الحدث في ملف السجل.

الاتصال والمصادقة والتخزين والتوقيع عمليات فعلية. يمثّل الكتالوج الشاشة والرسائل والمكالمات وجهات الاتصال والموقع والاهتزاز ببيانات اصطناعية. صلاحية التطبيق الوحيدة هي `INTERNET` وتُغلق الجلسة عند مغادرة الواجهة. ينتج المولّد تطبيق Androm المستقل من مصدر Kotlin.

## تجهيز Kali

نفّذ الأوامر من جذر المشروع. تحتاج إلى Node.js 20 أو أحدث، وJDK 17 يتضمن `keytool`، وهاتف يعمل بنظام Android 14 (API 34) أو أحدث. يجلب Gradle Wrapper إصدار Gradle 8.9 عند أول بناء. يحتاج تثبيت الاعتمادات والبناء الأول إلى الإنترنت. بعد تجهيز الحزمة والاعتمادات يمكن تشغيل التمرين داخل الشبكة المعزولة.

```bash
sudo apt update
sudo apt install nodejs npm unzip curl ca-certificates apktool
node --version
npm --version
```

استخدم JDK 17 المثبّت لديك. لتجهيز نسخة محلية على Kali بمعمارية x86-64، يمكن تنفيذ الآتي في مجلد جديد. اضبط `JAVA_HOME` و`PATH` في الطرفيات التي ستستخدمها للبناء والاختبار. [توزيعات Eclipse Temurin](https://adoptium.net/temurin/releases/?version=17)

```bash
mkdir -p "$HOME/.local/androm-jdk17"
curl -fL 'https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse' -o /tmp/androm-jdk17.tar.gz
tar -xf /tmp/androm-jdk17.tar.gz -C "$HOME/.local/androm-jdk17" --strip-components=1
export JAVA_HOME="$HOME/.local/androm-jdk17"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
keytool -help
```

إن كان Android Studio مثبّتًا، اضبط `ANDROID_HOME` على مسار SDK الظاهر في SDK Manager. للتثبيت بسطر الأوامر، نزّل Android SDK Command-line Tools for Linux وفكّها بحيث يصبح `sdkmanager` داخل `$ANDROID_HOME/cmdline-tools/latest/bin`. تتضمن حزمة Build Tools أداتي `zipalign` و`apksigner`. [تنزيل أدوات أندرويد](https://developer.android.com/studio#command-tools) · [دليل sdkmanager](https://developer.android.com/tools/sdkmanager)

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$PATH"
sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;34.0.0" "platform-tools"
npm ci --prefix server
```

## إنشاء هوية المختبر

اختر إحدى الطريقتين **قبل أول تهيئة**. تحفظ التهيئة المحلية الملفات في `.androm/`. تستخدم الشهادة عنوان IP المحدد بالإضافة إلى `localhost` و`127.0.0.1`.

| الوصلة | أمر التهيئة | عنوان الهاتف |
| --- | --- | --- |
| USB مع ADB reverse | `node scripts/init-lab.mjs 127.0.0.1` | `wss://127.0.0.1:8443` |
| شبكة المختبر | `node scripts/init-lab.mjs 192.168.56.10` | `wss://192.168.56.10:8443` |

في وضع الشبكة، استبدل عنوان المثال بعنوان واجهة Kali التي يمكن للهاتف الوصول إليها. يشغّل سكريبت التهيئة `keytool` لإنشاء سلطة محلية ذاتية التوقيع وشهادة خادم تحمل العنوان في SAN. ينشئ أيضًا مفتاح توقيع APK مستقلًا باسم `androm-lab`. يضمّ التطبيق الشهادة العامة الموجودة في `.androm/trust/raw/lab_ca.pem` فقط. احتفظ بمجلد `.androm` محليًا لإعادة بناء تحديثات موقّعة بالمفتاح نفسه. يتجاهله Git. [إعداد الثقة في أندرويد](https://developer.android.com/privacy-and-security/security-config)

## بناء الحزمة وتشغيل الخادم

```bash
bash builder/build.sh
apksigner verify --verbose --print-certs dist/androm-lab.apk
adb devices
adb install -r dist/androm-lab.apk
```

يستدعي مشغّل Bash المولّد `builder/build-apk.mjs`. يبني المولّد نسخة release من مشروع `client/`، ثم يحاذي الحزمة ويوقّعها ويتحقّق منها قبل كتابتها إلى `dist/androm-lab.apk`. لفتح المشروع داخل Android Studio، هيّئ شهادة المختبر أولًا، ثم افتح مجلد `client/` واختر JDK 17 لـ Gradle. [توثيق apksigner](https://developer.android.com/tools/apksigner)

عند استخدام USB، فعّل تصحيح USB واقبل اقتران هاتف الاختبار مع Kali. نفّذ في طرفية الخادم ما يلي.

```bash
adb reverse tcp:8443 tcp:8443
npm start --prefix server
```

عند استخدام شبكة المختبر، شغّل الخادم بهذا الأمر مع عنوان Kali الفعلي.

```bash
LAB_BIND=192.168.56.10 npm start --prefix server
```

يعرض الخادم لوحة المدرّس على `http://127.0.0.1:8080` في متصفّح Kali. يستقبل المنفذ 8443 اتصالات الهاتف عبر Socket.IO باستخدام نقل WebSocket حصريًا وTLS. يستعمل عميل Kotlin مكتبة Socket.IO مع OkHttp لتحقيق توافق البروتوكول. [تهيئة عميل Socket.IO](https://socketio.github.io/socket.io-client-java/initialization.html)

## تجربة مدتها دقيقتان

1. افتح لوحة المدرّس على Kali. في طرفية أخرى، اعرض الرمز بالأمر `cat .androm/pairing.txt`.
2. افتح **Androm Lab** على الهاتف. أدخل عنوان WSS والرمز ثم اضغط **اتصال**. طابق معرّف الجلسة الظاهر على الهاتف مع المعرّف في اللوحة.
3. حدّد الجلسة وعينة **رسالة قصيرة** في اللوحة، ثم اضغط **تسجيل التوقّع**. يظهر سجل توقّع واحد. لاحظ عدد الأحداث قبل لمس الهاتف.
4. من الهاتف، أرسل **موقع اصطناعي** ثم **رسالة قصيرة**. تظهر النتيجتان **عينة مختلفة** ثم **تطابق**. تُغلق المطابقة التمرين. إذا أرسلت عينة أخرى ستظهر النتيجة **إرسال حر**.
5. طابق آخر إيصال مع حقل `id` في `.androm/history.json`. يحتوي سجل العينة على `exerciseId` لربطه بتوقّع المدرّس، ووقت UTC، ومعرّف الجلسة، ونسخة من العينة. يحتفظ الخادم بآخر 200 سجل عبر إعادة تشغيله.
6. غادر التطبيق. تختفي الجلسة من اللوحة عند تحديثها التالي. تُلغى التوقّعات المعلّقة المرتبطة بالجلسة وتبقى الأحداث التاريخية قابلة للقراءة.

**للنقاش في الصف**، افتح `server/fixtures/scenarios.json` وابحث عن نص الرسالة والإحداثيات. مَن أنشأ هذه القيم؟ أي جزء من السجل يثبت حدوث اتصال، وأي دليل إضافي ستحتاجه لإثبات قراءة رسالة فعلية؟ عينة الشاشة وصف لإطار ثابت، وعينة الاهتزاز سجل لمدّة مفترضة.

## واجهة المدرّس وفحص الحزمة

يعرض `GET /api/state` الجلسات والكتالوج والسجل. يسجّل `POST /command` توقّعًا محليًا لجلسة متصلة. يرجع `201` عند إنشائه، و`404` لجلسة غير موجودة، و`409` إذا كان توقّع سابق ما زال معلقًا. يوجد هذان المساران على منفذ لوحة Kali المحلي. لإجراء نفس تجربة اللوحة من الطرفية، استبدل `SESSION_ID` بالمعرّف المعروض.

```bash
curl -sS http://127.0.0.1:8080/api/state
curl -sS http://127.0.0.1:8080/command \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"SESSION_ID","scenario":"get_sms"}'
```

لفحص ما ثُبّت على الهاتف، اقرأ صلاحيات الحزمة الموقّعة ثم فكّ موارد **حزمة Androm التي بنيتها**. افتح المانيفست وفهرس المكوّنات. ابحث عن تسجيل خدمات إمكانية الوصول وMediaProjection أو مستقبل الإقلاع، وقارن النتيجة بسلوك التطبيق خلال التجربة. [خيارات Apktool](https://apktool.org/docs/cli-parameters/)

```bash
aapt dump permissions dist/androm-lab.apk
inspection_dir="$(mktemp -d)"
apktool d -s dist/androm-lab.apk -o "$inspection_dir/androm"
cat "$inspection_dir/androm/AndroidManifest.xml"
```

يمكن للطلاب جمع أدلة مستقلة من هاتف الاختبار أثناء إرسال العينات، ثم تدوين اسم الحزمة التي تخصّها كل ملاحظة.

| الفرضية التي يناقشها الطالب | الدليل الذي يفحصه |
| --- | --- |
| قرأ التطبيق نص نافذة أو نفّذ إيماءة | قارن خدمات التطبيق في المانيفست بقائمة الخدمات المفعّلة في إعدادات إمكانية الوصول. عند تحليل حزمة تعلن خدمة من هذا النوع، افحص قيمتي `canRetrieveWindowContent` و`canPerformGestures` في مورد إعدادها. |
| التقط التطبيق الشاشة | شغّل `adb shell dumpsys media_projection` خلال تمرين الشاشة وابحث عن حزمة مالك جلسة الإسقاط، إن وُجدت. طابقها مع معرّف الحزمة `com.androm.lab`. |
| تعمل خدمة بعد مغادرة الواجهة | افحص `adb shell dumpsys activity services com.androm.lab` بعد مغادرة التطبيق، ثم قارن النتيجة بحالة الجلسة في لوحة المدرّس. |
| بدأ التطبيق تلقائيًا عند الإقلاع | افحص المانيفست المستخرج بحثًا عن مستقبل مُسجّل لحدث `BOOT_COMPLETED` وصلاحية `RECEIVE_BOOT_COMPLETED`. |

## التحقق وGitHub Actions

```bash
npm run build --prefix server
npm test --prefix server
```

ينشئ اختبار التكامل هوية مختبر مؤقتة ويستخدم منافذ متاحة تلقائيًا. يختبر رفض شهادة غير موثوقة ورمز خاطئ، والاتصال الناجح، ورفض عينات غير معروفة، والتطابق وعدم التطابق، واستعادة السجل بعد إعادة تشغيل الخادم.

يشغّل `.github/workflows/build.yml` الاختبارات على Node.js 22 عند كل push وطلب دمج. يرفع الخادم مع الواجهة والاختبارات والمُهيّئ وملف قفل الاعتمادات في artifact باسم `androm-server`. بعد فك الأرشيف على Kali، نفّذ `npm ci --prefix server` ثم هيّئ هوية المختبر وشغّل الخادم. لبناء تطبيق يقترن بهذا الخادم، نفّذ التهيئة والبناء من نسخة المستودع الكاملة نفسها. تبني مهمة Android حزمة منفصلة بهوية مؤقتة وتفحص الصلاحيات. [دليل GitHub Actions لمشاريع Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)

| عند ظهور مشكلة | ما تتحقق منه |
| --- | --- |
| خطأ البناء في `@raw/lab_ca` | نفّذ التهيئة من نسخة المشروع التي تفتحها في Android Studio. |
| الاتصال يفشل عبر USB | تحقّق من ظهور الهاتف في `adb devices` ومن وجود المنفذ في `adb reverse --list`. |
| الاتصال يفشل عبر الشبكة | طابق عنوان الهاتف مع SAN وشبكة Kali و`LAB_BIND`، وافحص وصول الهاتف إلى TCP 8443. |
| الهاتف يصل إلى الخادم ثم يُرفَض | انسخ رمز الاقتران من المجلد الذي يستخدمه ذلك الخادم وتحقّق من ساعة الهاتف وصلاحية الشهادة. |
| التهيئة تُبلغ أن المختبر موجود | أعد استخدام الهوية الحالية. لإنشاء مختبر مستقل استخدم نسخة مشروع أخرى ووقّع حزمته بهويتها. |
