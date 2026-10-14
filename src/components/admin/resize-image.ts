export async function resizeImage(file: File): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > 1600 ? 1600 / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không xử lý được ảnh.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  const output = blob ?? (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82)));
  if (!output) throw new Error('Không thu nhỏ được ảnh. Hãy chọn ảnh JPEG hoặc PNG nhỏ hơn.');
  const extension = output.type === 'image/webp' ? 'webp' : 'jpg';
  return { file: new File([output], outputName(file.name, extension), { type: output.type }), width, height };
}

function outputName(original: string, extension: string): string {
  const base = original.split(/[/\\]/).pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60);
  return `${stem || 'anh'}.${extension}`;
}
