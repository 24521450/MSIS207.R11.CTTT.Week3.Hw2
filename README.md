# Studio 88 · Piano đa âm

Ứng dụng piano 88 phím chạy hoàn toàn trong trình duyệt, dựng bằng React 19, TypeScript strict và Vite. Bộ tổng hợp âm thanh dùng Web Audio API; không có máy chủ, tài khoản hay thư viện âm thanh cần tải xuống.

**Demo:** [24521450.github.io/MSIS207.R11.CTTT.Week3.Hw2](https://24521450.github.io/MSIS207.R11.CTTT.Week3.Hw2/) · **Mã nguồn:** [GitHub](https://github.com/24521450/MSIS207.R11.CTTT.Week3.Hw2)

## Chạy trên máy

Yêu cầu Node.js 24 trở lên.

```sh
npm ci
npm run dev
```

Các lệnh kiểm tra và build:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
npm run verify:browser
```

`npm run verify` chạy typecheck, lint, test và build liên tiếp. `npm ci` cài chính xác các phiên bản trong `package-lock.json`. `npm run verify:browser` chạy production preview trong Microsoft Edge đã cài trên máy, lưu ảnh và kết quả vào `evidence/`. Với URL website đã deploy, dùng `npm run verify:browser -- --url=https://24521450.github.io/MSIS207.R11.CTTT.Week3.Hw2/`.

## Điều khiển

- Giữ phím đàn bằng chuột, cảm ứng đa điểm hoặc bàn phím máy tính; thả phím để kết thúc nốt. Tab có thể focus từng phím và Enter/Space chơi phím đang focus.
- Đàn được sinh theo MIDI 21–108: A0 đến C8, gồm 52 phím trắng và 36 phím đen. Trên màn hình nhỏ, cuộn ngang trong vùng đàn để đến toàn bộ phím.
- Bàn phím máy tính chơi hai quãng tám:

| Quãng | Phím trắng và phím đen |
| --- | --- |
| C3–B3 | `Z` C3 · `S` C♯3 · `X` D3 · `D` D♯3 · `C` E3 · `V` F3 · `G` F♯3 · `B` G3 · `H` G♯3 · `N` A3 · `J` A♯3 · `M` B3 |
| C4–B4 | `Q` C4 · `2` C♯4 · `W` D4 · `3` D♯4 · `E` E4 · `R` F4 · `5` F♯4 · `T` G4 · `6` G♯4 · `Y` A4 · `7` A♯4 · `U` B4 |

- **Ghi âm** bắt đầu một bản thu mới. **Kết thúc ghi** chốt các nốt còn đang giữ. **Phát** chạy FIFO; **Dừng** huỷ ngay phiên và nhả các voice; **Xóa bản thu** làm trống hàng đợi.
- Chọn `0.5x`, `1x` hoặc `2x` trước khi phát. Khi đang phát, thao tác ghi, chơi trực tiếp, xóa và đổi tốc độ bị khóa; âm lượng và Dừng vẫn dùng được.
- Repeat của phím máy tính bị bỏ qua. Mất focus cửa sổ sẽ nhả các nốt đang giữ; chuyển tab sang trạng thái ẩn sẽ dừng replay để tránh phát dồn khi quay lại.

## Synth và polyphony

`src/audio/polyphonic-synth.ts` tách khỏi giao diện. `PolyphonicSynth` tạo `AudioContext` theo yêu cầu đầu tiên, resume từ thao tác người dùng và sở hữu các oscillator, envelope và master gain. Map JavaScript giữ thứ tự chèn của tối đa tám voice; voice cũ nhất được nhả trước khi nhận voice thứ chín.

Mỗi voice có attack/decay và một mức sustain, master gain giữ headroom cho hợp âm. Note-off và voice stealing ramp tuyến tính về `0.0001` trong 40 ms trước khi dừng oscillator; callback kết thúc ngắt cả oscillator lẫn gain node. Voice tail chỉ tồn tại ngắn ngoài giới hạn tám voice đang hoạt động. Thay đổi volume áp dụng vào master gain.

Mỗi phím giữ tập nguồn riêng (pointer, phím máy tính hoặc sự kiện replay). Nếu hai nguồn cùng giữ một MIDI, thả một nguồn không tắt tiếng khi nguồn kia vẫn còn giữ. Nếu voice bị steal, UI giải phóng trạng thái và quyền giữ của nó ngay.

## Recording contract và FIFO replay

Mỗi sự kiện trong hàng đợi có dạng:

```ts
{ midi: number, freqHz: number, durationMs: number, deltaMs: number }
```

- `deltaMs` là thời gian giữa onset của sự kiện này và onset ngay trước đó; sự kiện đầu có `deltaMs: 0`. Thời lượng tính theo mili giây và chốt khi nguồn cuối cùng thả nốt hoặc khi voice bị steal.
- Nếu nhiều nguồn cùng giữ một MIDI, recording ghi một note-on ở lần giữ đầu và chốt duration ở lần thả cuối. Hàng đợi luôn theo thứ tự note-on, không theo thứ tự note-off.
- Replay tạo deadline cho toàn bộ onset từ một mốc bắt đầu chung. Ở tốc độ `s`, onset và duration đều chia `s`; note-off chạy song song với dispatcher để hợp âm và overlap được giữ đúng.
- Mỗi phiên replay có `AbortController` riêng. Dừng, tab ẩn hoặc unmount huỷ timer chờ; callback phiên cũ không thể nhả nốt thuộc phiên mới. Replay không được ghi ngược vào queue.
- Bản thu chỉ ở trong bộ nhớ phiên hiện tại; tải lại trang sẽ xoá queue.

## Kiểm thử và bằng chứng

`npm test` dùng Vitest và DOM mô phỏng. AudioContext trong các unit/integration test được thay bằng fake nodes để xác nhận giới hạn voice, FIFO stealing, ADSR/release/disconnect, race khi retrigger, tốc độ replay, overlap, abort, 88 phím và nguồn giữ nhiều loại. Test render isolation dùng `React.Profiler` cho từng phím: baseline được chụp sau StrictMode mount; nhấn rồi thả C4 tạo đúng một commit mỗi lần ở C4, còn 87 phím khác giữ nguyên số commit.

`npm run verify:browser` chạy browser regression trên production preview bằng Edge, Web Audio thật và axe-core. Nó dùng chuột thật để hit-test hai mép phím đen C♯4 khi C4 hoặc C4+D4 đang giữ, kiểm tra focus-visible, 88/52/36 phím, 8 voice FIFO, recording và overlap ở cả ba tốc độ theo onset/duration đã ghi, Stop → Play, layout mobile và lỗi console/network. Axe chạy ở desktop/mobile trong bốn trạng thái: trống, đang ghi, có bản thu và đang phát. Thêm `-- --url=https://24521450.github.io/MSIS207.R11.CTTT.Week3.Hw2/` để kiểm tra site live bằng cùng các luồng. Fake Web Audio test không thay thế kiểm tra với Web Audio thật. Kết quả, bằng chứng trước/sau và giới hạn phép kiểm nằm trong [`evidence/verification.md`](evidence/verification.md).

## Deploy

`.github/workflows/pages.yml` chạy `npm ci`, typecheck, lint, test và build trên mỗi push vào `main`, sau đó triển khai `dist/` bằng GitHub Pages Actions. Vite dùng base path `/MSIS207.R11.CTTT.Week3.Hw2/` cho đúng project site.
