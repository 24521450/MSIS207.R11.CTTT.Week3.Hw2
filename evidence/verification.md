# Báo cáo kiểm chứng · Studio 88

Ngày kiểm: 02-11-2026. Repo: `24521450/MSIS207.R11.CTTT.Week3.Hw2`.

## Kiểm tra mã nguồn

- `npm ci` — cài đặt dựa trên lockfile.
- `npm run typecheck` — pass, TypeScript strict.
- `npm run lint` — pass, không có warning.
- `npm test -- --reporter=dot` — 22/22 test pass trong 4 file.
- `npm run build` — pass; Vite tạo `dist/index.html`, CSS 15.46 kB và JS 242.63 kB trước gzip.

Các test dùng fake Web Audio nodes để kiểm tra 88 nốt/52 phím trắng/36 phím đen, MIDI A0/A4/C8, FIFO steal ở voice thứ chín, ramp release đến `0.0001`, stop/disconnect, retrigger cùng MIDI, ADSR, và master volume. Test recorder xác nhận onset FIFO kể cả khi note-off đảo thứ tự; replay kiểm tra overlap ở 0.5x/1x/2x, abort, Stop→Play và callback cũ. Component test bao phủ held note cuối phiên ghi, key repeat, pointer cancel, blur, hidden tab, unmount cleanup và nhiều nguồn cùng giữ một MIDI.

## Render isolation

`PianoKey` là `React.memo`. Các note và callbacks truyền vào giữ identity ổn định; mỗi key chỉ nhận `isPressed` boolean. `data-render-count` được cập nhật trong `useLayoutEffect`, nên đếm commit sau khi state đổi. Test render `<App />` trong `StrictMode`, chụp baseline sau mount, sau đó nhấn/thả C4: count của C4 tăng đúng một commit cho mỗi lần đổi trạng thái, C♯4 giữ nguyên. StrictMode chạy lại thiết lập mount ban đầu trước khi baseline được chụp nên không bị tính nhầm thành update.

## Production preview trên trình duyệt

`npm run verify:browser` chạy bản `dist/` trong Microsoft Edge trên máy này. Script kiểm tra sau thao tác chuột thật rằng `AudioContext` ở trạng thái `running` và oscillator đã bắt đầu; xác nhận hợp âm, mapping Q, 88 phím, black-key position, giới hạn 8 voice khi nốt thứ chín vào, recording/reverse note-off, replay overlap ở tốc độ chậm, Stop→Play, và console/network không lỗi.

Kích thước mobile kiểm bằng viewport 390 × 844 CSS px: document width 390 px; vùng piano rộng 334 px và nội dung phím cuộn ngang 1,612 px. Đây là viewport giả lập trong Edge, không phải điện thoại vật lý.

Ảnh và JSON chi tiết:

- [`production-preview-desktop.png`](production-preview-desktop.png)
- [`production-preview-mobile.png`](production-preview-mobile.png)
- [`production-preview.json`](production-preview.json)

## Mức độ của từng phép kiểm

Kiểm thử unit/component dùng fake clock và fake `AudioContext`; chúng xác nhận logic FIFO, envelope, cancellation và render isolation nhưng không phát âm thanh vật lý. Browser smoke test dùng Chromium engine của Microsoft Edge với Web Audio API thật trong production preview; nó xác nhận context chạy và oscillator được tạo sau thao tác người dùng, không đo chất lượng âm thanh bằng tai nghe hay thiết bị mobile thật.

Test `playRecording` và component integration kiểm stop, hidden tab, unmount và phiên Play→Stop→Play bằng fake timers. Browser smoke test kiểm chord, queue, overlap và Stop→Play bằng Web Audio thật. Không có backend hoặc persistence; tải lại trang xoá bản thu.
