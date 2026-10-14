import { hashPassword } from '../src/features/auth/password.ts';

const password = process.env.ADMIN_PASSWORD ?? '';
if (process.argv.includes('--remote')) {
  console.error('Lệnh này chỉ in hash. Không ghi database và không nhận --remote.');
  process.exit(1);
}
if (password.length < 16) {
  console.error('Đặt ADMIN_PASSWORD trong môi trường, ít nhất 16 ký tự. Không đưa mật khẩu vào lệnh.');
  process.exit(1);
}

process.stdout.write(`${await hashPassword(password)}\n`);
