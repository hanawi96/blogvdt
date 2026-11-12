// Stub cho virtual module `cloudflare:workers` khi chạy test trên Node (vitest).
// Môi trường test không có Workers runtime; test logic thuần không cần binding thật.
// Các hàm trong src/lib/cloudflare/env.ts đọc `env` trong try/catch nên object rỗng là đủ.
export const env: Record<string, unknown> = {};
