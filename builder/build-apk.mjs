import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const client = join(root, 'client');
const lab = join(root, '.androm');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
const run = (file, args, env = process.env) => execFileSync(file, args, { cwd: client, stdio: 'inherit', env });

function build() {
  if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
  if (!existsSync(join(lab, 'trust/raw/lab_ca.pem'))) throw new Error('Run node scripts/init-lab.mjs first.');
  const buildTools = join(sdk, 'build-tools', '34.0.0');
  const align = join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
  const signer = join(buildTools, 'lib/apksigner.jar');
  if (!existsSync(align) || !existsSync(signer)) throw new Error('Install build-tools;34.0.0 with sdkmanager.');
  const env = { ...process.env, ANDROM_SIGN_PASS: readFileSync(join(lab, 'apk.pass'), 'utf8').trim() };
  run(java, ['-classpath', join(client, 'gradle/wrapper/gradle-wrapper.jar'),
    'org.gradle.wrapper.GradleWrapperMain', '--console=plain', ':app:assembleRelease']);
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const stage = mkdtempSync(join(dist, '.build-'));
  try {
    const unsigned = join(client, 'app/build/outputs/apk/release/app-release-unsigned.apk');
    const aligned = join(stage, 'aligned.apk');
    const signed = join(stage, 'signed.apk');
    run(align, ['-f', '4', unsigned, aligned]);
    run(java, ['-jar', signer, 'sign', '--ks', join(lab, 'apk.p12'), '--ks-key-alias', 'androm-lab',
      '--ks-pass', 'env:ANDROM_SIGN_PASS', '--key-pass', 'env:ANDROM_SIGN_PASS', '--out', signed, aligned], env);
    run(java, ['-jar', signer, 'verify', '--verbose', '--print-certs', signed]);
    run(align, ['-c', '4', signed]);
    // Only a verified APK replaces a previous build in dist/.
    renameSync(signed, join(dist, 'androm-lab.apk'));
    console.log('Built ' + join(dist, 'androm-lab.apk'));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
try { build(); } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
