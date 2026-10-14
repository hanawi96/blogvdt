import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table/cell';
import { TableHeader } from '@tiptap/extension-table/header';
import { TableRow } from '@tiptap/extension-table/row';
import StarterKit from '@tiptap/starter-kit';
import { isHttpUrl } from '../../lib/http';

// Editor và trang công khai phải dùng cùng schema. Mỗi lần gọi tạo instance mới
// vì Tiptap không cho dùng lại extension đã gắn vào một editor.
export function postExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      underline: false,
      horizontalRule: false,
      link: {
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
        protocols: ['http', 'https'],
        isAllowedUri: (url) => isHttpUrl(url),
      },
    }),
    Image.configure({ allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ];
}
