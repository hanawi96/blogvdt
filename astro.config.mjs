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
  },
});
