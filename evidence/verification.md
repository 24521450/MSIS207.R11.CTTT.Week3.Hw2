# Báo cáo regression · Studio 88

Ngày kiểm: 02-11-2026. Phạm vi: chỉ `W3/Hw2`. Baseline được lấy từ `../tmp/hw-review-20261102`; báo cáo gốc trong thư mục đó không bị sửa.

## Kết quả kiểm thử mã nguồn

- `npm ci` — cài đặt từ lockfile; axe-core được thêm làm dev dependency; audit cài đặt báo 0 vulnerabilities.
- `npm run typecheck` — pass, TypeScript strict.
- `npm run lint` — pass, không warning.
- `npm test -- --reporter=dot` — 22/22 pass trong 4 file.
- `npm run build` — pass; CSS 17.91 kB và JS 242.75 kB trước gzip.
- `npm run verify` — chạy liên tiếp typecheck, lint, toàn bộ test và build; pass.

## Các lỗi đã sửa

1. **Phím đen bị che.** Phím đen giữ z-index 2; phím trắng thường, pressed và focus-visible ở z-index 1. Focus ring màu cam đậm trên phím trắng và màu sáng trên phím đen vẫn rõ mà không đổi tầng xếp chồng.
2. **Chữ tương phản thấp.** Tăng độ tối cho nhãn, hướng dẫn, trạng thái, queue, mapping, footer, nút và tên nốt; disabled Play không làm mờ chữ. Bỏ transition màu/nền ở transport button để không tạo khung hình trung gian thiếu tương phản khi bật/tắt. Axe cuối không còn violation.
3. **Accessible name và target size.** Brand lấy tên truy cập từ chữ hiển thị. Vùng đàn có `role="region"` kèm nhãn phù hợp. Phím đen rộng 24 CSS px; white-key width là 40 px desktop và 34 px mobile.
4. **Render isolation.** Bỏ `data-render-count` và effect phụ thuộc. `React.Profiler` trong test theo dõi commit cho từng PianoKey; baseline sau StrictMode mount, nhấn/thả C4 làm C4 tăng đúng một commit mỗi lần, cả 87 phím còn lại không tăng. Chi tiết ở [`render-isolation.md`](render-isolation.md).

## Browser regression production preview

`npm run verify:browser` chạy bản `dist/` trong Microsoft Edge, inject axe-core và dùng Web Audio API thật. Kết quả cuối:

- HTTP 200; 88 phím: 52 trắng, 36 đen. Tần số xác nhận: A0 27.50 Hz, A4 440.00 Hz, C8 4186.01 Hz.
- Q giữ C4; kiểm tra `elementFromPoint` ở mép trái và mép phải C♯4 đều trả MIDI 61. Mouse thật nhấn được C♯4 khi C4, và khi C4+D4, vẫn đang giữ.
- Tab focus C4 tạo outline 3 px; white key giữ z-index 1 và vùng C♯4 tiếp tục nhận MIDI 61.
- Voice thứ chín giữ đúng 8 voice active và steal MIDI cổ nhất. Unit/component regression cũng kiểm tra nhiều nguồn giữ cùng MIDI.
- Recording ghi C4 rồi E4 theo onset. Với lần chạy cuối: C4 `durationMs=1926`; E4 `deltaMs=307`, `durationMs=809`. Cửa sổ overlap tính từ timeline thực là 614–2232 ms ở 0.5x, 307–1116 ms ở 1x, và 153.5–558 ms ở 2x. Poll trong trình duyệt thấy cả hai nốt cùng active lần lượt tại 663 ms, 360 ms và 207 ms sau Play; mobile 0.5x cũng pass tại 665 ms. Stop và Play → Stop → Play đều pass.
- Mobile viewport 390 × 844 CSS px: document 390 px, vùng phím 1768 px trong viewport đàn 334 px; phím đen 24 px và trang không tràn ngang.
- Axe chạy ở desktop và mobile trong bốn trạng thái: trống, đang ghi, có bản thu, đang phát. **8/8 audit không có violation**, gồm color-contrast, target-size và label-content-name-mismatch. Không tắt rule. `color-contrast` còn mục `incomplete` cho ký hiệu trang trí, nền gradient và một nhãn hero bị artwork chạm một phần trên mobile; đây là mục cần đánh giá thủ công, không phải violation. Các nhãn trên phím được tính contrast tại mọi điểm đầu/cuối của gradient trong [`contrast-manual.json`](contrast-manual.json); ảnh mobile cho thấy chữ tag vẫn đọc được.
- Không có console, page, request hay HTTP errors.

## Bằng chứng

- Baseline: [`before-axe-desktop.png`](before-axe-desktop.png), [`before-axe-mobile.png`](before-axe-mobile.png), [`baseline-review-20261102.json`](baseline-review-20261102.json). Baseline ghi 57 desktop và 56 mobile color-contrast nodes, 36 black-key target-size nodes, cùng một accessible-name mismatch mỗi viewport.
- Sau sửa: [`production-preview-desktop.png`](production-preview-desktop.png), [`production-preview-mobile.png`](production-preview-mobile.png), [`production-preview-black-key-hit-test.png`](production-preview-black-key-hit-test.png), [`production-preview-focus-visible.png`](production-preview-focus-visible.png), [`production-preview.json`](production-preview.json), [`production-preview-axe.json`](production-preview-axe.json), [`contrast-manual.json`](contrast-manual.json), [`render-isolation.md`](render-isolation.md).

## Giới hạn phép kiểm

Web Audio API thật đã tạo AudioContext đang chạy và oscillator sau thao tác người dùng; test không đánh giá âm thanh bằng loa/tai nghe. Mobile là viewport giả lập trong Edge, chưa thử điện thoại thật. Chưa chạy screen reader hoặc Lighthouse trong lượt sửa này. Bản thu vẫn chỉ nằm trong bộ nhớ của trang.
