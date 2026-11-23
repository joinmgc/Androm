import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function initLab(directory, address) {
  if (!isIPv4(address)) throw new Error('Provide the IPv4 address of the lab server.');
  if (existsSync(directory)) throw new Error('Lab already initialized at ' + directory);
  mkdirSync(dirname(directory), { recursive: true });
  const stage = mkdtempSync(join(dirname(directory), '.androm-init-'));
  const pass = randomBytes(24).toString('hex');
  const signingPass = randomBytes(24).toString('hex');
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
  function key(args, password = pass) {
    // Pass passwords through the child environment, outside the argument list.
    execFileSync(keytool, [...args, '-storepass:env', 'ANDROM_KEY_PASS'], {
      cwd: stage, env: { ...process.env, ANDROM_KEY_PASS: password }, stdio: ['ignore', 'ignore', 'pipe']
    });
  }
  try {
    mkdirSync(join(stage, 'trust', 'raw'), { recursive: true });
    const ca = ['-keystore', 'issuer.p12', '-storetype', 'PKCS12', '-alias', 'issuer'];
    const tls = ['-keystore', 'server.p12', '-storetype', 'PKCS12', '-alias', 'server'];
    const ec = ['-keyalg', 'EC', '-groupname', 'secp256r1'];
    key(['-genkeypair', ...ca, ...ec, '-dname', 'CN=Androm Lab CA', '-validity', '3650',
      '-ext', 'bc:c=ca:true', '-ext', 'ku:c=keyCertSign,cRLSign']);
    key(['-exportcert', ...ca, '-rfc', '-file', 'trust/raw/lab_ca.pem']);
    key(['-genkeypair', ...tls, ...ec, '-dname', 'CN=Androm Lab Server', '-validity', '365']);
    key(['-certreq', ...tls, '-file', 'server.csr']);
    const sans = ['dns:localhost', ...[...new Set(['127.0.0.1', address])].map(ip => 'ip:' + ip)];
    key(['-gencert', ...ca, '-infile', 'server.csr', '-outfile', 'server.pem', '-rfc',
      '-validity', '365', '-ext', 'san=' + sans.join(','), '-ext', 'eku=serverAuth', '-ext', 'ku=digitalSignature']);
    key(['-importcert', '-noprompt', '-alias', 'issuer', '-keystore', 'server.p12', '-file', 'trust/raw/lab_ca.pem']);
    key(['-importcert', '-noprompt', ...tls, '-file', 'server.pem']);
    key(['-genkeypair', '-alias', 'androm-lab', '-keystore', 'apk.p12', '-storetype', 'PKCS12',
      '-keyalg', 'RSA', '-keysize', '3072', '-validity', '3650', '-dname', 'CN=Androm Lab APK'], signingPass);
    for (const file of ['issuer.p12', 'server.csr', 'server.pem']) rmSync(join(stage, file));
    writeFileSync(join(stage, 'tls.pass'), pass, { mode: 0o600 });
    writeFileSync(join(stage, 'apk.pass'), signingPass, { mode: 0o600 });
    writeFileSync(join(stage, 'pairing.txt'), randomBytes(12).toString('hex') + '\n', { mode: 0o600 });
    // Publish all related files together after the certificate chain is complete.
    renameSync(stage, directory);
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = fileURLToPath(new URL('../.androm', import.meta.url));
  try {
    initLab(destination, process.argv[2] || '127.0.0.1');
    console.log('Lab initialized. Pairing code: ' + join(destination, 'pairing.txt'));
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
