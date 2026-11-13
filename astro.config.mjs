// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// Tiptap tách nhiều package nhỏ, chỉ nạp khi mở editor / render bài. Pre-bundle NGAY từ đầu
// (cả client lẫn SSR) để Vite không "khám phá muộn" rồi re-optimize giữa chừng — nguyên nhân lỗi
// "file does not exist ... optimize deps" (deps / deps_ssr). Dùng include (không exclude) nên
// package CommonJS vẫn được chuyển ESM, không gây "module is not defined" trên Workers.
const TIPTAP_DEPS = [
  '@tiptap/core',
  '@tiptap/extensions',
  '@tiptap/starter-kit',
  '@tiptap/static-renderer',
  '@tiptap/pm/state',
  '@tiptap/pm/tables',
  '@tiptap/extension-image',
  '@tiptap/extension-table',
  '@tiptap/extension-table/cell',
  '@tiptap/extension-table/header',
  '@tiptap/extension-table/row',
];

// prosemirror-tables đăng ký CellSelection.jsonID('cell') ở cấp module. Nếu Vite tạo nhiều
// bản (do pre-bundle từng subpath riêng), side-effect chạy 2 lần → "Duplicate use of selection
// JSON ID cell". Ép mọi import @tiptap/pm và prosemirror dùng chung MỘT bản.
const TIPTAP_DEDUPE = ['@tiptap/pm', 'prosemirror-tables', 'prosemirror-state', 'prosemirror-view', 'prosemirror-model'];

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Phiên quản trị sẽ lưu trên D1. Không tạo KV session mặc định của Astro.
  session: false,
  adapter: cloudflare({
    // Ảnh sẽ đi qua R2. Không dùng binding Cloudflare Images.
    imageService: 'passthrough',
  }),
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
    resolve: { dedupe: TIPTAP_DEDUPE },
    // zod: exclude để tránh lỗi thiếu file sau khi Vite re-optimize.
    optimizeDeps: {
      exclude: ['zod'],
      include: TIPTAP_DEPS,
    },
    ssr: {
      optimizeDeps: {
        exclude: ['zod'],
        include: TIPTAP_DEPS,
      },
    },
  },
});
