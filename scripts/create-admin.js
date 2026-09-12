process.env.TZ = process.env.TZ ?? 'Asia/Bangkok';

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Config } from '../src/core/Config.js';
import { DatabaseFactory } from '../src/core/Database.js';
import { Logger } from '../src/core/Logger.js';
import { UserRepository } from '../src/repositories/UserRepository.js';
import { RoleRepository } from '../src/repositories/RoleRepository.js';
import { ScryptHasher } from '../src/services/security/ScryptHasher.js';
import { PasswordPolicy } from '../src/services/security/PasswordPolicy.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Validator } from '../src/core/Validator.js';

/** รหัสอักขระควบคุมที่ตัวอ่านรหัสผ่านต้องจัดการ */
const KEY = Object.freeze({
  ENTER: '\r',
  NEWLINE: '\n',
  END_OF_TEXT: '',   // Ctrl+C
  END_OF_TRANSMISSION: '', // Ctrl+D
  BACKSPACE: '',
  BACKSPACE_ALT: '\b',
});

/**
 * ตัวอ่านอาร์กิวเมนต์บรรทัดคำสั่งแบบ `--key=value` หรือ `--key value`
 *
 * มีไว้ให้รันสคริปต์นี้แบบไม่โต้ตอบได้ในสคริปต์ติดตั้งอัตโนมัติและชุดทดสอบ
 * ⚠️ การส่งรหัสผ่านทางบรรทัดคำสั่งทำให้รหัสปรากฏใน process list และ shell history
 * จึงควรใช้เฉพาะในสภาพแวดล้อมที่ควบคุมได้ ไม่ควรใช้บนเซิร์ฟเวอร์จริง
 */
class CliArguments {
  /** @type {Map<string, string>} */
  #values = new Map();

  /** @param {Array<string>} argv อาร์กิวเมนต์ดิบ (ไม่รวมสองตัวแรกของ process.argv) */
  constructor(argv) {
    for (let i = 0; i < argv.length; i += 1) {
      const token = argv[i];
      if (!token.startsWith('--')) continue;

      const equals = token.indexOf('=');
      if (equals !== -1) {
        this.#values.set(token.slice(2, equals), token.slice(equals + 1));
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        this.#values.set(token.slice(2), argv[i + 1]);
        i += 1;
      } else {
        this.#values.set(token.slice(2), 'true');
      }
    }
  }

  /**
   * อ่านค่าตามชื่อ
   * @param {string} key ชื่ออาร์กิวเมนต์
   * @returns {string|null}
   */
  get(key) { return this.#values.get(key) ?? null; }

  /** @returns {boolean} มีอาร์กิวเมนต์ครบสำหรับสร้างผู้ดูแลโดยไม่ต้องถามหรือไม่ */
  get isComplete() {
    return ['username', 'email', 'name', 'password']
      .every((key) => this.#values.has(key) && this.#values.get(key));
  }
}

/**
 * สคริปต์สร้างผู้ดูแลคนแรกแบบโต้ตอบ — `npm run create:admin`
 *
 * ผู้ใช้ที่สร้างจากสคริปต์นี้ได้ `is_super_admin = 1` และบทบาท `SUPER_ADMIN`
 * จึงผ่านทุกด่านสิทธิ์ แต่การกระทำทุกอย่างยังถูกบันทึกใน audit log ตามปกติ
 */
class AdminCreator {
  /** @type {UserRepository} */
  #userRepository;
  /** @type {RoleRepository} */
  #roleRepository;
  /** @type {ScryptHasher} */
  #hasher;
  /** @type {PasswordPolicy} */
  #policy;
  /** @type {import('node:readline/promises').Interface} */
  #rl;
  /** @type {CliArguments} */
  #args;

  /**
   * @param {object} deps การพึ่งพา
   * @param {UserRepository} deps.userRepository ที่เก็บผู้ใช้
   * @param {RoleRepository} deps.roleRepository ที่เก็บบทบาท
   * @param {ScryptHasher} deps.hasher ตัวแฮชรหัสผ่าน
   * @param {PasswordPolicy} deps.policy นโยบายรหัสผ่าน
   * @param {import('node:readline/promises').Interface} deps.rl ตัวอ่านอินพุต
   */
  constructor({ userRepository, roleRepository, hasher, policy, rl, args }) {
    this.#userRepository = userRepository;
    this.#roleRepository = roleRepository;
    this.#hasher = hasher;
    this.#policy = policy;
    this.#rl = rl;
    this.#args = args;
  }

  /**
   * ถามข้อมูลและสร้างผู้ดูแล
   * @returns {Promise<User>} ผู้ใช้ที่สร้าง
   * @throws {Error} เมื่อยังไม่ได้รัน `npm run db:setup`
   */
  async run() {
    process.stdout.write('\n  ── สร้างผู้ดูแลสูงสุดคนแรก ──\n\n');

    const { username, email, fullName, password } = this.#args.isComplete
      ? await this.#fromArguments()
      : await this.#fromPrompts();

    const role = await this.#roleRepository.findByKey(Role.SUPER_ADMIN);
    if (!role) {
      throw new Error('ไม่พบบทบาท SUPER_ADMIN — กรุณารัน npm run db:setup ก่อน');
    }

    const user = new User({
      username,
      email,
      passwordHash: await this.#hasher.hash(password),
      hashAlgo: this.#hasher.algorithm,
      fullName,
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
    });
    user.validate();

    const userId = await this.#userRepository.createWithAccess(user, [role.id], []);
    return this.#userRepository.findWithAccess(userId);
  }

  /**
   * อ่านข้อมูลจากอาร์กิวเมนต์บรรทัดคำสั่ง พร้อมตรวจความถูกต้องแบบเดียวกับโหมดโต้ตอบ
   * @returns {Promise<{username: string, email: string, fullName: string, password: string}>}
   * @throws {Error} เมื่อข้อมูลไม่ผ่านการตรวจ
   */
  async #fromArguments() {
    const username = String(this.#args.get('username')).trim();
    const email = String(this.#args.get('email')).trim().toLowerCase();
    const fullName = String(this.#args.get('name')).trim();
    const password = String(this.#args.get('password'));

    if (username.length < 3 || username.length > 100) {
      throw new Error('ชื่อผู้ใช้ต้องยาว 3–100 ตัวอักษร');
    }
    if (await this.#userRepository.exists({ username })) {
      throw new Error(`ชื่อผู้ใช้ "${username}" ถูกใช้ไปแล้ว`);
    }
    if (!new Validator({ email }).email('email').passes) {
      throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
    }
    if (await this.#userRepository.exists({ email })) {
      throw new Error(`อีเมล "${email}" ถูกใช้ไปแล้ว`);
    }
    if (!fullName || fullName.length > 200) {
      throw new Error('ต้องระบุชื่อ-นามสกุล (ไม่เกิน 200 ตัวอักษร)');
    }
    const issues = this.#policy.check(password);
    if (issues.length) throw new Error(issues.join(' · '));

    process.stdout.write(`  ใช้ข้อมูลจากอาร์กิวเมนต์: ${username} (${email})\n`);
    return { username, email, fullName, password };
  }

  /**
   * ถามข้อมูลทีละข้อจากผู้ใช้
   * @returns {Promise<{username: string, email: string, fullName: string, password: string}>}
   */
  async #fromPrompts() {
    const username = await this.#askUsername();
    const email = await this.#askEmail();
    const fullName = await this.#ask('ชื่อ-นามสกุล: ', (value) => (
      value.trim().length > 0 && value.trim().length <= 200
        ? null : 'กรุณากรอกชื่อ-นามสกุล (ไม่เกิน 200 ตัวอักษร)'
    ));
    const password = await this.#askPassword();
    return { username, email, fullName, password };
  }

  /**
   * ถามชื่อผู้ใช้พร้อมตรวจว่าไม่ซ้ำ
   * @returns {Promise<string>}
   */
  async #askUsername() {
    for (;;) {
      const value = (await this.#rl.question('ชื่อผู้ใช้ (3–100 ตัวอักษร): ')).trim();
      if (value.length < 3 || value.length > 100) {
        process.stdout.write('  ⚠ ชื่อผู้ใช้ต้องยาว 3–100 ตัวอักษร\n');
        continue;
      }
      if (await this.#userRepository.exists({ username: value })) {
        process.stdout.write('  ⚠ ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว\n');
        continue;
      }
      return value;
    }
  }

  /**
   * ถามอีเมลพร้อมตรวจรูปแบบและความซ้ำ
   * @returns {Promise<string>}
   */
  async #askEmail() {
    for (;;) {
      const value = (await this.#rl.question('อีเมล: ')).trim().toLowerCase();
      const validator = new Validator({ email: value }).email('email');
      if (!validator.passes) {
        process.stdout.write('  ⚠ รูปแบบอีเมลไม่ถูกต้อง\n');
        continue;
      }
      if (await this.#userRepository.exists({ email: value })) {
        process.stdout.write('  ⚠ อีเมลนี้ถูกใช้ไปแล้ว\n');
        continue;
      }
      return value;
    }
  }

  /**
   * ถามรหัสผ่านพร้อมยืนยันและตรวจตามนโยบาย
   * @returns {Promise<string>}
   */
  async #askPassword() {
    process.stdout.write(`\n  ${this.#policy.description}\n`);
    for (;;) {
      const value = await this.#askHidden('รหัสผ่าน: ');
      const issues = this.#policy.check(value);
      if (issues.length) {
        for (const issue of issues) process.stdout.write(`  ⚠ ${issue}\n`);
        continue;
      }
      const confirm = await this.#askHidden('ยืนยันรหัสผ่าน: ');
      if (value !== confirm) {
        process.stdout.write('  ⚠ รหัสผ่านทั้งสองครั้งไม่ตรงกัน\n');
        continue;
      }
      return value;
    }
  }

  /**
   * ถามคำถามพร้อมตรวจความถูกต้องซ้ำจนกว่าจะผ่าน
   * @param {string} prompt ข้อความคำถาม
   * @param {(value: string) => string|null} validate ตัวตรวจ (คืนข้อความผิดพลาดหรือ null)
   * @returns {Promise<string>}
   */
  async #ask(prompt, validate) {
    for (;;) {
      const value = await this.#rl.question(prompt);
      const error = validate(value);
      if (!error) return value.trim();
      process.stdout.write(`  ⚠ ${error}\n`);
    }
  }

  /**
   * ถามรหัสผ่านโดยไม่แสดงตัวอักษรบนหน้าจอ
   *
   * ปิดการสะท้อนตัวอักษรชั่วคราว เพื่อไม่ให้รหัสผ่านค้างอยู่บนหน้าจอหรือใน scrollback
   * ของเทอร์มินัล เมื่อไม่ได้รันบน TTY (เช่นถูก pipe) จะอ่านแบบธรรมดาแทน
   *
   * @param {string} prompt ข้อความคำถาม
   * @returns {Promise<string>}
   */
  async #askHidden(prompt) {
    process.stdout.write(prompt);

    if (!stdin.isTTY) {
      return this.#rl.question('');
    }

    const wasRaw = stdin.isRaw ?? false;
    return new Promise((resolve) => {
      let buffer = '';
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const finish = (value) => {
        stdin.setRawMode(wasRaw);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      };

      const onData = (char) => {
        if (char === KEY.ENTER || char === KEY.NEWLINE || char === KEY.END_OF_TRANSMISSION) {
          finish(buffer);
          return;
        }
        if (char === KEY.END_OF_TEXT) {
          stdin.setRawMode(wasRaw);
          process.stdout.write('\n  ยกเลิก\n');
          process.exit(130);
        }
        if (char === KEY.BACKSPACE || char === KEY.BACKSPACE_ALT) {
          buffer = buffer.slice(0, -1);
          return;
        }
        if (char >= ' ') buffer += char;
      };

      stdin.on('data', onData);
    });
  }
}

const config = Config.bootstrap();
Logger.configure({ level: 'error', logDir: null, console: true });
const db = DatabaseFactory.create(config.database);
const rl = createInterface({ input: stdin, output: stdout });
const args = new CliArguments(process.argv.slice(2));

try {
  if (!await db.ping()) {
    process.stderr.write('\n  ❌ เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาตรวจไฟล์ .env\n\n');
    process.exit(1);
  }

  const creator = new AdminCreator({
    userRepository: new UserRepository(db),
    roleRepository: new RoleRepository(db),
    hasher: new ScryptHasher(),
    policy: new PasswordPolicy(config.int('PASSWORD_MIN_LENGTH', 10)),
    rl,
    args,
  });

  const user = await creator.run();

  process.stdout.write(
    `\n  ✅ สร้างผู้ดูแลสูงสุดเรียบร้อย: ${user.username} (${user.email})\n` +
    `     เข้าสู่ระบบได้ที่ ${config.baseUrl}/login\n\n`,
  );
} catch (error) {
  process.stderr.write(`\n  ❌ สร้างผู้ดูแลไม่สำเร็จ: ${error.message}\n\n`);
  process.exitCode = 1;
} finally {
  rl.close();
  await db.close();
}
