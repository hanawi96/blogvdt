// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

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
    // Tránh lỗi thiếu file trong deps_ssr/deps sau khi Vite re-optimize (zod).
    optimizeDeps: {
      exclude: ['zod'],
      // Pre-bundle tiptap NGAY từ đầu để Vite không "khám phá muộn" rồi re-optimize giữa chừng
      // (nguyên nhân lỗi "file does not exist ... optimize deps" khi mở editor).
      // Dùng include (không exclude) nên CJS vẫn được chuyển ESM, không gây "module is not defined".
      include: [
        '@tiptap/core',
        '@tiptap/extensions',
        '@tiptap/starter-kit',
        '@tiptap/static-renderer',
        '@tiptap/pm/state',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-table',
        '@tiptap/extension-table/cell',
        '@tiptap/extension-table/header',
        '@tiptap/extension-table/row',
      ],
    },
    ssr: {
      optimizeDeps: {
        exclude: ['zod'],
      },
    },
  },
});
